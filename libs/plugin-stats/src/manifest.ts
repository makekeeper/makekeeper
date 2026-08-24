import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the stats plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
//
// The stats plugin owns aggregation, storage of daily aggregates and their
// presentation (ticket #56). Other plugins stay the source of raw data and
// declare which metrics/charts they publish; this plugin never touches their
// tables. It is `defaultEnabled` but NOT `core` — disabling it must not break
// the data plugins, whose stats declarations are passive.
export const statsManifest: PluginManifest = {
  id: 'stats',
  nameKey: 'plugins.stats.name',
  descriptionKey: 'plugins.stats.description',
  version: '1.0.0',
  icon: 'ChartColumn',
  navigation: [
    // A pro surface (#269): analytics is power-user territory, so simple mode
    // hides the page by default — the `uxFeatureKey` keeps it one settings
    // toggle away rather than hard-hidden.
    {
      path: '/stats',
      titleKey: 'nav.stats',
      icon: 'ChartColumn',
      section: 'main',
      advanced: true,
      uxFeatureKey: 'stats.page',
    },
  ],
  uxFeatures: [{ key: 'stats.page', labelKey: 'stats.ux.page' }],
  // Instance backup (#62): the daily aggregate table this plugin owns.
  exchange: {
    sections: [
      {
        key: 'stats.all',
        labelKey: 'stats.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
      },
    ],
  },
  // Blocks published to the home dashboard; components bound in frontend/index.ts.
  dashboardWidgets: [
    {
      key: 'stats.pilot',
      titleKey: 'stats.dashboard.pilot.title',
      icon: 'ChartColumn',
      size: 'panel',
      order: 60,
      // Follows the page into the pro tier (#269), overridable by its own key.
      advanced: true,
    },
  ],
};
