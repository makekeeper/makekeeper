import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the inventory plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const inventoryManifest: PluginManifest = {
  id: 'inventory',
  nameKey: 'plugins.inventory.name',
  descriptionKey: 'plugins.inventory.description',
  version: '1.0.0',
  icon: 'Wrench',
  navigation: [
    {
      path: '/inventory',
      titleKey: 'nav.inventory',
      icon: 'Wrench',
      section: 'main',
    },
  ],
  // Advanced surfaces hidden in simple UX mode (#53) — a display lens only;
  // the frontend registration passes these through to the settings toggles.
  // The phone-sized intake screen (#200): one tab in the mobile shell, gone
  // with the plugin like every other surface it owns.
  mobile: [
    {
      path: '/m/inventory',
      titleKey: 'inventory.mobile.tab',
      icon: 'Box',
      order: 10,
    },
    {
      path: '/m/inventory/stock',
      titleKey: 'inventory.mobile.stockTab',
      icon: 'Layers',
      order: 20,
    },
  ],
  uxFeatures: [
    {
      key: 'inventory.extraFields',
      labelKey: 'inventory.uxFeatures.extraFields',
    },
    {
      key: 'inventory.historyPanels',
      labelKey: 'inventory.uxFeatures.historyPanels',
    },
    {
      key: 'inventory.stockOperations',
      labelKey: 'inventory.uxFeatures.stockOperations',
    },
    // Categories & typed properties (#205) — their own lens since #269: the
    // vocabulary tab, the item form's category picker + property editor and
    // the list's tree filter move together.
    {
      key: 'inventory.categories',
      labelKey: 'inventory.uxFeatures.categories',
    },
  ],
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  dashboardWidgets: [
    // All under the UX lens (#269): in simple mode the dashboard is the bench
    // and nothing else. Each is keyed by its own widget key, so the settings
    // panel offers it back one block at a time.
    {
      key: 'inventory.lowStock',
      titleKey: 'inventory.dashboard.lowStock',
      icon: 'Wrench',
      size: 'stat',
      order: 20,
      advanced: true,
    },
    {
      key: 'inventory.restockList',
      titleKey: 'inventory.dashboard.restockList',
      icon: 'Wrench',
      size: 'panel',
      order: 20,
      advanced: true,
    },
    // Deliberately the SAME key as the stats chart below: one "stock timeline"
    // feature, shown on the dashboard and on /stats, one settings switch.
    {
      key: 'inventory.stockTimeline',
      titleKey: 'inventory.dashboard.timeline.title',
      icon: 'Wrench',
      size: 'panel',
      order: 32,
      advanced: true,
    },
    // Same pairing for the project-flows Sankey — hence the `Chart` suffix,
    // matching `statsCharts` rather than the `statsGraphs` source key.
    {
      key: 'inventory.projectFlowsChart',
      titleKey: 'inventory.dashboard.flows.title',
      icon: 'Wrench',
      size: 'full',
      order: 40,
      advanced: true,
    },
  ],
  // Exchange sections (#62): BOM components for the project root, placed stock
  // for the storage root. The BOM import strategy is user-selectable.
  exchange: {
    sections: [
      {
        key: 'inventory.components',
        labelKey: 'inventory.exchange.sections.components',
        roots: ['project'],
        dependsOn: ['projects.project'],
        importOptions: [
          {
            key: 'strategy',
            labelKey: 'inventory.exchange.options.strategy',
            type: 'select',
            options: [
              {
                value: 'create-new',
                labelKey: 'inventory.exchange.options.createNew',
              },
              {
                value: 'match-existing',
                labelKey: 'inventory.exchange.options.matchExisting',
              },
            ],
          },
        ],
      },
      {
        key: 'inventory.stock',
        labelKey: 'inventory.exchange.sections.stock',
        roots: ['storage'],
        dependsOn: ['storages.structure'],
      },
      // Instance backup: components (placements included), full movement
      // ledger, daily snapshots. Storages restore first (placement FK).
      {
        key: 'inventory.all',
        labelKey: 'inventory.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        dependsOn: ['storages.all'],
      },
    ],
  },
  // Stock-timeline statistics (ticket #56 §4.4). stock/reserved are point-in-time
  // levels captured by a daily snapshot; used is per-day consumption. Aggregated
  // + served by the stats plugin.
  statsProviders: [
    {
      key: 'inventory.stock',
      labelKey: 'inventory.dashboard.timeline.stock',
      unitKey: 'inventory.stats.unit',
      kind: 'level',
    },
    {
      key: 'inventory.reserved',
      labelKey: 'inventory.dashboard.timeline.reserved',
      unitKey: 'inventory.stats.unit',
      kind: 'level',
    },
    {
      key: 'inventory.used',
      labelKey: 'inventory.dashboard.timeline.used',
      unitKey: 'inventory.stats.unit',
      kind: 'counter',
    },
  ],
  // Relational graph source for the project-flows Sankey (ticket #56 §4.4).
  statsGraphs: [
    {
      key: 'inventory.projectFlows',
      labelKey: 'inventory.dashboard.flows.title',
      rangeDays: [7, 30, 90, 365],
    },
  ],
  statsCharts: [
    {
      kind: 'series',
      key: 'inventory.stockTimeline',
      titleKey: 'inventory.dashboard.timeline.title',
      form: 'stackedArea',
      series: [
        {
          metricKey: 'inventory.stock',
          labelKey: 'inventory.dashboard.timeline.stock',
        },
        {
          metricKey: 'inventory.reserved',
          labelKey: 'inventory.dashboard.timeline.reserved',
        },
        {
          metricKey: 'inventory.used',
          labelKey: 'inventory.dashboard.timeline.used',
        },
      ],
      defaultRangeDays: 30,
      advanced: true,
    },
    {
      kind: 'graph',
      key: 'inventory.projectFlowsChart',
      titleKey: 'inventory.dashboard.flows.title',
      form: 'sankey',
      graphKey: 'inventory.projectFlows',
      defaultRangeDays: 30,
      advanced: true,
    },
  ],
  // Components are labelable (#74): the codes plugin mounts its "Print label"
  // button into this detail-action slot (rendered by InventoryFormView).
  codes: {
    labelable: [{ entityType: 'component', slot: 'inventory.detail.actions' }],
    // Contextual scanning (#79): codes mounts its "Scan with phone" button into
    // this slot, which inventory renders inside its own contribution to the
    // storages cell — so scanning items into a cell exists only while both
    // plugins are enabled, and neither imports the other.
    scan: {
      slot: 'inventory.cell.scanPlace',
      statusSlot: 'inventory.cell.scanStatus',
    },
  },
};
