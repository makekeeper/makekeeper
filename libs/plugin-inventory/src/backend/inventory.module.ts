import { Module, OnModuleInit } from '@nestjs/common';
import { inventoryManifest } from '../manifest';
import {
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  StatsRegistryService,
  PluginEventBusService,
  ExchangeRegistryService,
  CapabilityRegistryService,
  PrismaService,
  AttachmentStorageModule,
} from '@makekeeper/backend-core';
import {
  CODES_RAW_RESOLVE_CAPABILITY,
  INVENTORY_STOCK_FACTS_CAPABILITY,
  LOGISTICS_STOCK_ADJUST_EVENT,
  PROJECTS_COMPONENT_UNLINKED_EVENT,
  attachmentTargetCapability,
  formatObjectRef,
  parseObjectRef,
  type AttachmentTargetCapability,
  type CodesRawResolveCapability,
  type InventoryStockFactsCapability,
  type LogisticsStockAdjustEvent,
  type ProjectsComponentUnlinkedEvent,
} from '@makekeeper/plugin-contract';
import { CATEGORY_PROPERTY_ENTITY } from '../categories';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

import { InventoryController } from './inventory.controller';
import { InventoryCategoriesController } from './categories.controller';
import { InventoryCategoriesService } from './categories.service';
import { InventoryService } from './inventory.service';
import { InventoryStockService } from './inventory-stock.service';
import { InventoryEventsService } from './inventory-events.service';
import { InventoryRecognitionService } from './inventory-recognition.service';
import { InventoryIntakeService } from './inventory-intake.service';
import { StockSnapshotJob } from './inventory.snapshot.job';
import { getInventoryTools } from './inventory.tools';
import { createInventoryExchangeProviders } from './inventory.exchange';
import {
  AttachmentStorageService,
  createTableDumpProvider,
} from '@makekeeper/backend-core';

// The item an ORef names, or null for anything else this plugin owns (#130).
// Only an item owns pictures: a category or a property is referenceable but has
// nothing to hold a file, and saying so is what sends a chat upload back to the
// project scope. Both halves of the attachment-target capability read the ref
// through here, so "is this a filing target" is decided once.
function itemIdFromRef(raw: string): string | null {
  const ref = parseObjectRef(raw);
  return ref && ref.entityType === 'component' ? ref.entityId : null;
}

