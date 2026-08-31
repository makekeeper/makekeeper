import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_ONLY_KEY,
  IS_PUBLIC_KEY,
  PLUGIN_OWNER_KEY,
  PluginConfigService,
  PluginI18nService,
  PluginRegistryService,
  RequestContextService,
  DeviceAuthService,
} from '@makekeeper/backend-core';
import { ModelConstraintMap, ScopeAccess } from '@makekeeper/plugin-contract';
import { multiuserManifest } from '../manifest';
import { AuthTokenService } from './auth-token.service';
import { KeyringSessionService } from './keyring-session.service';
import { UsersService } from './users.service';
import { GrantsService } from './grants.service';
import { UserPluginService } from './user-plugin.service';
import { RestrictionConstraintService } from './restriction-constraint.service';
import { extractSessionCookie } from './session-cookie';

// The request shape this guard reads. Structural on purpose — no Express type
// dependency, mirroring AppConfigService's RequestHeadersLike.
interface IncomingRequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

// The one thing this guard writes back: the rotated re-arm key (#243).
interface OutgoingResponseLike {
  setHeader(name: string, value: string): void;
}

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

// The bearer token as it arrives on the wire. Exported because AuthController
// needs the very same string to mint the session cookie (#123) — the request
// context carries the resolved user, not the credential it came from, so
// without this the parse would exist in two places and could drift apart.
export function extractBearerToken(
  header: string | string[] | undefined,
): string | null {
  const value = firstHeader(header);
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length).trim() || null;
}

