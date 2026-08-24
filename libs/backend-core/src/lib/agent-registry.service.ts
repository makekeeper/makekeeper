import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  AgentTool,
  ObjectRef,
  PageContext,
  PageContextResolver,
  PermissionLevel,
  defaultConfirmationPolicy,
  parseObjectRef,
} from '@makekeeper/plugin-contract';
import { PrismaService } from './prisma.service';
import { PluginConfigService } from './plugin-config.service';
import { getErrorMessage } from './error';

// Per-request veto over tool visibility, registered by the multiuser overlay
// (per-user plugin sets, read-only shared scopes). No policy ⇒ no extra
// filtering — instance-level plugin enablement still applies.
export type ToolAccessPolicy = (tool: AgentTool) => boolean;

// What a plugin knows about one of its objects, resolved from the DB. Kept small
// and text-only (the agent reads it): a human name and, where the object nests, a
// breadcrumb path. Returning null means "this id does not exist".
export interface ResolvedObjectRefInfo {
  displayName: string;
  breadcrumb?: string;
}

// A plugin registers one resolver per entity type it owns; it receives the parsed,
// ownership-checked ObjectRef and looks the object up via its own service.
export type ObjectRefResolver = (
  ref: ObjectRef,
) => Promise<ResolvedObjectRefInfo | null>;

// The uniform answer the `resolve_object_ref` agent tool returns: the canonical ref
// echoed back, whether it exists, and (when it does) its resolved info.
export interface ResolvedObjectRef extends ResolvedObjectRefInfo {
  ref: string;
  exists: boolean;
}

