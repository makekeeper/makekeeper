import {
  PluginManifest,
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
} from '@makekeeper/plugin-contract';

// Single source of truth for the exchange plugin's identity (#62). The plugin
// owns the export/import ORCHESTRATION only — archives, wizard, endpoints. The
// data lives with the declaring plugins; exchange itself declares just the
// built-in `instance` dataset root (full backup / server migration) and its
// core marker section, which carries no plugin data.
export const exchangeManifest: PluginManifest = {
  id: 'exchange',
  nameKey: 'plugins.exchange.name',
  descriptionKey: 'plugins.exchange.description',
  version: '1.0.0',
  icon: 'ArrowLeftRight',
  // A guest tab of the Settings hub (#110) rather than its own sidebar entry:
  // export/import IS instance configuration. Guest tabs sort at order >= 100,
  // after the hub owner's own tabs. Still `advanced`, so simple mode hides it.
  navigation: [
    {
      path: '/settings/exchange',
      titleKey: 'nav.exchange',
      icon: 'ArrowLeftRight',
      hub: 'settings',
      order: 100,
      advanced: true,
      // Pre-#269 this tab hid on the bare mode and the `exchange.page` toggle
      // reached nothing; keyed, the settings override brings it back.
      uxFeatureKey: 'exchange.page',
    },
  ],
  uxFeatures: [{ key: 'exchange.page', labelKey: 'exchange.ux.page' }],
  exchange: {
    roots: [
      {
        kind: 'dataset',
        entityType: EXCHANGE_INSTANCE_ROOT,
        labelKey: 'exchange.roots.instance',
        icon: 'DatabaseBackup',
      },
      {
        kind: 'dataset',
        entityType: EXCHANGE_SCOPE_ROOT,
        labelKey: 'exchange.roots.scope',
        icon: 'UserRound',
      },
    ],
    sections: [
      {
        key: 'exchange.instance',
        labelKey: 'exchange.sections.instance',
        roots: [EXCHANGE_INSTANCE_ROOT],
        isRoot: true,
      },
      {
        // Marker section: every root needs exactly one `isRoot` section, but a
        // scope export carries no root object of its own (the scope id is the
        // request param). Empty payload, like `exchange.instance`.
        key: 'exchange.scope',
        labelKey: 'exchange.sections.scope',
        roots: [EXCHANGE_SCOPE_ROOT],
        isRoot: true,
      },
    ],
  },
};