// HTTP methods a READ-level grant may use against another plugin's routes.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The multiuser overlay's global guard — the "proxy" that turns authentication
// and scope access into request context. Registered as APP_GUARD by the plugin
// module; Nest runs it before the root-level PluginEnabledGuard. When the
// plugin is disabled it passes every request through untouched, restoring
// exact single-user behavior.
@Injectable()
export class MultiuserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly pluginConfig: PluginConfigService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly tokens: AuthTokenService,
    private readonly keyringSession: KeyringSessionService,
    private readonly users: UsersService,
    private readonly grants: GrantsService,
    private readonly userPlugins: UserPluginService,
    private readonly constraints: RestrictionConstraintService,
    private readonly requestContext: RequestContextService,
    private readonly devices: DeviceAuthService,
    private readonly i18n: PluginI18nService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.pluginConfig.isEnabled(multiuserManifest.id)) return true;

    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(
        IS_PUBLIC_KEY,
        targets,
      ) === true;

    const request = context.switchToHttp().getRequest<IncomingRequestLike>();
    const locale = firstHeader(request.headers['x-locale']);

    const token =
      extractBearerToken(request.headers['authorization']) ??
      this.extractCookie(request);
    // Two credential shapes, one authorization model (#199): a JWT from the
    // browser, or a paired phone's long-lived device token. The device token is
    // only consulted when the JWT parse fails, so the common path costs nothing
    // extra; a device paired while the overlay was on carries the identity of
    // the user who paired it, and one paired before it was turned on has no
    // user to be — it authenticates the phone, not a person, and is refused
    // here rather than silently acting as somebody. A decodable JWT resolves
    // through the shared epoch-checked path (#241): a token issued before a
    // logout or password reset bumped the row — even a captured one — reads as
    // anonymous here on the very next request. Device tokens carry no epoch
    // (they have their own revokedAt).
    const decoded = token ? this.tokens.verify(token) : null;
    let user = decoded ? await this.users.getByCurrentToken(decoded) : null;
    // Which device answered, when one did — carried into the context below so a
    // revoke can find what this device created (#311).
    let deviceId: string | undefined;
    if (!decoded && token) {
      const device = await this.devices.resolveToken(token);
      deviceId = device?.deviceId;
      user = device?.userId ? await this.users.getById(device.userId) : null;
    }
    // A blocked account is rejected outright on protected routes and treated as
    // anonymous on public ones — severing a live session on its next request
    // (the users cache is invalidated at block time, so this reads fresh).
    if (user?.blockedAt) {
      if (!isPublic) {
        throw new ForbiddenException(
          this.i18n.t('multiuser.errors.accountBlocked', undefined, locale),
        );
      }
      user = null;
    }
    if (!user) {
      // Public routes never reject — but an authenticated caller on a public
      // route (e.g. GET /plugins) still gets a populated context below, so
      // effective per-user state applies there too.
      if (isPublic) return true;
      throw new UnauthorizedException(
        this.i18n.t('multiuser.errors.unauthorized', undefined, locale),
      );
    }

    // Re-arm the user's encryption key after a server restart, transparently,
    // from the client-held session key (#63). No-op once armed; a missing/stale
    // key just leaves personal secrets locked until the next login. A
    // successful re-arm consumes the presented key (#243) — the replacement is
    // echoed on the response for the client to store.
    const sessionKey = firstHeader(request.headers['x-session-key']);
    if (sessionKey) {
      const rotated = await this.keyringSession.rearmFromSessionKey(
        user.id,
        sessionKey,
      );
      if (rotated) {
        context
          .switchToHttp()
          .getResponse<OutgoingResponseLike>()
          .setHeader('x-session-key', rotated);
      }
    }

    let scopeId = firstHeader(request.headers['x-scope-id']) || user.id;
    let accessLevel: ScopeAccess = 'OWNER';
    let grantAllowedPluginIds: string[] | null = null;
    let modelConstraints: ModelConstraintMap[] = [];
    if (scopeId !== user.id) {
      const grant = await this.grants.findActive(scopeId, user.id);
      if (!grant) {
        if (isPublic) {
          // Best-effort on public routes: a stale scope falls back to own.
          scopeId = user.id;
        } else {
          throw new ForbiddenException(
            this.i18n.t('multiuser.errors.forbiddenScope', undefined, locale),
          );
        }
      } else {
        accessLevel = grant.accessLevel === 'WRITE' ? 'WRITE' : 'READ';
        grantAllowedPluginIds = this.parsePluginIds(grant.allowedPluginIds);
        modelConstraints = await this.constraints.buildForGrant(grant);
      }
    }

    const enabledPluginIds = await this.userPlugins.effectiveSet(
      user.id,
      grantAllowedPluginIds,
    );

    this.requestContext.assign({
      userId: user.id,
      isAdmin: user.isAdmin,
      scopeId,
      accessLevel,
      enabledPluginIds,
      modelConstraints,
      locale,
      deviceId,
    });

    if (isPublic) return true;

    const pluginId = this.reflector.getAllAndOverride<string | undefined>(
      PLUGIN_OWNER_KEY,
      targets,
    );
    // Same semantics as instance-level disable: a plugin outside the user's
    // effective set behaves as if it isn't there.
    if (pluginId && !enabledPluginIds.has(pluginId)) {
      throw new NotFoundException(
        this.i18n.t('core.errors.pluginDisabled', { pluginId }, locale),
      );
    }

    if (
      this.reflector.getAllAndOverride<boolean | undefined>(
        ADMIN_ONLY_KEY,
        targets,
      ) &&
      !user.isAdmin
    ) {
      throw new ForbiddenException(
        this.i18n.t('multiuser.errors.adminOnly', undefined, locale),
      );
    }

    // A READ grant blocks mutations of the shared scope's data at the HTTP
    // layer. Exempt: the multiuser plugin's own management routes (they act on
    // the caller — their grants, their plugin set) and plugins whose manifest
    // declares `readOnlyScopeExempt` (their mutations touch only user-private
    // data, e.g. chat sessions). The DB policy independently protects the
    // shared scope's data either way.
    if (
      accessLevel === 'READ' &&
      !READ_METHODS.has(request.method.toUpperCase()) &&
      pluginId !== undefined &&
      pluginId !== multiuserManifest.id &&
      this.pluginRegistry.getPlugin(pluginId)?.readOnlyScopeExempt !== true
    ) {
      throw new ForbiddenException(
        this.i18n.t('multiuser.errors.readOnlyScope', undefined, locale),
      );
    }

    return true;
  }

  // The session cookie (#123) — the only credential `<img :src>` and the
  // browser's drag-out download can present. Honoured on safe methods only:
  // unlike the bearer token it rides along automatically, so accepting it on a
  // mutation would make every state-changing route a CSRF target. The cookie's
  // Path already keeps it away from those routes; this is the second lock.
  private extractCookie(request: IncomingRequestLike): string | null {
    if (!READ_METHODS.has(request.method.toUpperCase())) return null;
    return extractSessionCookie(request.headers['cookie']);
  }

  private parsePluginIds(raw: string): string[] {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