@Module({
  imports: [AttachmentStorageModule],
  controllers: [InventoryController, InventoryCategoriesController],
  providers: [
    InventoryCategoriesService,
    InventoryService,
    InventoryStockService,
    InventoryEventsService,
    InventoryRecognitionService,
    InventoryIntakeService,
    StockSnapshotJob,
  ],
  exports: [InventoryService],
})
export class InventoryPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly inventoryService: InventoryService,
    private readonly categoriesService: InventoryCategoriesService,
    private readonly stockService: InventoryStockService,
    private readonly i18n: PluginI18nService,
    private readonly statsRegistry: StatsRegistryService,
    private readonly eventBus: PluginEventBusService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentStorageService,
  ) {}

  onModuleInit() {
    this.registry.register(inventoryManifest);
    this.i18n.registerBundle({ en, ru });
    // Exchange section providers (#62): project BOM + storage stock.
    for (const provider of createInventoryExchangeProviders(
      this.prisma,
      this.i18n,
      this.attachments,
    )) {
      this.exchangeRegistry.registerSectionProvider('inventory', provider);
    }
    // Instance backup: components + full movement ledger + snapshots.
    this.exchangeRegistry.registerSectionProvider(
      'inventory',
      createTableDumpProvider({
        sectionKey: 'inventory.all',
        models: ['component', 'stockMovement', 'stockSnapshot'],
        prisma: this.prisma,
      }),
    );
    this.agentRegistry.registerTools(
      getInventoryTools(
        this.inventoryService,
        this.stockService,
        this.categoriesService,
        this.i18n,
      ),
    );
    // Stock reactions to other plugins' domain events (#58). Skipped by the
    // bus while inventory is disabled — orders/BOM flows then simply don't
    // touch stock.
    this.eventBus.on<LogisticsStockAdjustEvent>(
      'inventory',
      LOGISTICS_STOCK_ADJUST_EVENT,
      (event) => this.stockService.applyLogisticsAdjustment(event),
    );
    this.eventBus.on<ProjectsComponentUnlinkedEvent>(
      'inventory',
      PROJECTS_COMPONENT_UNLINKED_EVENT,
      (event) => this.stockService.releaseUnlinkedReservation(event),
    );
    // Resolve a component ORef to its name (#16).
    this.agentRegistry.registerObjectRefResolver(
      'inventory',
      'component',
      async (ref) => {
        const component = await this.inventoryService.findOne(ref.entityId);
        return component ? { displayName: component.name } : null;
      },
    );
    // A category is referenceable too (#205), so the agent and the chat can
    // link one by name instead of printing a bare id.
    this.agentRegistry.registerObjectRefResolver(
      'inventory',
      'category',
      async (ref) => {
        const categories = await this.categoriesService.list();
        const category = categories.find((entry) => entry.id === ref.entityId);
        return category ? { displayName: category.name } : null;
      },
    );
    // So is a single property (#205) — that ref is how another plugin names one
    // without knowing anything about this plugin's tables. The display name
    // carries the owning category, because "Package" alone names nothing.
    this.agentRegistry.registerObjectRefResolver(
      'inventory',
      CATEGORY_PROPERTY_ENTITY,
      async (ref) => {
        const property = await this.categoriesService.findProperty(
          ref.entityId,
        );
        return property
          ? { displayName: `${property.categoryName} / ${property.name}` }
          : null;
      },
    );
    // Raw-code resolution for the universal scanner (#74): map a scanned foreign
    // barcode/SKU to the matching component's ORef. Registered as a capability so
    // codes degrades cleanly (returns "no mapping") when inventory is disabled.
    this.capabilities.registerCapability<CodesRawResolveCapability>(
      'inventory',
      CODES_RAW_RESOLVE_CAPABILITY,
      {
        resolveRawCode: async (value) => {
          const matches = await this.inventoryService.findBySku(value);
          const match = matches[0];
          return match
            ? formatObjectRef({
                pluginId: 'inventory',
                entityType: 'component',
                entityId: match.id,
              })
            : null;
        },
      },
    );
    // An item takes the pictures shot for it (#130). Without this the chat filed
    // every upload under whatever project was in scope, so a photo of a part
    // taken on the item's own page ended up in a project's files — a copy in a
    // place nobody would look for it. The chat saves the bytes and asks here;
    // the row that ties the file to the item is written by inventory, which is
    // the only side that may (§5.10).
    this.capabilities.registerCapability<AttachmentTargetCapability>(
      'inventory',
      attachmentTargetCapability('inventory'),
      {
        describeAttachmentTarget: async (raw) => {
          const itemId = itemIdFromRef(raw);
          if (!itemId) return null;
          const component = await this.inventoryService.findOne(itemId);
          return component ? { name: component.name } : null;
        },
        adoptAttachments: async (raw, urls) => {
          const itemId = itemIdFromRef(raw);
          if (!itemId) return;
          // The same guard the item's own form runs: a picture already owned by
          // something else is refused rather than re-homed. It throws, and the
          // chat leaves the file with the conversation.
          await this.inventoryService.assertPhotosAdoptable(urls, itemId);
          await this.inventoryService.addPhotos(itemId, urls);
        },
      },
    );
    // Bench stock facts for the projects bench summary (#90): unplaced count.
    this.capabilities.registerCapability<InventoryStockFactsCapability>(
      'inventory',
      INVENTORY_STOCK_FACTS_CAPABILITY,
      { unplacedCount: () => this.inventoryService.unplacedCount() },
    );
    // Stock-timeline metrics (ticket #56 §4.4): stock/reserved LEVELS from the
    // daily snapshot, plus per-day consumption. The stats plugin aggregates and
    // serves them to the timeline widget in place of the bespoke endpoint.
    this.statsRegistry.registerStatsProvider('inventory', 'inventory.stock', {
      fetchRange: (from, to) =>
        this.inventoryService.getStockLevelsByDayScope(from, to, 'stock'),
    });
    this.statsRegistry.registerStatsProvider(
      'inventory',
      'inventory.reserved',
      {
        fetchRange: (from, to) =>
          this.inventoryService.getStockLevelsByDayScope(from, to, 'reserved'),
      },
    );
    this.statsRegistry.registerStatsProvider('inventory', 'inventory.used', {
      fetchRange: (from, to) =>
        this.inventoryService.getUsedByDayScope(from, to),
    });
    // Project-flows Sankey (ticket #56 §4.4): a relational graph over one window,
    // served live through the stats graph endpoint (not the per-day rollup).
    this.statsRegistry.registerStatsGraphProvider(
      'inventory',
      'inventory.projectFlows',
      {
        fetchGraph: (from, to) => {
          const days = Math.max(
            1,
            Math.round((to.getTime() - from.getTime()) / 86_400_000),
          );
          return this.inventoryService.getProjectFlows(days);
        },
      },
    );
  }
}
