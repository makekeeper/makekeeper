import { PluginManifest } from '@makekeeper/plugin-contract';

// The mobile surface as a plugin of its own.
//
// It started life in the core (#198/#199) and moved here so that disabling it
// removes EXACTLY its functionality, like every other plugin: the `/m` shell,
// pairing, the phone tabs other plugins contribute, the header pairing button
// and its settings. An instance that will never be used from a phone should not
// carry any of that.
export const mobileManifest: PluginManifest = {
  id: 'mobile',
  nameKey: 'plugins.mobile.name',
  descriptionKey: 'plugins.mobile.description',
  version: '1.0.0',
  icon: 'Smartphone',
  // No navigation at all: the desktop never navigates INTO the phone shell, and
  // what this plugin administers is one group in Settings → General like every
  // other plugin's settings (#261) — it used to spend two tabs of the Settings
  // hub on it.
  navigation: [],
  // Deliberately NOT `settingsAdminOnly`: the group is mixed. Its publishing
  // half is instance administration and hides itself from a regular user (the
  // backend routes carry @AdminOnly to match), while its devices half is that
  // user's own paired phones and must stay reachable — the flag would take both.
  // See MobileSettingsPanel.vue.
  // Instance backup (#62): the singleton settings row.
  exchange: {
    sections: [
      {
        key: 'mobile.instance',
        labelKey: 'mobile.exchange.sections.instance',
        roots: ['instance'],
      },
    ],
  },
};
