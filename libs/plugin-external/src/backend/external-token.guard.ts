import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CapabilityRegistryService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  REALTIME_AUTH_CAPABILITY,
  type ExternalAccessClass,
  type RealtimeAuthCapability,
} from '@makekeeper/plugin-contract';
import {
  CONNECTION_TOKEN_PREFIX,
  ExternalTokensService,
} from './external-tokens.service';
import { ExternalRegistryService } from './external-registry.service';
import type { ExternalTokenCeiling } from '../external-types';

// Authenticates a caller of the external surfaces (#135, #249), and — just as
// importantly — installs the request context it may act in.
//
// Two caller kinds share this guard:
//   plugin     — an EXTERNAL PLUGIN calling back into the core with a token
//                the core issued to it (delegated / background classes). Its
//                rights are the plugin's live grant set.
//   connection — an OUTSIDE consumer (an MCP client, a script) presenting a
//                long-lived `mkt_` token issued in the settings UI. Its
//                rights are the acting user's own, clamped by the token's
//                access ceiling — no grant set is involved.
//
// A user-bound token carries the user it was minted for, so the call runs
// through the exact same scope policy as that user's own SPA request: no
// separate authorization path to keep in sync, and no ambient authority.

export type ExternalCaller =
  | {
      kind: 'plugin';
      pluginId: string;
      class: ExternalAccessClass;
      grants: string[];
      scopeId: string | null;
    }
  | {
      kind: 'connection';
      tokenId: string;
      ceiling: ExternalTokenCeiling;
      userId: string | null;
      scopeId: string | null;
    };

// Structural request shape, mirroring MultiuserGuard's — no Express types.
interface IncomingRequestLike {
  headers: Record<string, string | string[] | undefined>;
  externalCaller?: ExternalCaller;
}

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

@Injectable()
export class ExternalTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: ExternalTokensService,
    private readonly registry: ExternalRegistryService,
    private readonly context: RequestContextService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly i18n: PluginI18nService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<IncomingRequestLike>();
    const header = firstHeader(request.headers['authorization']);
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : null;
    const locale = firstHeader(request.headers['x-locale']);
    // One throw site, so every rejection reason reads the same to a caller and
    // no branch can accidentally fall through as authenticated.
    const deny = (): never => {
      throw new UnauthorizedException(
        this.i18n.t('external.errors.badToken', undefined, locale),
      );
    };

    if (!token) return deny();

    // Connection tokens (#249): user-bound, ceiling-clamped, no plugin row.
    if (token.startsWith(CONNECTION_TOKEN_PREFIX)) {
      const verified = await this.tokens.verifyConnection(token);
      if (!verified) return deny();
      request.externalCaller = {
        kind: 'connection',
        tokenId: verified.tokenId,
        ceiling: verified.ceiling,
        userId: verified.userId,
        scopeId: verified.scopeId,
      };
      return this.installContext(
        verified.userId,
        verified.scopeId,
        locale,
        deny,
      );
    }

    const verified = await this.tokens.verify(token);
    if (!verified) return deny();

    // Grants are read live from the plugin row, never carried inside the
    // token: a revoked or narrowed grant must bite immediately, and a token
    // minted before an update must not keep the old powers (decision #15).
    const plugin = await this.registry.getActive(verified.pluginId);
    if (!plugin) return deny();

    request.externalCaller = {
      kind: 'plugin',
      pluginId: verified.pluginId,
      class: verified.class,
      grants: plugin.grants,
      scopeId: verified.scopeId,
    };
    return this.installContext(verified.userId, verified.scopeId, locale, deny);
  }

  // User-bound: act as that user, with their scope — the ordinary policy path.
  // When that user is browsing a SHARED scope, the READ/WRITE level, the
  // per-resource restrictions and the effective plugin set live in the
  // multiuser overlay; a bare {userId, scopeId} assign would drop them and let
  // the caller read/write past a READ or restricted grant (#240). Resolve the
  // full context through the same seam the realtime gateway uses, so the call
  // is scoped exactly like the user's own request. Admin authority is never
  // delegated — a token acts as the user's data, not their role — so isAdmin
  // stays false regardless of the user's own flag.
  private async installContext(
    userId: string | null,
    scopeId: string | null,
    locale: string | undefined,
    deny: () => never,
  ): Promise<boolean> {
    if (userId) {
      const auth = this.capabilities.getCapability<RealtimeAuthCapability>(
        REALTIME_AUTH_CAPABILITY,
      );
      if (auth) {
        const resolved = await auth.resolveContext(
          userId,
          scopeId ?? undefined,
          locale,
        );
        if (!resolved) return deny();
        // The seam mirrors the SPA guard, where a revoked grant FALLS BACK to
        // the user's own scope. For a token-authenticated caller that fallback
        // would be a silent redirect: a token minted for owner A's scope would
        // start acting in the grantee's own data. A token cannot renegotiate
        // its scope mid-flight, so fail closed instead — the resolved scope
        // must be exactly the one the token was minted for.
        if (scopeId && resolved.scopeId !== scopeId) {
          return deny();
        }
        this.context.assign({ ...resolved, isAdmin: false });
        return true;
      }
    }

    // Background-scoped: act inside one scope with no user identity.
    // Background-instance: no scope at all; the instance surface is the only
    // thing reachable, and it aggregates rather than reading records.
    // Also the fallback when the overlay is disabled (no capability): a
    // single-user instance has no shared scopes to constrain.
    this.context.assign({
      userId: userId ?? undefined,
      scopeId: scopeId ?? undefined,
      isAdmin: false,
      locale,
    });
    return true;
  }
}

// Reads the caller the guard attached. Kept here so controllers never poke at
// the raw request object shape.
export const externalCallerOf = (request: unknown): ExternalCaller => {
  const caller = (request as IncomingRequestLike | undefined)?.externalCaller;
  if (!caller) throw new UnauthorizedException();
  return caller;
};
