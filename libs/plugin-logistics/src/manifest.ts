import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the logistics plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const logisticsManifest: PluginManifest = {
  id: 'logistics',
  nameKey: 'plugins.logistics.name',
  descriptionKey: 'plugins.logistics.description',
  version: '1.0.0',
  icon: 'ShoppingBag',
  // Parcel-tracking provider credentials are instance administration.
  settingsAdminOnly: true,
  navigation: [
    {
      path: '/logistics',
      titleKey: 'nav.logistics',
      icon: 'ShoppingBag',
      section: 'main',
    },
  ],
  // Advanced surfaces hidden in simple UX mode (#53) — a display lens only;
  // the frontend registration passes these through to the settings toggles.
  uxFeatures: [
    {
      key: 'logistics.fullStatuses',
      labelKey: 'logistics.uxFeatures.fullStatuses',
    },
    { key: 'logistics.returns', labelKey: 'logistics.uxFeatures.returns' },
    { key: 'logistics.tracking', labelKey: 'logistics.uxFeatures.tracking' },
    { key: 'logistics.suppliers', labelKey: 'logistics.uxFeatures.suppliers' },
    {
      key: 'logistics.listFilters',
      labelKey: 'logistics.uxFeatures.listFilters',
    },
    {
      key: 'logistics.orderExtras',
      labelKey: 'logistics.uxFeatures.orderExtras',
    },
    // The project-detail Logistics tab this plugin contributes (#58) — an
    // advanced surface, toggleable like any other feature.
    {
      key: 'logistics.projectTab',
      labelKey: 'logistics.uxFeatures.projectTab',
    },
    // AI order import from a screenshot: SIMPLE by default (#269) — it makes
    // entry easier, not harder — but demotable to the pro tier per user.
    {
      key: 'logistics.importFromImage',
      labelKey: 'logistics.uxFeatures.importFromImage',
      defaultAdvanced: false,
    },
  ],
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  // All under the UX lens (#269): simple mode's dashboard is the bench alone,
  // whose ribbon already reports incoming parcels. Each block comes back on
  // its own switch in Settings → Interface mode.
  dashboardWidgets: [
    {
      key: 'logistics.incoming',
      titleKey: 'logistics.dashboard.incoming',
      icon: 'Truck',
      size: 'stat',
      order: 30,
      advanced: true,
    },
    {
      key: 'logistics.incomingOrders',
      titleKey: 'logistics.dashboard.incomingOrders',
      icon: 'Truck',
      size: 'panel',
      order: 30,
      advanced: true,
    },
    {
      key: 'logistics.spend',
      titleKey: 'logistics.dashboard.spend',
      icon: 'ShoppingBag',
      size: 'panel',
      order: 31,
      advanced: true,
    },
  ],
  // Exchange section (#62): the project's orders with lines, tracking events,
  // returns and embedded suppliers. Lines reference BOM components, hence the
  // hard dependency on the inventory section.
  exchange: {
    sections: [
      {
        key: 'logistics.orders',
        labelKey: 'logistics.exchange.sections.orders',
        roots: ['project'],
        dependsOn: ['projects.project', 'inventory.components'],
      },
      // Instance backup: orders reference projects/storages/components.
      {
        key: 'logistics.all',
        labelKey: 'logistics.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        dependsOn: ['projects.all'],
      },
      // Tracking-provider credentials — only travels with include-secrets.
      {
        key: 'logistics.settings',
        labelKey: 'logistics.exchange.sections.settings',
        roots: [EXCHANGE_INSTANCE_ROOT],
        sensitive: true,
      },
    ],
  },
};
