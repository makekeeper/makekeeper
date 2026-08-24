import { Module, OnModuleInit } from '@nestjs/common';
import {
  AgentRegistryModule,
  AgentRegistryService,
  AppConfigModule,
  CapabilityRegistryService,
  PluginEventBusService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
  RealtimeModule,
  RequestContextModule,
  SecretBoxModule,
} from '@makekeeper/backend-core';
import { externalManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { ExternalController } from './external.controller';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalTokensService } from './external-tokens.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalSettingsService } from './external-settings.service';
import { ExternalScopeRefService } from './external-scope-ref.service';
import { ExternalRenderService } from './external-render.service';
import { ExternalShellService } from './external-shell.service';
import { ExternalRenderController } from './external-render.controller';
import { ExternalDataController } from './external-data.controller';
import { ExternalPermissionsService } from './external-permissions.service';
import { ExternalInstanceService } from './external-instance.service';
import { ExternalTokenGuard } from './external-token.guard';
import { ExternalEventsService } from './external-events.service';
import { ExternalNotifyController } from './external-notify.controller';
import { ExternalToolsService } from './external-tools.service';
import {
  ExternalExchangeService,
  pluginIdOfExternalSection,
} from './external-exchange.service';
import {
  CORE_SCOPE_DELETED_EVENT,
  EXTERNAL_DEFERRED_EXCHANGE_CAPABILITY,
  EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
  EXTERNAL_EVENT_SCOPE_DELETED,
  type CoreScopeDeletedEvent,
  type ExternalDeferredExchangeCapability,
  type ExternalEventsPublishCapability,
} from '@makekeeper/plugin-contract';
import { ExternalCapabilitiesService } from './external-capabilities.service';
import { ExternalPubService } from './external-pub.service';
import { ExternalProvisioningService } from './external-provisioning.service';
import { ExternalDiscoveryService } from './external-discovery.service';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    SecretBoxModule,
    RequestContextModule,
    AgentRegistryModule,
    RealtimeModule,
  ],
  controllers: [
    ExternalController,
    ExternalRenderController,
    ExternalDataController,
    ExternalNotifyController,
  ],
  providers: [
    ExternalSettingsService,
    ExternalScopeRefService,
    ExternalRegistryService,
    ExternalTokensService,
    ExternalSignerService,
    ExternalBreakerService,
    ExternalRenderService,
    ExternalShellService,
    ExternalPermissionsService,
    ExternalInstanceService,
    ExternalTokenGuard,
    ExternalEventsService,
    ExternalToolsService,
    ExternalExchangeService,
    ExternalCapabilitiesService,
    ExternalProvisioningService,
    ExternalDiscoveryService,
    ExternalPubService,
  ],
  exports: [
    ExternalPubService,
    ExternalSettingsService,
    ExternalScopeRefService,
    ExternalRegistryService,
    ExternalTokensService,
    ExternalSignerService,
    ExternalBreakerService,
    ExternalRenderService,
    ExternalPermissionsService,
    ExternalEventsService,
    ExternalToolsService,
    ExternalExchangeService,
    ExternalCapabilitiesService,
    ExternalProvisioningService,
    ExternalDiscoveryService,
  ],
})
export class ExternalPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly i18n: PluginI18nService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly external: ExternalRegistryService,
    private readonly render: ExternalRenderService,
    private readonly tools: ExternalToolsService,
    private readonly exchange: ExternalExchangeService,
    private readonly capabilities: ExternalCapabilitiesService,
    private readonly capabilityRegistry: CapabilityRegistryService,
    private readonly eventBus: PluginEventBusService,
    private readonly events: ExternalEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(externalManifest);
    this.i18n.registerBundle({ en, ru });
    // A deleted scope, relayed to third-party containers (#188). The core
    // cannot reach into their storage, so this event is the only way their
    // copy of a deleted workspace can ever be dropped — the plugins that store
    // per-scope data all declare it and, until now, were never called.
    //
    // Registered on the neutral bus rather than by importing multiuser: the
    // overlay may not even be installed, and a plugin never imports another
    // plugin's code (§5.10).
    this.eventBus.on<CoreScopeDeletedEvent>(
      externalManifest.id,
      CORE_SCOPE_DELETED_EVENT,
      async ({ scopeId }) => {
        await this.events.publish({
          type: EXTERNAL_EVENT_SCOPE_DELETED,
          scopeId,
        });
      },
    );

    // Tools of plugins the admin let into the assistant (#137). Re-synced on
    // every consent/lifecycle change; here it seeds the boot state.
    await this.tools.syncAll();
    // Exchange section providers and offered capabilities of active plugins.
    await this.exchange.syncProviders();
    await this.capabilities.syncOffered();
    // Offered to the exchange plugin so an archive carrying data of an
    // UNINSTALLED external plugin is parked instead of silently dropped —
    // without either plugin importing the other (§5.10).
    this.capabilityRegistry.registerCapability<ExternalDeferredExchangeCapability>(
      externalManifest.id,
      EXTERNAL_DEFERRED_EXCHANGE_CAPABILITY,
      {
        ownerOfSection: (sectionKey) => pluginIdOfExternalSection(sectionKey),
        deferBlock: (pluginId, blob, targetScopeId) =>
          this.exchange.defer(pluginId, blob, targetScopeId),
      },
    );
    // The public domain-event catalogue's single publishing seam (#191).
    // Data owners resolve this per call and skip publishing when it is null —
    // no external host means nobody can be listening. The internal bus stays
    // a separate, private vocabulary (#189 decision 1): nothing is bridged.
    this.capabilityRegistry.registerCapability<ExternalEventsPublishCapability>(
      externalManifest.id,
      EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
      {
        publishDomainEvent: (input) => this.events.publish(input),
      },
    );
    // ORef resolvers for entity types external plugins declare (#134). One
    // resolver per (pluginId, entityType) so `mk://<extPlugin>/<type>/<id>`
    // resolves through the proxy — a dead plugin degrades the link to text
    // instead of breaking the message that carries it.
    for (const plugin of await this.external.listActive()) {
      for (const decl of plugin.manifest.objectRefs ?? []) {
        this.agentRegistry.registerObjectRefResolver(
          plugin.pluginId,
          decl.entityType,
          async (ref) => {
            const resolved = await this.render.resolveRef(
              plugin.pluginId,
              ref.entityType,
              ref.entityId,
            );
            return resolved ? { displayName: resolved.name } : null;
          },
        );
      }
    }
  }
}
