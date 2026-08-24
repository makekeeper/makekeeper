import { Injectable, Logger } from '@nestjs/common';
import {
  AgentRegistryService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  AgentTool,
  ExternalToolRequest,
  PLUGIN_TOOL_PATH,
  PermissionLevel,
  ToolArgs,
  ToolConfirmSummary,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import { callerUserId, deriveUserRef } from './external-user-ref';
import { ExternalScopeRefService } from './external-scope-ref.service';
import { externalI18nKey } from '../external-types';

// External plugins in the product assistant (#137, decision #7).
//
// A third-party tool joins the agent only when the admin gave that plugin a
// SEPARATE consent (`assistantEnabled`, default off) — installing a plugin and
// letting it converse with a model that can read the user's data are different
// risks and must not share one checkbox.
//
// Three properties this service is responsible for:
//   1. tools are proxied, never executed in-process;
//   2. their results are handed to the model as UNTRUSTED DATA, so a hostile
//      container's "ignore previous instructions" is text, not a command;
//   3. every call is audit-logged with its arguments, because the residual
//      risk (the model may pass the plugin anything it can read) is not
//      preventable — only observable.

// The envelope a proxied result is wrapped in before it reaches the model.
// A plain string would be indistinguishable from instructions; a labelled
// object is data the model reports on.
export interface UntrustedToolResult {
  untrustedSource: 'external-plugin';
  pluginId: string;
  data: unknown;
}

@Injectable()
export class ExternalToolsService {
  private readonly logger = new Logger(ExternalToolsService.name);

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly i18n: PluginI18nService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  // Rebuilds the registered tool set for one plugin. Called on boot and after
  // any transition that can change it (consent, update, disable, uninstall) —
  // always full re-registration, so a removed tool name stops resolving.
  async syncPlugin(pluginId: string): Promise<void> {
    this.agentRegistry.unregisterPluginTools(pluginId);
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return;

    // The plugin's OWN bundles, namespaced, so the backend can resolve the
    // text it hands to the model. The frontend merges these separately, which
    // is why the settings UI read correctly while every tool description
    // reached the LLM as the literal key `ext.<plugin>.<key>` — a warning in
    // the log and a description of nothing in the prompt.
    //
    // Registered before the consent check: a plugin's text exists whether or
    // not it has joined the assistant, and a screen error resolved server-side
    // needs it too.
    this.i18n.registerBundle(
      Object.fromEntries(
        Object.entries(plugin.manifest.i18n).map(([locale, messages]) => [
          locale,
          { ext: { [pluginId]: messages } },
        ]),
      ),
    );

    if (!plugin.assistantEnabled) return;
    const tools = (plugin.manifest.tools ?? []).map((decl) =>
      this.buildTool(pluginId, plugin.manifest.icon, decl),
    );
    if (tools.length > 0) {
      this.agentRegistry.registerTools(tools);
      // …and give each one the config row the chat filters on. Registering a
      // tool at runtime without it left the plugin consented-to and invisible:
      // the boot-time seed had already run, and the chat only offers tools
      // that have a row saying they are enabled.
      await this.agentRegistry.ensureToolConfigs(tools);
    }
  }

  async syncAll(): Promise<void> {
    for (const plugin of await this.registry.listActive()) {
      await this.syncPlugin(plugin.pluginId);
    }
  }

  private buildTool(
    pluginId: string,
    icon: string,
    decl: NonNullable<
      Awaited<ReturnType<ExternalRegistryService['getActive']>>
    >['manifest']['tools'] extends Array<infer T> | undefined
      ? T
      : never,
  ): AgentTool {
    // Tool names are namespaced by plugin id so a third-party tool can never
    // shadow an internal one (or another plugin's).
    const name = `${pluginId}__${decl.name}`;
    const properties: AgentTool['parameters']['properties'] = {};
    for (const [key, param] of Object.entries(decl.parameters.properties)) {
      properties[key] = {
        type: param.type,
        // Descriptions live in the plugin's own bundle, resolved to the
        // caller's locale like any other tool text (§5.5).
        descriptionKey: externalI18nKey(pluginId, param.descriptionKey),
        enum: param.enum,
      };
    }

    const confirmSummary = (args: ToolArgs): ToolConfirmSummary => ({
      // A generic, honest card: the core cannot render a domain sentence for
      // an operation it does not know, so it names the plugin and the tool and
      // shows the arguments the user is approving.
      key: 'external.tools.confirm',
      params: {
        plugin: pluginId,
        tool: decl.name,
        args: JSON.stringify(args),
      },
    });

    return {
      name,
      descriptionKey: externalI18nKey(pluginId, decl.descriptionKey),
      parameters: {
        type: 'object',
        properties,
        required: decl.parameters.required,
      },
      permission: decl.permission,
      pluginId,
      pluginLabelKey: externalI18nKey(pluginId, 'name'),
      // Its own icon, since the plugin registry has never heard of it.
      pluginIcon: icon,
      external: true,
      // Mutating tools need a summary or the confirmation card falls back to
      // raw args (the registry warns about missing ones at boot).
      ...(decl.permission === PermissionLevel.READ ? {} : { confirmSummary }),
      handler: (args: ToolArgs) => this.invoke(pluginId, decl.name, args),
    };
  }

  private async invoke(
    pluginId: string,
    tool: string,
    args: ToolArgs,
  ): Promise<UntrustedToolResult> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin || !plugin.assistantEnabled) {
      throw new Error('external.errors.toolUnavailable');
    }
    if (this.breaker.shouldSkip(pluginId)) {
      throw new Error('external.errors.toolUnavailable');
    }

    const request = this.context.get();
    // Audit: the accepted residual risk of decision #7 is that a connected
    // plugin can receive whatever the model can read. That cannot be
    // prevented, so it is made visible.
    this.logger.log(
      `external tool call ${pluginId}/${tool} by user=${request?.userId ?? '-'} args=${JSON.stringify(args)}`,
    );

    // Same pseudonymous reference the render path passes (#156), so a tool
    // answering "what did I book" agrees with the screen showing it.
    const userId = callerUserId(request);
    const salt = userId ? await this.registry.userRefSalt(pluginId) : null;

    const body: ExternalToolRequest = {
      tool,
      args,
      context: {
        // Opaque scope reference, never the internal id (decision #5).
        scopeId:
          (await this.scopeRefs.toRef(pluginId, request?.scopeId ?? null)) ??
          '',
        locale: request?.locale ?? 'en',
        ...(userId && salt ? { userRef: deriveUserRef(salt, userId) } : {}),
      },
    };
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_TOOL_PATH,
      body,
      this.breaker.budget('tool'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      throw new Error('external.errors.toolFailed');
    }
    this.breaker.recordSuccess(pluginId);

    const payload = res.body;
    const data =
      typeof payload === 'object' && payload !== null && 'result' in payload
        ? (payload as { result: unknown }).result
        : null;
    // Wrapped, never returned bare: the model must treat a third-party
    // container's output as reported data, not as instructions addressed to it.
    return { untrustedSource: 'external-plugin', pluginId, data };
  }
}
