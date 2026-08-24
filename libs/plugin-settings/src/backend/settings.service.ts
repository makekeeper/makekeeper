import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  AgentRegistryService,
  PluginRegistryService,
  AppConfigService,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';

import {
  AgentToolGroup,
  ApiInfo,
  ConfirmationPolicy,
  PermissionLevel,
  defaultConfirmationPolicy,
} from '@makekeeper/plugin-contract';

// Icon shown for a plugin group whose plugin isn't registered in the
// PluginRegistry (should not normally happen — every tool-owning plugin
// registers metadata).
const DEFAULT_PLUGIN_ICON = 'Box';

// THE gate rule, in one place so the projection and the write path cannot
// drift: a DESTRUCTIVE tool is never AUTO — the runtime hardcodes a
// confirmation for it regardless of policy, so the stored/projected value must
// agree, else the settings UI would show a delete tool as auto-running (#243).
// An external mutating tool is likewise pinned — an internal tool's AUTO rests
// on its code having passed review; a third-party container has no such basis
// (#137, decision #7). WRITE stays admin-relaxable — that is the intended
// feature (§5.7).
function isPinnedConfirm(
  permission: PermissionLevel,
  external: boolean,
): boolean {
  return (
    permission === PermissionLevel.DESTRUCTIVE ||
    (external && permission !== PermissionLevel.READ)
  );
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly config: AppConfigService,
  ) {}

  // API ACCESS
  // What the API section of the settings page needs to describe this instance
  // (#282). The address the caller's browser is actually on beats any guess we
  // could make from headers — it is the one place scheme, host and port are
  // known intact — so the page sends its own origin and it ranks right after
  // the operator's PUBLIC_BASE_URL declaration. Headers stay the fallback for a
  // caller that sends none.
  getApiInfo(req: RequestHeadersLike, clientOrigin?: string): ApiInfo {
    const resolved = this.config.resolvePublicBaseUrlWithSource(
      req,
      clientOrigin,
    );
    return {
      baseUrl: resolved.url,
      baseUrlSource: resolved.source,
      tokenTtlSeconds: this.config.getJwtTtlSeconds(),
    };
  }

  // AGENT TOOLS CAPABILITIES
  // Returns the registered tools grouped by their owning plugin, each merged
  // with its per-tool DB config and the plugin's display icon.
  async getAgentTools(): Promise<AgentToolGroup[]> {
    const groups = this.agentRegistry.getGroupedTools();
    const dbConfigs = await this.prisma.agentToolConfig.findMany();
    const dbMap = new Map(dbConfigs.map((c) => [c.toolName, c]));

    return groups.map((group) => ({
      pluginId: group.pluginId,
      pluginLabelKey: group.pluginLabelKey,
      // The tools' own icon first: an external plugin is absent from the
      // registry, so the lookup answered with the fallback for every one of
      // them and the list was a column of identical boxes.
      icon:
        group.pluginIcon ??
        this.pluginRegistry.getPlugin(group.pluginId)?.icon ??
        DEFAULT_PLUGIN_ICON,
      tools: group.tools.map((tool) => {
        const dbConfig = dbMap.get(tool.name);
        return {
          name: tool.name,
          descriptionKey: tool.descriptionKey,
          permission: tool.permission,
          parameters: tool.parameters,
          isEnabled: dbConfig ? dbConfig.isEnabled : true,
          // An external mutating tool is always shown as gated, whatever an
          // older row may say: the stored value must never be able to present
          // a third-party write as auto-running (#137).
          confirmationPolicy: this.effectivePolicy(tool, dbConfig),
          external: tool.external === true,
        };
      }),
    }));
  }

  // Projection of a tool's stored policy under the pinned-CONFIRM rule (see
  // isPinnedConfirm above).
  private effectivePolicy(
    tool: { permission: PermissionLevel; external?: boolean },
    dbConfig?: { confirmationPolicy: string },
  ): ConfirmationPolicy {
    const stored: ConfirmationPolicy | undefined = dbConfig
      ? dbConfig.confirmationPolicy === 'CONFIRM'
        ? 'CONFIRM'
        : 'AUTO'
      : undefined;
    const fallback = defaultConfirmationPolicy(tool.permission);
    if (isPinnedConfirm(tool.permission, tool.external === true)) {
      return 'CONFIRM';
    }
    return stored ?? fallback;
  }

  async updateAgentTool(
    name: string,
    data: { isEnabled?: boolean; confirmationPolicy?: string },
  ) {
    const tool = this.agentRegistry.getTool(name);
    const permission = tool?.permission;
    const defaultPolicy = permission
      ? defaultConfirmationPolicy(permission)
      : 'AUTO';
    // Refuse the relaxation at the write path too, not only in the projection:
    // the settings UI hides the option, but the endpoint must not trust that.
    const requested =
      permission !== undefined &&
      isPinnedConfirm(permission, tool?.external === true)
        ? 'CONFIRM'
        : data.confirmationPolicy;
    return this.prisma.agentToolConfig.upsert({
      where: { toolName: name },
      create: {
        toolName: name,
        isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
        confirmationPolicy: requested || defaultPolicy,
      },
      update: {
        isEnabled: data.isEnabled !== undefined ? data.isEnabled : undefined,
        confirmationPolicy: requested || undefined,
      },
    });
  }
}
