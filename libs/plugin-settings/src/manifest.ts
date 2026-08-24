import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the settings plugin's identity. Imported by both the
// NestJS backend module and the Vue frontend registration.
export const settingsManifest: PluginManifest = {
  id: 'settings',
  nameKey: 'plugins.settings.name',
  descriptionKey: 'plugins.settings.description',
  version: '1.0.0',
  icon: 'Settings',
  // One sidebar entry (the hub) plus its tabs (#110). The hub's own main tab
  // takes order 0; guest plugins contributing a tab here use order >= 100.
  navigation: [
    {
      path: '/settings',
      titleKey: 'nav.settings',
      icon: 'Settings',
      section: 'system',
      hubId: 'settings',
    },
    {
      path: '/settings',
      titleKey: 'nav.general',
      icon: 'SlidersHorizontal',
      hub: 'settings',
      order: 0,
    },
    {
      path: '/settings/agent',
      titleKey: 'nav.agentCapabilities',
      icon: 'Bot',
      hub: 'settings',
      order: 10,
      adminOnly: true,
    },
    {
      path: '/settings/plugins',
      titleKey: 'nav.plugins',
      icon: 'Blocks',
      hub: 'settings',
      order: 20,
      adminOnly: true,
    },
    {
      path: '/settings/updates',
      titleKey: 'nav.updates',
      icon: 'RefreshCw',
      hub: 'settings',
      order: 30,
      adminOnly: true,
    },
    {
      path: '/settings/disk',
      titleKey: 'nav.disk',
      icon: 'HardDrive',
      hub: 'settings',
      order: 40,
      adminOnly: true,
    },
  ],
  // Scripting against the instance is a pro concern (#269/#282): the API
  // section of the General page is hidden in simple mode, and this key is the
  // toggle that brings it back — the lens is about depth, not about who is
  // allowed in, so the section itself stays open to every user.
  uxFeatures: [
    {
      key: 'settings.api',
      labelKey: 'settings.api.uxFeature',
    },
  ],
  core: true,
  // Instance backup (#62): instance-level configuration tables this plugin
  // administers (plugin toggles, agent-tool policies).
  exchange: {
    sections: [
      {
        key: 'settings.instance',
        labelKey: 'settings.exchange.sections.instance',
        roots: ['instance'],
      },
    ],
  },
};
