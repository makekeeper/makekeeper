import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import {
  AgentRegistryModule,
  AgentRegistryService,
  AttachmentStorageModule,
  CapabilityRegistryService,
  DbAccessPolicyHolder,
  ExchangeRegistryService,
  KeyringService,
  LoginThrottleGuard,
  PluginConfigService,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  ModelConstraintMap,
  PermissionLevel,
  REALTIME_AUTH_CAPABILITY,
  RealtimeAuthCapability,
  SCOPE_DIRECTORY_CAPABILITY,
  ScopeDirectoryCapability,
  RealtimeRequestContext,
  ScopeAccess,
} from '@makekeeper/plugin-contract';
import { toolIsAccessible } from './tool-access';
import { multiuserManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { AuthTokenService } from './auth-token.service';
import { KeyringSessionService } from './keyring-session.service';
import { createMultiuserExchangeProviders } from './multiuser.exchange';
import { UsersService } from './users.service';
import { AuthService } from './auth.service';
import { BackfillService } from './backfill.service';
import { GrantsService } from './grants.service';
import { UserPluginService } from './user-plugin.service';
import { RestrictionConstraintService } from './restriction-constraint.service';
import { ScopePolicyService } from './scope-policy.service';
import { UsersAdminService } from './users-admin.service';
import { MultiuserSettingsService } from './multiuser-settings.service';
import { MultiuserSettingsController } from './multiuser-settings.controller';
import { MultiuserGuard } from './multiuser.guard';
import { AuthController } from './auth.controller';
import { GrantsController } from './grants.controller';
import { MyPluginsController } from './my-plugins.controller';
import { UsersAdminController } from './users-admin.controller';

// The multi-user overlay. Everything it enforces flows through the neutral
// backend-core seams (request context, DB access policy, tool access policy),
// which pass through untouched while the plugin is disabled — so installing
// this module changes nothing until the admin flips the plugin on.
@Module({
  imports: [
    AgentRegistryModule,
    AttachmentStorageModule,
    JwtModule.register({}),
  ],
  controllers: [
    AuthController,
    GrantsController,
    MyPluginsController,
    UsersAdminController,
    MultiuserSettingsController,
  ],
  providers: [
    AuthTokenService,
    KeyringSessionService,
    UsersService,
    AuthService,
    BackfillService,
    GrantsService,
    UserPluginService,
    RestrictionConstraintService,
    ScopePolicyService,
    UsersAdminService,
    MultiuserSettingsService,
    LoginThrottleGuard,
    { provide: APP_GUARD, useClass: MultiuserGuard },
  ],
})
export class MultiuserPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly pluginConfig: PluginConfigService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly dbPolicyHolder: DbAccessPolicyHolder,
    private readonly requestContext: RequestContextService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly backfill: BackfillService,
    private readonly users: UsersService,
    private readonly grants: GrantsService,
    private readonly userPlugins: UserPluginService,
    private readonly settings: MultiuserSettingsService,
    private readonly tokens: AuthTokenService,
    private readonly capabilityRegistry: CapabilityRegistryService,
    private readonly constraints: RestrictionConstraintService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly keyring: KeyringService,
    private readonly prisma: PrismaService,
  ) {}

  // WS analogue of MultiuserGuard's per-request context build (scope access,
  // effective plugin set, resource constraints) for an inbound socket command.
  // Mirrors the guard: a stale/denied scope falls back to the caller's own.
  // Decode a socket's JWT and confirm its epoch still matches the user row, so
  // a token revoked by logout/password-reset cannot open a new connection
  // (#241). Mirrors the HTTP guard's check; device tokens don't reach here.
  private async verifyCurrentToken(token: string): Promise<string | null> {
    const decoded = this.tokens.verify(token);
    if (!decoded) return null;
    return (await this.users.getByCurrentToken(decoded))?.id ?? null;
  }

  private async resolveRealtimeContext(
    userId: string,
    requestedScopeId: string | undefined,
    locale: string | undefined,
  ): Promise<RealtimeRequestContext | null> {
    const user = await this.users.getById(userId);
    if (!user) return null;

    let scopeId = requestedScopeId || user.id;
    let accessLevel: ScopeAccess = 'OWNER';
    let grantAllowedPluginIds: string[] | null = null;
    let modelConstraints: ModelConstraintMap[] = [];
    if (scopeId !== user.id) {
      const grant = await this.grants.findActive(scopeId, user.id);
      if (!grant) {
        scopeId = user.id;
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
    return {
      userId: user.id,
      isAdmin: user.isAdmin,
      scopeId,
      accessLevel,
      enabledPluginIds,
      modelConstraints,
      locale,
    };
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

  onModuleInit(): void {
    this.registry.register(multiuserManifest);
    this.i18n.registerBundle({ en, ru });
    // Instance backup (#62): accounts/grants/per-user plugin sets (sensitive).
    for (const provider of createMultiuserExchangeProviders(this.prisma)) {
      this.exchangeRegistry.registerSectionProvider('multiuser', provider);
    }

    // The realtime gateway (backend-core) authenticates WS handshakes through
    // this capability; while the plugin is disabled it resolves to null and
    // the gateway accepts anonymous connections — same pass-through as the
    // HTTP guard above.
    // Exchange validates the target of an admin per-scope export against the
    // account directory through this capability (over the registry only — no
    // cross-plugin code import).
    this.capabilityRegistry.registerCapability<ScopeDirectoryCapability>(
      multiuserManifest.id,
      SCOPE_DIRECTORY_CAPABILITY,
      {
        scopeExists: async (scopeId) =>
          (await this.prisma.user.count({ where: { id: scopeId } })) > 0,
        // Names for ids another plugin stored, so its screens can say who did
        // something. Blocked accounts are named like any other: they did the
        // thing, and hiding the name would leave a screen claiming nobody did.
        displayNames: async (userIds) => {
          if (userIds.length === 0) return {};
          const users = await this.prisma.user.findMany({
            where: { id: { in: [...new Set(userIds)] } },
            select: { id: true, username: true, displayName: true },
          });
          return Object.fromEntries(
            users.map((user) => [user.id, user.displayName ?? user.username]),
          );
        },
        // Who is behind an audience (#307). Blocked accounts are left out of
        // every answer: an account that cannot log in cannot read an inbox, and
        // filling one is how a notification silently goes nowhere.
        audienceUserIds: async (audience, scopeId) => {
          if (audience === 'admins') {
            const admins = await this.prisma.user.findMany({
              where: { isAdmin: true, blockedAt: null },
              select: { id: true },
            });
            return admins.map((user) => user.id);
          }
          if (!scopeId) return [];
          const owner = await this.prisma.user.findFirst({
            where: { id: scopeId, blockedAt: null },
            select: { id: true },
          });
          const ids = owner ? [owner.id] : [];
          if (audience === 'owner') return ids;
          const grants = await this.prisma.scopeGrant.findMany({
            where: { ownerUserId: scopeId },
            select: { granteeUserId: true },
          });
          // ScopeGrant carries flat FKs, no relation (§5.8), so liveness is a
          // second query rather than a nested filter.
          const grantees = await this.prisma.user.findMany({
            where: {
              id: { in: grants.map((grant) => grant.granteeUserId) },
              blockedAt: null,
            },
            select: { id: true },
          });
          for (const grantee of grantees) {
            if (!ids.includes(grantee.id)) ids.push(grantee.id);
          }
          return ids;
        },
      },
    );

    this.capabilityRegistry.registerCapability<RealtimeAuthCapability>(
      multiuserManifest.id,
      REALTIME_AUTH_CAPABILITY,
      {
        verifyToken: (token) => this.verifyCurrentToken(token),
        canAccessScope: async (userId, scopeId) =>
          scopeId === userId ||
          (await this.grants.findActive(scopeId, userId)) !== null,
        resolveContext: (userId, scopeId, locale) =>
          this.resolveRealtimeContext(userId, scopeId, locale),
      },
    );

    // Both policies are registered permanently; each is a no-op unless the
    // guard populated the request context, which only happens while the
    // plugin is enabled.
    this.dbPolicyHolder.register(this.scopePolicy);
    this.agentRegistry.registerToolAccessPolicy((tool) =>
      toolIsAccessible(tool, this.requestContext.get()),
    );

    this.pluginConfig.registerLifecycleHooks(multiuserManifest.id, {
      // Rows created while the mode was off carry no scope — hand them to the
      // oldest admin, mirroring the first-registration claim.
      onEnabled: () => this.backfill.claimOrphansForOldestAdmin(),
      onDisabled: async () => {
        this.users.invalidate();
        this.grants.clearCaches();
        this.userPlugins.clearCaches();
        this.settings.clearCache();
        // The per-user wrap layer is inactive with the overlay off (#63) — drop
        // every armed DEK so no unwrapped key lingers after the feature that
        // armed it is gone. Secrets then rest at Phase-1 instance encryption.
        this.keyring.clear();
      },
    });
  }
}
