import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the storages plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const storagesManifest: PluginManifest = {
  id: 'storages',
  nameKey: 'plugins.storages.name',
  descriptionKey: 'plugins.storages.description',
  version: '1.0.0',
  icon: 'Box',
  navigation: [
    {
      path: '/storages',
      titleKey: 'nav.storages',
      icon: 'Box',
      section: 'main',
    },
  ],
  // Advanced surfaces hidden in simple UX mode (#53) — a display lens only;
  // the frontend registration passes these through to the settings toggles.
  uxFeatures: [
    {
      key: 'storages.gridEditing',
      labelKey: 'storages.uxFeatures.gridEditing',
    },
    {
      key: 'storages.advancedFields',
      labelKey: 'storages.uxFeatures.advancedFields',
    },
  ],
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  dashboardWidgets: [
    // Under the UX lens (#269) like every non-hero dashboard block.
    {
      key: 'storages.total',
      titleKey: 'storages.dashboard.total',
      icon: 'Box',
      size: 'stat',
      order: 40,
      advanced: true,
    },
  ],
  // Exchange declarations (#62): the `storage` entity root; the root section
  // carries the whole subtree's structure. The import target (new root vs.
  // child of an existing storage/cell) arrives through import options.
  exchange: {
    roots: [
      {
        kind: 'entity',
        entityType: 'storage',
        labelKey: 'storages.exchange.root',
        icon: 'Box',
      },
    ],
    sections: [
      {
        key: 'storages.structure',
        labelKey: 'storages.exchange.sections.structure',
        roots: ['storage'],
        isRoot: true,
        importOptions: [
          {
            key: 'targetStorageId',
            labelKey: 'storages.exchange.options.targetStorage',
            type: 'string',
          },
          {
            key: 'targetRow',
            labelKey: 'storages.exchange.options.targetRow',
            type: 'number',
          },
          {
            key: 'targetCol',
            labelKey: 'storages.exchange.options.targetCol',
            type: 'number',
          },
        ],
      },
      // Instance backup: the whole storage tree (self-referencing FK — rows
      // restore in stored order, parents were created before children).
      {
        key: 'storages.all',
        labelKey: 'storages.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
      },
    ],
  },
  // Storages and their grid-cells are labelable (#74): the codes plugin mounts
  // its "Print label" button into this detail-action slot. The host passes the
  // open cell's ORef (with a `#cell` fragment) or the whole storage's.
  codes: {
    labelable: [{ entityType: 'storage', slot: 'storages.detail.actions' }],
  },
};
