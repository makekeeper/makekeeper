import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  AttachmentStorageService,
  KeyringService,
  PluginEventBusService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  AdminUserSummary,
  CORE_SCOPE_DELETED_EVENT,
  type CoreScopeDeletedEvent,
} from '@makekeeper/plugin-contract';
import {
  DIRECT_SCOPED_MODELS,
  SCOPE_SHARED_DIRECT_MODELS,
} from './scope-model-map';
import { UsersService } from './users.service';
import { GrantsService } from './grants.service';
import { UserPluginService } from './user-plugin.service';

const BCRYPT_ROUNDS = 10;

// Admin user management: the read directory plus the mutating actions (role,
// block, password reset, delete). Every mutation runs under a system-bypass
// frame — the admin acts on OTHER users' rows, which the active-scope policy
// would otherwise confine to the admin's own scope. Self- and last-admin
// guards keep the instance from locking itself out of administration.
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
    private readonly users: UsersService,
    private readonly grants: GrantsService,
    private readonly userPlugins: UserPluginService,
    private readonly keyring: KeyringService,
    private readonly attachments: AttachmentStorageService,
    private readonly eventBus: PluginEventBusService,
  ) {}

  async listUsers(): Promise<AdminUserSummary[]> {
    return this.requestContext.runWithoutScope('admin-cross-user', async () => {
      const users = await this.prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
      });
      const summaries: AdminUserSummary[] = [];
      for (const user of users) {
        const where = { where: { scopeId: user.id } };
        // Count each scope-shared model generically from the registry, so a new
        // plugin's data appears here without editing this service.
        const [modelCounts, grantsGiven, grantsReceived] = await Promise.all([
          Promise.all(
            SCOPE_SHARED_DIRECT_MODELS.map((model) =>
              this.prisma.countDynamic(model, where),
            ),
          ),
          this.prisma.scopeGrant.count({ where: { ownerUserId: user.id } }),
          this.prisma.scopeGrant.count({ where: { granteeUserId: user.id } }),
        ]);
        const models: Record<string, number> = {};
        SCOPE_SHARED_DIRECT_MODELS.forEach((model, i) => {
          models[model] = modelCounts[i];
        });
        summaries.push({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt.toISOString(),
          isBlocked: user.blockedAt !== null,
          counts: { models, grantsGiven, grantsReceived },
        });
      }
      return summaries;
    });
  }

  // Promote/demote an account. Demotion is guarded so administration cannot be
  // lost: the caller cannot demote themselves, nor remove the last admin.
  async setAdmin(
    targetId: string,
    isAdmin: boolean,
    actorId: string,
    locale?: string,
  ): Promise<void> {
    await this.requestContext.runWithoutScope('admin-cross-user', async () => {
      const target = await this.requireUser(targetId, locale);
      if (!isAdmin) {
        if (targetId === actorId) {
          throw new ForbiddenException(this.t('cannotDemoteSelf', locale));
        }
        if (target.isAdmin) await this.assertNotLastAdmin(locale);
      }
      await this.prisma.user.update({
        where: { id: targetId },
        data: { isAdmin },
      });
    });
    this.users.invalidate(targetId);
  }

  // Block (or unblock) an account. `blockedAt` gates both login and the guard,
  // so blocking severs a live session on its next request once the cache clears.
  async setBlocked(
    targetId: string,
    blocked: boolean,
    actorId: string,
    locale?: string,
  ): Promise<void> {
    await this.requestContext.runWithoutScope('admin-cross-user', async () => {
      const target = await this.requireUser(targetId, locale);
      if (blocked) {
        if (targetId === actorId) {
          throw new ForbiddenException(this.t('cannotBlockSelf', locale));
        }
        if (target.isAdmin) await this.assertNotLastAdmin(locale);
      }
      await this.prisma.user.update({
        where: { id: targetId },
        data: { blockedAt: blocked ? new Date() : null },
      });
    });
    // Drop the cached row so the guard re-reads the new state at once, and the
    // target's armed DEK so a blocked user's secrets do not stay unlocked in
    // memory. Other users' armed keys are untouched.
    this.users.invalidate(targetId);
    this.keyring.clearForUser(targetId);
  }

  // Admin password reset. Only the hash changes; the user's data-encryption key
  // re-provisions on their next login (the keyring unlock→provision fallback),
  // so previously-encrypted personal secrets become inaccessible — expected.
  async resetPassword(
    targetId: string,
    newPassword: string,
    locale?: string,
  ): Promise<void> {
    await this.requestContext.runWithoutScope('admin-cross-user', async () => {
      await this.requireUser(targetId, locale);
      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      // Bump the token epoch alongside the hash so every JWT the target already
      // holds is invalidated — a reset now actually evicts a live/stolen
      // session, not just changes the next login's password (#241).
      await this.prisma.user.update({
        where: { id: targetId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
    });
    this.users.invalidate(targetId);
  }

  // Delete an account. Blocked when the user still owns any data or shares,
  // unless `force` is set — then every row the user owns is cascade-deleted.
  // Self- and last-admin deletion are always refused.
  async deleteUser(
    targetId: string,
    actorId: string,
    force: boolean,
    locale?: string,
  ): Promise<void> {
    await this.requestContext.runWithoutScope('admin-cross-user', async () => {
      if (targetId === actorId) {
        throw new ForbiddenException(this.t('cannotDeleteSelf', locale));
      }
      const target = await this.requireUser(targetId, locale);
      if (target.isAdmin) await this.assertNotLastAdmin(locale);

      if (!force && (await this.dataFootprint(targetId)) > 0) {
        throw new ConflictException(this.t('userHasData', locale));
      }

      // Attachment binaries live outside the DB; capture their on-disk paths
      // before the cascade removes the rows, remove the files only after the
      // transaction commits — a rolled-back delete must not orphan rows whose
      // files are already gone.
      const attachmentPaths =
        await this.attachments.collectScopeFilePaths(targetId);

      await this.prisma.$transaction(async (tx) => {
        // Every scoped model carries the owner's id in `scopeId`; deleting those
        // rows cascades their child rows (Task, ProjectComponent, chat messages,
        // …) via the schema's onDelete: Cascade FKs. Cross-direct FKs are
        // SetNull, so order is irrelevant.
        for (const model of DIRECT_SCOPED_MODELS) {
          await this.prisma.deleteManyDynamic(
            model,
            { where: { scopeId: targetId } },
            tx,
          );
        }
        // The user's non-scoped rows: shares (either direction), per-user plugin
        // overrides, and the encryption keyring / session re-arm tokens.
        await tx.scopeGrant.deleteMany({
          where: {
            OR: [{ ownerUserId: targetId }, { granteeUserId: targetId }],
          },
        });
        await tx.userPluginConfig.deleteMany({ where: { userId: targetId } });
        await tx.userKeyring.deleteMany({ where: { userId: targetId } });
        await tx.keySession.deleteMany({ where: { userId: targetId } });
        await tx.user.delete({ where: { id: targetId } });
      });

      await this.attachments.removeFiles(attachmentPaths);

      // The scope is gone. Anything holding data keyed by it — including
      // third-party containers, whose storage the core cannot reach into —
      // hears about it here, and only here.
      //
      // AFTER the commit, like the attachment files above: a rolled-back
      // delete must not tell listeners to destroy data that still exists.
      //
      // The stronger form — writing the outbox row INSIDE this transaction and
      // leaving delivery to the drain worker — loses nothing on a crash and is
      // what #188 asked for. It needs a transaction handle threaded through
      // PluginEventBusService into the host's outbox, which is a change to the
      // inter-plugin bus rather than to this delete; deferred to #189. Until
      // then a crash between the commit and the outbox row leaves a deleted
      // scope's rows with a subscriber, cleanable only by uninstall-with-purge.
      await this.eventBus.emit<CoreScopeDeletedEvent>(
        CORE_SCOPE_DELETED_EVENT,
        {
          scopeId: targetId,
        },
      );
    });
    // Purge every cache that could still resolve the deleted user or its grants.
    this.users.invalidate(targetId);
    this.grants.clearCaches();
    this.userPlugins.clearCaches();
    this.keyring.clearForUser(targetId);
  }

  // Any owned data or share blocks a non-forced delete. Counts ALL direct
  // scoped models (shared and user-private) plus grants in either direction.
  private async dataFootprint(userId: string): Promise<number> {
    const where = { where: { scopeId: userId } };
    const [modelCounts, grantsGiven, grantsReceived] = await Promise.all([
      Promise.all(
        DIRECT_SCOPED_MODELS.map((model) =>
          this.prisma.countDynamic(model, where),
        ),
      ),
      this.prisma.scopeGrant.count({ where: { ownerUserId: userId } }),
      this.prisma.scopeGrant.count({ where: { granteeUserId: userId } }),
    ]);
    return (
      modelCounts.reduce((sum, n) => sum + n, 0) + grantsGiven + grantsReceived
    );
  }

  private async requireUser(
    id: string,
    locale?: string,
  ): Promise<{ id: string; isAdmin: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(this.t('unknownUser', locale));
    }
    return user;
  }

  // 403, not 409: the delete flow reserves Conflict for "the user still has
  // data" — the one refusal the client escalates into the force-delete dialog.
  private async assertNotLastAdmin(locale?: string): Promise<void> {
    const admins = await this.prisma.user.count({ where: { isAdmin: true } });
    if (admins <= 1) {
      throw new ForbiddenException(this.t('lastAdmin', locale));
    }
  }

  private t(key: string, locale?: string): string {
    return this.i18n.t(`multiuser.errors.${key}`, undefined, locale);
  }
}
