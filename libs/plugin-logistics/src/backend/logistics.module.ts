import { Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { logisticsManifest } from '../manifest';
import {
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  AttachmentStorageModule,
  CapabilityRegistryService,
  ExchangeRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  COMPONENT_ORDER_INFO_CAPABILITY,
  LOGISTICS_INCOMING_CAPABILITY,
  NOTIFY_BUS_CAPABILITY,
  calendarSourceCapability,
  type NotifyBusCapability,
} from '@makekeeper/plugin-contract';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

import { LogisticsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';
import { LogisticsSettingsService } from './logistics-settings.service';
import { LogisticsTrackingService } from './logistics-tracking.service';
import { LogisticsImportService } from './logistics-import.service';
import { getLogisticsTools } from './logistics.tools';
import { createLogisticsExchangeProviders } from './logistics.exchange';
import { createLogisticsCalendarSource } from './logistics.calendar';
import { LOGISTICS_NOTIFICATION_TYPES } from './logistics.notifications';
import { createTableDumpProvider } from '@makekeeper/backend-core';

@Module({
  // AttachmentStorageModule persists/reads the screenshot bytes. Vision
  // extraction is resolved at runtime via the capability registry (#58) — no
  // compile-time dependency on the chat plugin.
  imports: [AttachmentStorageModule],
  controllers: [LogisticsController],
  providers: [
    LogisticsService,
    LogisticsSettingsService,
    LogisticsTrackingService,
    LogisticsImportService,
  ],
  exports: [LogisticsService],
})
export class LogisticsPluginModule
  implements OnModuleInit, OnApplicationBootstrap
{
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly logisticsService: LogisticsService,
    private readonly trackingService: LogisticsTrackingService,
    private readonly importService: LogisticsImportService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.registry.register(logisticsManifest);
    this.i18n.registerBundle({ en, ru });
    // When a parcel is expected, on the calendar (#310). Read live from the
    // order, so a courier's revised estimate reaches the calendar the moment
    // tracking writes it — nothing to synchronise, nothing to forget to emit.
    this.capabilities.registerCapability(
      logisticsManifest.id,
      calendarSourceCapability(logisticsManifest.id),
      createLogisticsCalendarSource(this.prisma),
    );
    // Exchange section provider (#62): the project root's orders.
    for (const provider of createLogisticsExchangeProviders(this.prisma)) {
      this.exchangeRegistry.registerSectionProvider('logistics', provider);
    }
    // Instance backup: order tables + (secrets-gated) provider settings.
    this.exchangeRegistry.registerSectionProvider(
      'logistics',
      createTableDumpProvider({
        sectionKey: 'logistics.all',
        models: [
          'supplier',
          'order',
          'orderComponent',
          'trackingEvent',
          'returnRequest',
        ],
        prisma: this.prisma,
      }),
    );
    this.exchangeRegistry.registerSectionProvider(
      'logistics',
      createTableDumpProvider({
        sectionKey: 'logistics.settings',
        models: ['logisticsSettings'],
        prisma: this.prisma,
      }),
    );
    // Order-derived component facts for the inventory plugin (#58) — resolved
    // per call and hidden while logistics is disabled. LogisticsService
    // structurally satisfies ComponentOrderInfoCapability.
    this.capabilities.registerCapability(
      'logistics',
      COMPONENT_ORDER_INFO_CAPABILITY,
      this.logisticsService,
    );
    // Incoming-order count for the projects bench summary (#90).
    this.capabilities.registerCapability(
      'logistics',
      LOGISTICS_INCOMING_CAPABILITY,
      this.logisticsService,
    );
    this.agentRegistry.registerTools(
      getLogisticsTools(
        this.logisticsService,
        this.trackingService,
        this.importService,
      ),
    );
    // Resolve an order ORef to its store name, with the order status as breadcrumb
    // context (#16).
    this.agentRegistry.registerObjectRefResolver(
      'logistics',
      'order',
      async (ref) => {
        const order = await this.logisticsService.findOrder(ref.entityId);
        return order
          ? { displayName: order.storeName, breadcrumb: order.status }
          : null;
      },
    );
  }

  // Declared on bootstrap so the bus is certainly registered whatever order the
  // modules initialise in. Seeds this type's default routing once; a person's
  // later choice is never overwritten (#307).
  onApplicationBootstrap(): void {
    this.capabilities
      .getCapability<NotifyBusCapability>(NOTIFY_BUS_CAPABILITY)
      ?.declareTypes(logisticsManifest.id, LOGISTICS_NOTIFICATION_TYPES);
  }
}
