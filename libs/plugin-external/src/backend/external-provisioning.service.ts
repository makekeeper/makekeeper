import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, RequestContextService } from '@makekeeper/backend-core';
import { parseExternalPermission } from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalTokensService } from './external-tokens.service';
import { ExternalScopeRefService } from './external-scope-ref.service';

// Background-token provisioning (#140).
//
// The bootstrap problem: a plugin holds its registration SECRET (its identity)
// but needs TOKENS (its capabilities) to call the core outside a user request.
// It cannot be handed them at registration, because nothing is granted until
// the admin consents — and grants change afterwards. So the plugin exchanges
// its secret for its CURRENT tokens whenever it needs them:
//
//   secret = who you are (long-lived, one per plugin)
//   token  = what you may do right now (re-issued whenever grants change)
//
// Which tokens a plugin gets follows its declared scope model (decision #6):
//   instance   — exactly one background-scoped token, for the single scope the
//                plugin is bound to (or the implicit one in single-user mode);
//   per-scope  — one token per scope, each carrying an opaque scopeId the
//                plugin keys its own storage by.
// Additionally, any `instance:*` grant yields ONE background-instance token,
// whose only reachable surface is aggregates.

export interface ProvisionedTokens {
  // scopeId is null in single-user mode (there is one implicit data space).
  scoped: Array<{ scopeId: string | null; token: string }>;
  instance: string | null;
}

@Injectable()
export class ExternalProvisioningService {
  private readonly logger = new Logger(ExternalProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExternalRegistryService,
    private readonly tokens: ExternalTokensService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  // Re-issues the plugin's background tokens and returns them. Always a fresh
  // set: old ones are revoked first, so a token can never outlive the grant
  // state it was minted under (the same rule the update diff policy relies on).
  async provision(pluginId: string): Promise<ProvisionedTokens | null> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return null;

    await this.tokens.revokeBackgroundForPlugin(pluginId);

    const scopes = await this.targetScopes(
      plugin.manifest.scopeModel,
      plugin.scopeId,
    );
    const scoped: ProvisionedTokens['scoped'] = [];
    for (const scopeId of scopes) {
      scoped.push({
        // The plugin keys its storage by the OPAQUE reference (decision #5);
        // the token row keeps the internal id core-side.
        scopeId: await this.scopeRefs.toRef(pluginId, scopeId),
        token: await this.tokens.issueBackground(
          pluginId,
          'background-scoped',
          scopeId,
        ),
      });
    }

    const wantsInstance = plugin.grants.some(
      (raw) => parseExternalPermission(raw)?.class === 'instance',
    );
    const instance = wantsInstance
      ? await this.tokens.issueBackground(pluginId, 'background-instance', null)
      : null;

    this.logger.log(
      `provisioned ${scoped.length} scoped token(s)${instance ? ' + instance token' : ''} for ${pluginId}`,
    );
    return { scoped, instance };
  }

  // Which data spaces this plugin acts in.
  private async targetScopes(
    scopeModel: 'instance' | 'per-scope',
    boundScopeId: string | null,
  ): Promise<Array<string | null>> {
    // Single-user mode: one implicit space, addressed as null.
    const users = await this.context.runWithoutScope(
      'admin-cross-user',
      async () => this.prisma.user.findMany({ select: { id: true } }),
    );
    if (users.length === 0) return [null];

    if (scopeModel === 'instance') {
      // Bound at approval time; falling back to the first account keeps a
      // single-admin instance working without an extra decision.
      return [boundScopeId ?? users[0].id];
    }
    return users.map((u) => u.id);
  }
}
