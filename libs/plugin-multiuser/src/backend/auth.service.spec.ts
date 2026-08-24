import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PluginI18nService, PrismaService } from '@makekeeper/backend-core';
import { DeviceAuthService } from '@makekeeper/backend-core';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { KeyringSessionService } from './keyring-session.service';
import { UsersService } from './users.service';
import { BackfillService } from './backfill.service';
import { MultiuserSettingsService } from './multiuser-settings.service';

describe('AuthService', () => {
  let service: AuthService;

  const txUser = {
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  };
  const tx = { $executeRaw: jest.fn(), user: txUser };
  const rootUser = { findUnique: jest.fn(), count: jest.fn() };
  const claimOrphans = jest.fn();
  const getSettings = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    txUser.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ createdAt: new Date(), ...args.data }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PluginI18nService,
        {
          provide: PrismaService,
          useValue: {
            user: rootUser,
            $transaction: (fn: (client: typeof tx) => Promise<unknown>) =>
              fn(tx),
          },
        },
        { provide: AuthTokenService, useValue: { sign: () => 'token' } },
        {
          provide: KeyringSessionService,
          useValue: {
            provision: jest.fn().mockResolvedValue('ks_1:secret'),
            unlock: jest.fn().mockResolvedValue('ks_1:secret'),
          },
        },
        {
          provide: UsersService,
          useValue: {
            toPublic: (user: {
              id: string;
              username: string;
              displayName: string | null;
              isAdmin: boolean;
            }) => user,
            getById: jest.fn(),
          },
        },
        { provide: BackfillService, useValue: { claimOrphans } },
        { provide: MultiuserSettingsService, useValue: { get: getSettings } },
        // Both credential shapes reach getStatus (#199); this spec exercises the
        // JWT half, so the device resolver simply never matches.
        {
          provide: DeviceAuthService,
          useValue: { resolveToken: () => Promise.resolve(null) },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    getSettings.mockResolvedValue({ allowRegistration: true });
  });

  it('makes the first registered user an admin and claims orphan rows', async () => {
    txUser.findUnique.mockResolvedValue(null);
    txUser.count.mockResolvedValue(0);
    const result = await service.register({
      username: 'root',
      password: 'secret123',
    });
    expect(txUser.create.mock.calls[0][0].data.isAdmin).toBe(true);
    expect(claimOrphans).toHaveBeenCalledTimes(1);
    expect(result.token).toBe('token');
  });

  it('registers later users as regular accounts without backfill', async () => {
    txUser.findUnique.mockResolvedValue(null);
    txUser.count.mockResolvedValue(1);
    await service.register({ username: 'bob', password: 'secret123' });
    expect(txUser.create.mock.calls[0][0].data.isAdmin).toBe(false);
    expect(claimOrphans).not.toHaveBeenCalled();
  });

  it('closes self-registration via the admin setting (first account exempt)', async () => {
    getSettings.mockResolvedValue({ allowRegistration: false });
    txUser.findUnique.mockResolvedValue(null);
    txUser.count.mockResolvedValue(1);
    await expect(
      service.register({ username: 'eve', password: 'secret123' }),
    ).rejects.toMatchObject({ status: 403 });
    txUser.count.mockResolvedValue(0);
    await expect(
      service.register({ username: 'root', password: 'secret123' }),
    ).resolves.toMatchObject({ token: 'token' });
  });

  it('rejects a taken username', async () => {
    txUser.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(
      service.register({ username: 'root', password: 'secret123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a wrong password and admits the right one', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    rootUser.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'root',
      displayName: null,
      isAdmin: true,
      passwordHash,
    });
    await expect(
      service.login({ username: 'root', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const result = await service.login({
      username: 'root',
      password: 'correct-horse',
    });
    expect(result.user.username).toBe('root');
  });

  it('rejects unknown users on login', async () => {
    rootUser.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ username: 'ghost', password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses login for a blocked account despite valid credentials', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    rootUser.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'root',
      displayName: null,
      isAdmin: false,
      passwordHash,
      blockedAt: new Date(),
    });
    await expect(
      service.login({ username: 'root', password: 'correct-horse' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
