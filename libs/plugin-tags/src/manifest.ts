import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the tags plugin's identity (#60). Imported by both
// the NestJS backend module and the Vue frontend registration.
export const tagsManifest: PluginManifest = {
  id: 'tags',
  nameKey: 'plugins.tags.name',
  descriptionKey: 'plugins.tags.description',
  version: '1.0.0',
  icon: 'Tags',
  navigation: [
    // A pro surface (#269): the tag vocabulary page is hidden in simple mode
    // by default; `uxFeatureKey` keeps it one settings toggle away.
    {
      path: '/tags',
      titleKey: 'nav.tags',
      icon: 'Tags',
      section: 'main',
      advanced: true,
      uxFeatureKey: 'tags.page',
    },
  ],
  // The lens splits the plugin in two (#269): the vocabulary PAGE and the tag
  // surfaces woven through the other plugins (header search, list filters,
  // chips, tag-source fields). Both default to pro; either can be pulled into
  // simple mode from the settings.
  uxFeatures: [
    { key: 'tags.page', labelKey: 'tags.ux.page' },
    { key: 'tags.everywhere', labelKey: 'tags.ux.everywhere' },
  ],
  // Exchange section (#62): tags + links for whatever the archive carries.
  // `runAfter` (ordering-only) puts it behind every section it might
  // reference without requiring any of them.
  exchange: {
    sections: [
      {
        key: 'tags.links',
        labelKey: 'tags.exchange.sections.links',
        roots: ['project', 'storage'],
        runAfter: [
          'projects.project',
          'projects.tasks',
          'inventory.components',
          'logistics.orders',
          'storages.structure',
          'inventory.stock',
        ],
      },
      // Instance backup: the whole vocabulary + every link (refs verbatim).
      {
        key: 'tags.all',
        labelKey: 'tags.exchange.sections.all',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
      },
    ],
  },
};
