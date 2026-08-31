import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_CHANNEL_METHODS,
  PLUGIN_CAPABILITY_PATH,
  externalChannelCapabilityId,
  notifyChannelCapability,
  type NotifyChannelCapability,
  type RenderedNotification,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalScopeRefService } from './external-scope-ref.service';

// External plugins as notification channels (#312).
//
// This is the one place a third-party container receives rendered TEXT and a
// person's contact rather than a ref and the names of changed fields — which is
// exactly why it is a declared, admin-visible thing of its own and not just
// another capability. Everything else stays the same as any other relay: signed,
// budgeted, and cut off by the breaker when the container misbehaves.
//
// A channel's id IS the plugin's id, so two plugins cannot claim one channel and
// the matrix's column can be traced back to the container it belongs to.
@Injectable()
export class ExternalChannelsService {
  private readonly logger = new Logger(ExternalChannelsService.name);
  // Channel ids registered for external plugins, so a re-sync can withdraw
  // exactly what it published.
  private readonly published = new Set<string>();

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
    private readonly i18n: PluginI18nService,
  ) {}

  async syncAll(): Promise<void> {
    for (const plugin of await this.registry.listActive()) {
      this.publish(plugin.pluginId, plugin.manifest.deliveryChannel != null);
    }
  }

  async syncPlugin(pluginId: string): Promise<void> {
    const plugin = await this.registry.getActive(pluginId);
    this.publish(pluginId, plugin?.manifest.deliveryChannel != null);
  }

  private publish(pluginId: string, declares: boolean): void {
    const capabilityId = notifyChannelCapability(pluginId);
    if (!declares) {
      if (this.published.delete(pluginId)) {
        this.capabilities.unregisterCapability(capabilityId);
      }
      return;
    }
    this.published.add(pluginId);
    this.capabilities.registerCapability<NotifyChannelCapability>(
      pluginId,
      capabilityId,
      {
        channelId: pluginId,
        // The plugin's own bundle names the column; the core resolves it with
        // the same i18n path every external label takes.
        labelKey: `plugins.${pluginId}.name`,
        isLinked: (userId) => this.isLinked(pluginId, userId),
        deliver: (message) => this.deliver(pluginId, message),
      },
    );
  }

  private async isLinked(
    pluginId: string,
    userId: string | null,
  ): Promise<boolean> {
    const result = await this.call(
      pluginId,
      EXTERNAL_CHANNEL_METHODS.isLinked,
      {
        // The plugin never learns who anybody is: it files people under the same
        // opaque scope reference every other relay uses (decision #5).
        userRef: (await this.scopeRefs.toRef(pluginId, userId)) ?? '',
      },
    );
    return result === true;
  }

  private async deliver(
    pluginId: string,
    message: RenderedNotification,
  ): Promise<void> {
    const userRef =
      (await this.scopeRefs.toRef(pluginId, message.recipientUserId)) ?? '';
    // THROWING is the contract: the bus retries with backoff and eventually
    // marks the delivery dead, visibly. Swallowing here would turn "the plugin
    // is down" into "the person was told", which is the worst of both.
    await this.callOrThrow(pluginId, EXTERNAL_CHANNEL_METHODS.deliver, {
      userRef,
      title: message.title,
      body: message.body ?? '',
      url: message.url,
      importance: message.importance,
      // Each action carries its single-use token; pressing one is a POST back
      // to the core, so the plugin never gains authority of its own.
      actions: message.actions,
    });
  }

  private async call(
    pluginId: string,
    method: string,
    args: unknown,
  ): Promise<unknown> {
    try {
      return await this.callOrThrow(pluginId, method, args);
    } catch {
      // A question ("is this person connected?") degrades to "no"; only the
      // send is allowed to fail loudly.
      return null;
    }
  }

  private async callOrThrow(
    pluginId: string,
    method: string,
    args: unknown,
  ): Promise<unknown> {
    const plugin = await this.registry.getActive(pluginId);
    // These reach a person through the delivery log, so they are keys, not
    // prose (§5.5).
    if (!plugin) {
      throw new Error(
        this.i18n.t('external.channel.errors.inactive', { plugin: pluginId }),
      );
    }
    if (this.breaker.shouldSkip(pluginId)) {
      throw new Error(
        this.i18n.t('external.channel.errors.backedOff', { plugin: pluginId }),
      );
    }
    const request = this.context.get();
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_CAPABILITY_PATH,
      {
        capability: externalChannelCapabilityId(pluginId),
        method,
        args: [args],
        context: {
          scopeId:
            (await this.scopeRefs.toRef(pluginId, request?.scopeId ?? null)) ??
            '',
          locale: request?.locale ?? 'en',
        },
      },
      this.breaker.budget('tool'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      throw new Error(
        this.i18n.t('external.channel.errors.refused', { plugin: pluginId }),
      );
    }
    this.breaker.recordSuccess(pluginId);
    const payload = res.body;
    return typeof payload === 'object' &&
      payload !== null &&
      'result' in payload
      ? (payload as { result: unknown }).result
      : null;
  }
}
