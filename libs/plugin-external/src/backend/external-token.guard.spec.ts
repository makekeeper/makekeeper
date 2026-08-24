import { ExternalTokenGuard } from './external-token.guard';
import {
  REALTIME_AUTH_CAPABILITY,
  type RealtimeAuthCapability,
  type RealtimeRequestContext,
} from '@makekeeper/plugin-contract';
import type {
  CapabilityRegistryService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { ExecutionContext } from '@nestjs/common';
import type { ExternalTokensService } from './external-tokens.service';
import type { ExternalRegistryService } from './external-registry.service';

interface VerifiedToken {
  pluginId: string;
  class: 'delegated' | 'background-scoped' | 'background-instance';
  userId: string | null;
  scopeId: string | null;
}

interface VerifiedConnection {
  tokenId: string;
  ceiling: 'read-only' | 'read-write' | 'destructive';
  userId: string | null;
  scopeId: string | null;
}

const execCtx = (authorization: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  }) as unknown as ExecutionContext;

describe('ExternalTokenGuard — delegated scope context (#240)', () => {
  const build = (opts: {
    verified: VerifiedToken | null;
    connection?: VerifiedConnection | null;
    capability?: RealtimeAuthCapability | null;
    resolved?: RealtimeRequestContext | null;
  }): { guard: ExternalTokenGuard; assign: jest.Mock } => {
    const assign = jest.fn();
    const tokens = {
      verify: jest.fn().mockResolvedValue(opts.verified),
      verifyConnection: jest.fn().mockResolvedValue(opts.connection ?? null),
    } as unknown as ExternalTokensService;
    const registry = {
      getActive: jest.fn().mockResolvedValue({ grants: [] }),
    } as unknown as ExternalRegistryService;
    const context = { assign } as unknown as RequestContextService;
    const capability =
      opts.capability === undefined
        ? ({
            resolveContext: jest.fn().mockResolvedValue(opts.resolved ?? null),
          } as unknown as RealtimeAuthCapability)
        : opts.capability;
    const capabilities = {
      getCapability: jest.fn((id: string) =>
        id === REALTIME_AUTH_CAPABILITY ? capability : null,
      ),
    } as unknown as CapabilityRegistryService;
    const i18n = { t: (k: string) => k } as unknown as PluginI18nService;
    const guard = new ExternalTokenGuard(
      tokens,
      registry,
      context,
      capabilities,
      i18n,
    );
    return { guard, assign };
  };

  it('resolves the full shared-scope context for a delegated token', async () => {
    const resolved: RealtimeRequestContext = {
      userId: 'user-b',
      isAdmin: false,
      scopeId: 'owner-a',
      accessLevel: 'READ',
      enabledPluginIds: new Set(['inventory']),
      modelConstraints: [{ Project: { id: 'proj-1' } }],
      locale: 'en',
    };
    const { guard, assign } = build({
      verified: {
        pluginId: 'p1',
        class: 'delegated',
        userId: 'user-b',
        scopeId: 'owner-a',
      },
      resolved,
    });

    await expect(guard.canActivate(execCtx('Bearer t'))).resolves.toBe(true);
    // The READ level and the per-resource restriction are carried through, so
    // the scope policy narrows exactly as it would for the user's own request.
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({
        accessLevel: 'READ',
        modelConstraints: [{ Project: { id: 'proj-1' } }],
        enabledPluginIds: resolved.enabledPluginIds,
      }),
    );
  });

  it('never delegates admin authority even when the user is an admin', async () => {
    const { guard, assign } = build({
      verified: {
        pluginId: 'p1',
        class: 'delegated',
        userId: 'admin-u',
        scopeId: 'admin-u',
      },
      resolved: {
        userId: 'admin-u',
        isAdmin: true,
        scopeId: 'admin-u',
        accessLevel: 'OWNER',
      },
    });

    await guard.canActivate(execCtx('Bearer t'));
    expect(assign).toHaveBeenCalledWith(
      expect.objectContaining({ isAdmin: false }),
    );
  });

  it('rejects a delegated token whose grant was revoked (scope fallback)', async () => {
    // The seam mirrors the SPA guard: a revoked grant falls back to the
    // grantee's own scope. For a delegated token that would silently redirect
    // the plugin into the grantee's own data — the guard must deny instead.
    const { guard, assign } = build({
      verified: {
        pluginId: 'p1',
        class: 'delegated',
        userId: 'user-b',
        scopeId: 'owner-a',
      },
      resolved: {
        userId: 'user-b',
        isAdmin: false,
        scopeId: 'user-b',
        accessLevel: 'OWNER',
      },
    });
    await expect(guard.canActivate(execCtx('Bearer t'))).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled();
  });

  it('rejects a delegated token whose user no longer resolves', async () => {
    const { guard } = build({
      verified: {
        pluginId: 'p1',
        class: 'delegated',
        userId: 'ghost',
        scopeId: 'owner-a',
      },
      resolved: null,
    });
    await expect(guard.canActivate(execCtx('Bearer t'))).rejects.toThrow();
  });

  it('falls back to a bare assign when the overlay is disabled (no capability)', async () => {
    const { guard, assign } = build({
      verified: {
        pluginId: 'p1',
        class: 'delegated',
        userId: 'solo',
        scopeId: 'solo',
      },
      capability: null,
    });
    await expect(guard.canActivate(execCtx('Bearer t'))).resolves.toBe(true);
    expect(assign).toHaveBeenCalledWith({
      userId: 'solo',
      scopeId: 'solo',
      isAdmin: false,
      locale: undefined,
    });
  });

  it('leaves a background-scoped token on the bare scope assign', async () => {
    const { guard, assign } = build({
      verified: {
        pluginId: 'p1',
        class: 'background-scoped',
        userId: null,
        scopeId: 'owner-a',
      },
    });
    await guard.canActivate(execCtx('Bearer t'));
    expect(assign).toHaveBeenCalledWith({
      userId: undefined,
      scopeId: 'owner-a',
      isAdmin: false,
      locale: undefined,
    });
  });

  // Connection tokens (#249): the mkt_ prefix routes to the connection table,
  // and the user context resolves through the same seam as a delegated token.
  describe('connection tokens (#249)', () => {
    it('resolves the issuing user context for an mkt_ token', async () => {
      const resolved: RealtimeRequestContext = {
        userId: 'issuer',
        isAdmin: false,
        scopeId: 'issuer',
        accessLevel: 'OWNER',
        locale: 'en',
      };
      const { guard, assign } = build({
        verified: null,
        connection: {
          tokenId: 'tok-1',
          ceiling: 'read-write',
          userId: 'issuer',
          scopeId: 'issuer',
        },
        resolved,
      });
      await expect(guard.canActivate(execCtx('Bearer mkt_x'))).resolves.toBe(
        true,
      );
      expect(assign).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'issuer', isAdmin: false }),
      );
    });

    it('fails closed when the token scope no longer resolves to itself', async () => {
      const { guard, assign } = build({
        verified: null,
        connection: {
          tokenId: 'tok-1',
          ceiling: 'read-only',
          userId: 'user-b',
          scopeId: 'owner-a',
        },
        resolved: {
          userId: 'user-b',
          isAdmin: false,
          scopeId: 'user-b',
          accessLevel: 'OWNER',
        },
      });
      await expect(
        guard.canActivate(execCtx('Bearer mkt_x')),
      ).rejects.toThrow();
      expect(assign).not.toHaveBeenCalled();
    });

    it('bare-assigns a single-user token (no user bound)', async () => {
      const { guard, assign } = build({
        verified: null,
        connection: {
          tokenId: 'tok-1',
          ceiling: 'read-only',
          userId: null,
          scopeId: null,
        },
      });
      await expect(guard.canActivate(execCtx('Bearer mkt_x'))).resolves.toBe(
        true,
      );
      expect(assign).toHaveBeenCalledWith({
        userId: undefined,
        scopeId: undefined,
        isAdmin: false,
        locale: undefined,
      });
    });

    it('rejects an unknown or revoked mkt_ token', async () => {
      const { guard } = build({ verified: null, connection: null });
      await expect(
        guard.canActivate(execCtx('Bearer mkt_x')),
      ).rejects.toThrow();
    });
  });
});
