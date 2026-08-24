import { ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type {
  AttachmentStorageService,
  KeyringService,
  PluginEventBusService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { UsersAdminService } from './users-admin.service';
import { UsersService } from './users.service';
import { GrantsService } from './grants.service';
import { UserPluginService } from './user-plugin.service';

// Unit tests for the admin management actions: the self / last-admin / has-data
// guards and the force-delete cascade. RequestContextService.runWithoutScope
// just runs the callback; the DB is a mock.

describe('UsersAdminService', () => {
  const user = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const scopeGrant = { count: jest.fn() };
  const tx = {
    scopeGrant: { deleteMany: jest.fn() },
    userPluginConfig: { deleteMany: jest.fn() },
    userKeyring: { deleteMany: jest.fn() },
    keySession: { deleteMany: jest.fn() },
    user: { delete: jest.fn() },
  };
  const countDynamic = jest.fn();
  const deleteManyDynamic = jest.fn();

  // Ordering probe (#188). The commit is marked when the callback RETURNS, not
  // when a statement inside it runs — a pass-through stub would happily accept
  // an `emit` moved inside the transaction, which is the regression the order
  // assertion exists to catch. Null while a test does not care.
  let txLog: string[] | null = null;

  const prisma = {
    user,
    scopeGrant,
    countDynamic,
    deleteManyDynamic,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      const result = await fn(tx);
      txLog?.push('committed');
      return result;
    },
  };
  const requestContext = {
    runWithoutScope: <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
      fn(),
  };
  const i18n = { t: (key: string): string => key };
  const users = { invalidate: jest.fn() };
  const grants = { clearCaches: jest.fn() };
  const userPlugins = { clearCaches: jest.fn() };
  const keyring = { clearForUser: jest.fn() };
  const attachments = {
    collectScopeFilePaths: jest.fn(),
    removeFiles: jest.fn(),
  };

  // The bus a deleted scope is announced on (#188).
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

  const make = (): UsersAdminService =>
    new UsersAdminService(
      prisma as unknown as PrismaService,
      requestContext as unknown as RequestContextService,
      i18n as unknown as PluginI18nService,
      users as unknown as UsersService,
      grants as unknown as GrantsService,
      userPlugins as unknown as UserPluginService,
      keyring as unknown as KeyringService,
      attachments as unknown as AttachmentStorageService,
      eventBus as unknown as PluginEventBusService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    txLog = null;
    countDynamic.mockResolvedValue(0);
    scopeGrant.count.mockResolvedValue(0);
    user.count.mockResolvedValue(2);
    user.findUnique.mockResolvedValue({ id: 'target', isAdmin: false });
    attachments.collectScopeFilePaths.mockResolvedValue([]);
  });

  describe('deleteUser', () => {
    it('announces the deleted scope, after the delete and not before', async () => {
      // The whole point of #188: nothing announced it, so every plugin holding
      // per-scope data kept it forever. And the order matters — a listener
      // told early would delete data a rollback then restores. `committed` is
      // stamped by the $transaction stub once the callback resolves, so an
      // `emit` moved inside the transaction fails this.
      const order: string[] = [];
      txLog = order;
      eventBus.emit.mockImplementation(async () => {
        order.push('announced');
      });

      await make().deleteUser('target', 'admin', true);

      expect(eventBus.emit).toHaveBeenCalledWith('core.scope-deleted', {
        scopeId: 'target',
      });
      expect(order).toEqual(['committed', 'announced']);
    });

    it('refuses to delete yourself', async () => {
      await expect(make().deleteUser('me', 'me', false)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to delete the last admin', async () => {
      user.findUnique.mockResolvedValue({ id: 'target', isAdmin: true });
      user.count.mockResolvedValue(1);
      await expect(
        make().deleteUser('target', 'admin', true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks a non-forced delete when the user still has data', async () => {
      countDynamic.mockResolvedValue(3);
      await expect(
        make().deleteUser('target', 'admin', false),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.user.delete).not.toHaveBeenCalled();
      expect(attachments.removeFiles).not.toHaveBeenCalled();
    });

    it('force-deletes the user and cascades their rows', async () => {
      countDynamic.mockResolvedValue(5); // has data, but force overrides
      await make().deleteUser('target', 'admin', true);
      // Every direct scoped model is swept by scopeId.
      expect(deleteManyDynamic).toHaveBeenCalledWith(
        'Project',
        { where: { scopeId: 'target' } },
        tx,
      );
      expect(tx.scopeGrant.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ ownerUserId: 'target' }, { granteeUserId: 'target' }] },
      });
      expect(tx.userKeyring.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'target' },
      });
      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'target' } });
      expect(users.invalidate).toHaveBeenCalledWith('target');
      // Only the deleted user's armed DEK is dropped — other sessions stay armed.
      expect(keyring.clearForUser).toHaveBeenCalledWith('target');
    });

    it('removes the attachment binaries after the cascade commits', async () => {
      attachments.collectScopeFilePaths.mockResolvedValue([
        '/uploads/a.png',
        '/uploads/b.png',
      ]);
      await make().deleteUser('target', 'admin', true);
      expect(attachments.collectScopeFilePaths).toHaveBeenCalledWith('target');
      expect(attachments.removeFiles).toHaveBeenCalledWith([
        '/uploads/a.png',
        '/uploads/b.png',
      ]);
    });

    it('keeps the files when the cascade transaction fails', async () => {
      attachments.collectScopeFilePaths.mockResolvedValue(['/uploads/a.png']);
      tx.user.delete.mockRejectedValueOnce(new Error('db down'));
      await expect(
        make().deleteUser('target', 'admin', true),
      ).rejects.toThrow();
      expect(attachments.removeFiles).not.toHaveBeenCalled();
    });
  });

  describe('setAdmin', () => {
    it('refuses to demote yourself', async () => {
      user.findUnique.mockResolvedValue({ id: 'me', isAdmin: true });
      await expect(make().setAdmin('me', false, 'me')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to demote the last admin', async () => {
      user.findUnique.mockResolvedValue({ id: 'target', isAdmin: true });
      user.count.mockResolvedValue(1);
      await expect(
        make().setAdmin('target', false, 'admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('promotes a user and clears their cache', async () => {
      await make().setAdmin('target', true, 'admin');
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'target' },
        data: { isAdmin: true },
      });
      expect(users.invalidate).toHaveBeenCalledWith('target');
    });
  });

  describe('setBlocked', () => {
    it('refuses to block yourself', async () => {
      user.findUnique.mockResolvedValue({ id: 'me', isAdmin: false });
      await expect(make().setBlocked('me', true, 'me')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('blocks a user by stamping blockedAt and drops caches', async () => {
      await make().setBlocked('target', true, 'admin');
      const call = user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'target' });
      expect(call.data.blockedAt).toBeInstanceOf(Date);
      expect(users.invalidate).toHaveBeenCalledWith('target');
      expect(keyring.clearForUser).toHaveBeenCalledWith('target');
    });

    it('unblocks a user by clearing blockedAt', async () => {
      await make().setBlocked('target', false, 'admin');
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'target' },
        data: { blockedAt: null },
      });
    });
  });

  describe('resetPassword', () => {
    it('hashes the new password and updates the row', async () => {
      await make().resetPassword('target', 'newsecret8');
      const call = user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'target' });
      await expect(
        bcrypt.compare('newsecret8', call.data.passwordHash),
      ).resolves.toBe(true);
      expect(users.invalidate).toHaveBeenCalledWith('target');
    });
  });
});
