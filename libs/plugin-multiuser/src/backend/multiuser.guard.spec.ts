import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ADMIN_ONLY_KEY,
  IS_PUBLIC_KEY,
  PLUGIN_OWNER_KEY,
  PluginConfigService,
  PluginI18nService,
  PluginRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import { DeviceAuthService } from '@makekeeper/backend-core';
import { MultiuserGuard } from './multiuser.guard';
import { AuthTokenService } from './auth-token.service';
import { KeyringSessionService } from './keyring-session.service';
import { UsersService } from './users.service';
import { GrantsService } from './grants.service';
import { UserPluginService } from './user-plugin.service';
import { RestrictionConstraintService } from './restriction-constraint.service';
import { MultiuserSettingsService } from './multiuser-settings.service';

describe('MultiuserGuard', () => {
  let guard: MultiuserGuard;
  let requestContext: RequestContextService;

  const pluginEnabled = jest.fn();
  const verify = jest.fn();
  const getById = jest.fn();
  const findActive = jest.fn();
  const effectiveSet = jest.fn();
  const buildForGrant = jest.fn();
  const resolveDeviceToken = jest.fn();
  // Per-test route metadata: [isPublic, pluginOwner, adminOnly].
  let metadata: Record<string, unknown>;

  beforeEach(async () => {
    metadata = {};
    pluginEnabled.mockReset().mockReturnValue(true);
    verify.mockReset().mockReturnValue({ userId: 'u1', tokenVersion: 0 });
    getById.mockReset().mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isAdmin: false,
      tokenVersion: 0,
    });
    findActive.mockReset().mockResolvedValue(null);
    effectiveSet
      .mockReset()
      .mockResolvedValue(new Set(['projects', 'multiuser', 'settings']));
    buildForGrant.mockReset().mockResolvedValue([]);
    resolveDeviceToken.mockReset().mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MultiuserGuard,
        RequestContextService,
        PluginI18nService,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn((key: string) => metadata[key]),
          },
        },
        {
          provide: PluginConfigService,
          useValue: { isEnabled: pluginEnabled },
        },
        {
          provide: PluginRegistryService,
          useValue: {
            // Only the chat plugin declares user-private mutations here.
            getPlugin: (id: string) =>
              id === 'chat' ? { id, readOnlyScopeExempt: true } : undefined,
          },
        },
        { provide: AuthTokenService, useValue: { verify } },
        {
          provide: DeviceAuthService,
          useValue: { resolveToken: resolveDeviceToken },
        },
        {
          provide: KeyringSessionService,
          useValue: {
            rearmFromSessionKey: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersService,
          useValue: {
            getById,
            // Mirrors the real resolver: row + matching epoch, else null.
            getByCurrentToken: (decoded: {
              userId: string;
              tokenVersion: number;
            }) =>
              getById(decoded.userId).then(
                (user: { tokenVersion: number } | null) =>
                  user && user.tokenVersion === decoded.tokenVersion
                    ? user
                    : null,
              ),
          },
        },
        { provide: GrantsService, useValue: { findActive } },
        { provide: UserPluginService, useValue: { effectiveSet } },
        { provide: RestrictionConstraintService, useValue: { buildForGrant } },
        {
          provide: MultiuserSettingsService,
          useValue: {
            get: () =>
              Promise.resolve({
                allowRegistration: true,
                allowPersonalProviders: false,
              }),
          },
        },
      ],
    }).compile();
    guard = moduleRef.get(MultiuserGuard);
    requestContext = moduleRef.get(RequestContextService);
  });

  // ExecutionContext's generic getters cannot be implemented structurally in a
  // unit test — this is the standard type-erased test-double boundary.
  const executionContext = (
    method = 'GET',
    headers: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
      getHandler: () => jest.fn(),
      getClass: () => MultiuserGuard,
    }) as unknown as ExecutionContext;

  const activate = (
    method = 'GET',
    headers: Record<string, string> = {},
  ): Promise<boolean> =>
    requestContext.run({}, () =>
      guard.canActivate(executionContext(method, headers)),
    );

  it('passes everything through while the plugin is disabled', async () => {
    pluginEnabled.mockReturnValue(false);
    await expect(activate('POST')).resolves.toBe(true);
    expect(requestContext.get()?.userId).toBeUndefined();
  });

  it('admits @Public routes without a token', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(activate()).resolves.toBe(true);
  });

  it('still populates context for an authenticated caller on a @Public route', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await requestContext.run({}, async () => {
      await guard.canActivate(
        executionContext('GET', { authorization: 'Bearer t' }),
      );
      expect(requestContext.get()?.enabledPluginIds).toBeDefined();
    });
  });

  it('401s without a valid bearer token', async () => {
    await expect(activate()).rejects.toBeInstanceOf(UnauthorizedException);
    verify.mockReturnValue(null);
    await expect(
      activate('GET', { authorization: 'Bearer bad' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('populates the request context for the own scope (OWNER)', async () => {
    await requestContext.run({}, async () => {
      await guard.canActivate(
        executionContext('GET', { authorization: 'Bearer t' }),
      );
      expect(requestContext.get()).toMatchObject({
        userId: 'u1',
        scopeId: 'u1',
        accessLevel: 'OWNER',
      });
    });
    expect(effectiveSet).toHaveBeenCalledWith('u1', null);
  });

  it('403s a foreign scope without a grant', async () => {
    await expect(
      activate('GET', { authorization: 'Bearer t', 'x-scope-id': 'u2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adopts a READ grant and blocks mutations on other plugins routes', async () => {
    findActive.mockResolvedValue({
      id: 'g1',
      ownerUserId: 'u2',
      granteeUserId: 'u1',
      accessLevel: 'READ',
      allowedPluginIds: '["projects"]',
      resourceRestrictions: '{}',
      updatedAt: new Date(),
    });
    metadata[PLUGIN_OWNER_KEY] = 'projects';
    await expect(
      activate('GET', { authorization: 'Bearer t', 'x-scope-id': 'u2' }),
    ).resolves.toBe(true);
    await expect(
      activate('POST', { authorization: 'Bearer t', 'x-scope-id': 'u2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The multiuser plugin's own management routes act on the caller.
    metadata[PLUGIN_OWNER_KEY] = 'multiuser';
    await expect(
      activate('POST', { authorization: 'Bearer t', 'x-scope-id': 'u2' }),
    ).resolves.toBe(true);
    // Plugins with readOnlyScopeExempt (chat) mutate only user-private data.
    effectiveSet.mockResolvedValue(new Set(['projects', 'multiuser', 'chat']));
    metadata[PLUGIN_OWNER_KEY] = 'chat';
    await expect(
      activate('POST', { authorization: 'Bearer t', 'x-scope-id': 'u2' }),
    ).resolves.toBe(true);
  });

  it('403s a blocked account on a protected route', async () => {
    getById.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isAdmin: false,
      tokenVersion: 0,
      blockedAt: new Date(),
    });
    await expect(
      activate('GET', { authorization: 'Bearer t' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats a blocked account as anonymous on a @Public route', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    getById.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isAdmin: false,
      tokenVersion: 0,
      blockedAt: new Date(),
    });
    await requestContext.run({}, async () => {
      await expect(
        guard.canActivate(
          executionContext('GET', { authorization: 'Bearer t' }),
        ),
      ).resolves.toBe(true);
      // No user context is populated for the blocked caller.
      expect(requestContext.get()?.userId).toBeUndefined();
    });
  });

  it('401s a JWT whose epoch is stale (revoked by logout / password reset)', async () => {
    // Token was minted at version 0; the user row has since been bumped to 1.
    getById.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isAdmin: false,
      tokenVersion: 1,
    });
    await expect(
      activate('GET', { authorization: 'Bearer t' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still accepts a device token (no epoch) when the JWT parse fails', async () => {
    verify.mockReturnValue(null);
    resolveDeviceToken.mockResolvedValue({ userId: 'u1' });
    await expect(
      activate('GET', { authorization: 'Bearer devicetoken' }),
    ).resolves.toBe(true);
  });

  it('404s routes of plugins outside the effective set', async () => {
    metadata[PLUGIN_OWNER_KEY] = 'logistics';
    await expect(
      activate('GET', { authorization: 'Bearer t' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s @AdminOnly routes for non-admins and admits admins', async () => {
    metadata[ADMIN_ONLY_KEY] = true;
    await expect(
      activate('GET', { authorization: 'Bearer t' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    getById.mockResolvedValue({
      id: 'u1',
      username: 'root',
      isAdmin: true,
      tokenVersion: 0,
    });
    await expect(activate('GET', { authorization: 'Bearer t' })).resolves.toBe(
      true,
    );
  });

  // #123: the credential `<img src>` and the drag-out download can present.
  // Two credential shapes, one authorization model (#199).
  describe('paired device token', () => {
    it('authenticates as the user the device was paired by', async () => {
      verify.mockReturnValue(null);
      resolveDeviceToken.mockResolvedValue({ deviceId: 'd1', userId: 'u1' });

      await requestContext.run({}, async () => {
        await guard.canActivate(
          executionContext('GET', { authorization: 'Bearer device-token' }),
        );
        expect(requestContext.get()?.userId).toBe('u1');
      });
      expect(resolveDeviceToken).toHaveBeenCalledWith('device-token');
    });

    // A device paired before the overlay was turned on has nobody to be, and
    // must not silently act as somebody.
    it('401s an unbound device while the overlay is on', async () => {
      verify.mockReturnValue(null);
      resolveDeviceToken.mockResolvedValue({ deviceId: 'd1', userId: null });

      await expect(
        activate('GET', { authorization: 'Bearer device-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('is not consulted when the JWT already resolved', async () => {
      await activate('GET', { authorization: 'Bearer jwt' });
      expect(resolveDeviceToken).not.toHaveBeenCalled();
    });
  });

  describe('session cookie', () => {
    it('authenticates a read', async () => {
      await requestContext.run({}, async () => {
        await guard.canActivate(
          executionContext('GET', { cookie: 'other=x; mk_session=t' }),
        );
        expect(requestContext.get()?.userId).toBe('u1');
      });
      expect(verify).toHaveBeenCalledWith('t');
    });

    // It travels automatically, so honouring it on a mutation would turn every
    // state-changing route into a CSRF target.
    it('is ignored on a mutation', async () => {
      await expect(
        activate('POST', { cookie: 'mk_session=t' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('loses to an Authorization header when both are present', async () => {
      await activate('GET', {
        authorization: 'Bearer header-token',
        cookie: 'mk_session=cookie-token',
      });
      expect(verify).toHaveBeenCalledWith('header-token');
      expect(verify).not.toHaveBeenCalledWith('cookie-token');
    });
  });
});