@Injectable()
export class AgentRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentRegistryService.name);
  private readonly toolsMap = new Map<string, AgentTool>();
  private readonly contextResolvers = new Map<string, PageContextResolver>();
  // Keyed "<pluginId>/<entityType>" — the same shape a parsed ORef addresses.
  private readonly objectRefResolvers = new Map<string, ObjectRefResolver>();
  private toolAccessPolicy: ToolAccessPolicy | null = null;

  registerToolAccessPolicy(policy: ToolAccessPolicy): void {
    this.toolAccessPolicy = policy;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginConfig: PluginConfigService,
  ) {}

  registerTools(tools: AgentTool[]) {
    for (const tool of tools) {
      this.toolsMap.set(tool.name, tool);
    }
  }

  // Drops every tool a plugin registered. Internal plugins never need this
  // (their tools live as long as the process), but an EXTERNAL plugin's tool
  // set changes at runtime — on consent, update, disable or uninstall — so its
  // owner re-registers from scratch instead of leaving stale names callable.
  unregisterPluginTools(pluginId: string): void {
    for (const [name, tool] of this.toolsMap) {
      if (tool.pluginId === pluginId) this.toolsMap.delete(name);
    }
  }

  // A plugin registers ONE resolver that turns raw route ids from a PageContext
  // into a precise server-side description of the user's current selection
  // (looked up in the DB). The chat runtime prefers this over anything the
  // client sent — it can't go stale with the browser bundle.
  registerPageContextResolver(pluginId: string, resolver: PageContextResolver) {
    this.contextResolvers.set(pluginId, resolver);
  }

  // Resolve the page context via the owning (and enabled) plugin's resolver.
  // Never throws: a failing resolver only costs the extra context, not the turn.
  async resolvePageContext(context: PageContext): Promise<string | null> {
    const pluginId = context.pluginId;
    if (!pluginId || !this.pluginConfig.isEnabled(pluginId)) return null;
    const resolver = this.contextResolvers.get(pluginId);
    if (!resolver) return null;
    try {
      return await resolver(context);
    } catch (error) {
      this.logger.warn(
        `Page-context resolver for "${pluginId}" failed: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  // A plugin registers ONE resolver per entity type it owns, so any ORef can be
  // turned back into a human name + breadcrumb from the DB (issue #16).
  registerObjectRefResolver(
    pluginId: string,
    entityType: string,
    resolver: ObjectRefResolver,
  ): void {
    this.objectRefResolvers.set(`${pluginId}/${entityType}`, resolver);
  }

  // Resolve a canonical ORef via the owning (and enabled) plugin's resolver. Returns
  // null when the ref is unparseable, its plugin is disabled, or no resolver is
  // registered; `{ exists: false }` when the resolver ran but the id is unknown.
  // Never throws — a failing resolver costs the lookup, not the turn.
  async resolveObjectRef(refString: string): Promise<ResolvedObjectRef | null> {
    const ref = parseObjectRef(refString);
    if (!ref || !this.pluginConfig.isEnabled(ref.pluginId)) return null;
    const resolver = this.objectRefResolvers.get(
      `${ref.pluginId}/${ref.entityType}`,
    );
    if (!resolver) return null;
    try {
      const info = await resolver(ref);
      return info
        ? { ref: refString, exists: true, ...info }
        : { ref: refString, exists: false, displayName: '' };
    } catch (error) {
      this.logger.warn(
        `Object-ref resolver for "${ref.pluginId}/${ref.entityType}" failed: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  getTools(): AgentTool[] {
    return Array.from(this.toolsMap.values());
  }

  getTool(name: string): AgentTool | undefined {
    return this.toolsMap.get(name);
  }

  // Tools of enabled plugins only — what the agent runtime is allowed to see
  // and invoke. Disabling a plugin instantly removes its tools from the agent;
  // the (optional) access policy can veto further per request.
  getEnabledTools(): AgentTool[] {
    return this.getTools().filter((tool) => this.isToolAccessible(tool));
  }

  getEnabledTool(name: string): AgentTool | undefined {
    const tool = this.toolsMap.get(name);
    return tool && this.isToolAccessible(tool) ? tool : undefined;
  }

  private isToolAccessible(tool: AgentTool): boolean {
    if (!this.pluginConfig.isEnabled(tool.pluginId)) return false;
    return this.toolAccessPolicy ? this.toolAccessPolicy(tool) : true;
  }

  // Groups the flat tool map by `pluginId` on the fly (preserving registration
  // order), so callers receive a pre-grouped structure per plugin.
  getGroupedTools(): {
    pluginId: string;
    pluginLabelKey: string;
    // Present when the tools carry one (external plugins): the plugin registry
    // cannot answer for a plugin it does not contain.
    pluginIcon?: string;
    tools: AgentTool[];
  }[] {
    const groups = new Map<
      string,
      {
        pluginId: string;
        pluginLabelKey: string;
        pluginIcon?: string;
        tools: AgentTool[];
      }
    >();
    for (const tool of this.toolsMap.values()) {
      const group = groups.get(tool.pluginId);
      if (group) {
        group.tools.push(tool);
      } else {
        groups.set(tool.pluginId, {
          pluginId: tool.pluginId,
          pluginLabelKey: tool.pluginLabelKey,
          ...(tool.pluginIcon ? { pluginIcon: tool.pluginIcon } : {}),
          tools: [tool],
        });
      }
    }
    return Array.from(groups.values());
  }

  async onApplicationBootstrap() {
    this.assertConfirmSummaries();
    await this.syncToolsWithDatabase();
  }

  // Policy guard: every mutating tool (WRITE/DESTRUCTIVE) must ship a
  // `confirmSummary` so its confirmation card renders a human sentence instead
  // of the raw method name + JSON args. This makes the convention self-checking
  // for future tools — a new mutating tool without a summary is flagged at
  // startup rather than discovered as an ugly card in production.
  private assertConfirmSummaries(): void {
    const mutating = new Set([
      PermissionLevel.WRITE,
      PermissionLevel.DESTRUCTIVE,
    ]);
    const missing = this.getTools()
      .filter((tool) => mutating.has(tool.permission) && !tool.confirmSummary)
      .map((tool) => tool.name);
    if (missing.length > 0) {
      this.logger.warn(
        `Agent tools missing a confirmSummary (confirmation card will fall back ` +
          `to raw args): ${missing.join(', ')}`,
      );
    }
  }

  // Tools registered at RUNTIME need their config row too.
  //
  // Boot-time sync covers the tools that exist at boot; an external plugin's
  // arrive when an admin approves it or lets it join the assistant, long
  // afterwards. Without a row the chat filtered them straight back out — the
  // plugin was installed, consented to, registered, and still invisible.
  async ensureToolConfigs(tools: AgentTool[]): Promise<void> {
    await this.seedToolConfigs(tools);
  }

  private async syncToolsWithDatabase() {
    await this.seedToolConfigs(this.getTools());
  }

  private async seedToolConfigs(tools: AgentTool[]) {
    const registeredTools = tools;
    for (const tool of registeredTools) {
      try {
        const existing = await this.prisma.agentToolConfig.findUnique({
          where: { toolName: tool.name },
        });

        if (!existing) {
          // Seed the shared default (READ auto-runs; WRITE/DESTRUCTIVE gate on
          // the user). Applied on first registration only — existing rows keep
          // their stored policy, so admin overrides survive.
          await this.prisma.agentToolConfig.create({
            data: {
              toolName: tool.name,
              isEnabled: true,
              confirmationPolicy: defaultConfirmationPolicy(tool.permission),
            },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to sync agent tool config for "${tool.name}": ${getErrorMessage(error)}`,
        );
      }
    }
  }
}
