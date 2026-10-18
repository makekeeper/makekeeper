import { PluginManifest } from '@makekeeper/plugin-contract';

// Single source of truth for the Niimbot print-driver plugin's identity (#359).
//
// The plugin is a DRIVER: it owns one pocket thermal printer family and nothing
// else — no screen, no sidebar entry, no data. Whoever has a raster to print
// (today `codes`) finds it through the printing registry, so the plugin never
// learns what a label is and `codes` never learns what Bluetooth is.
//
// Its settings panel is MIXED, which is why it is not `settingsAdminOnly`:
// what belongs to this browser (the Web Bluetooth device it was granted) has
// to stay visible to whoever is looking at it, while what belongs to the
// instance — how the printer burns, what roll is in it, which Home Assistant
// printer to send to — is written by an admin alone, guarded on the routes
// themselves (#364, #366).
export const printingNiimbotManifest: PluginManifest = {
  id: 'printing-niimbot',
  nameKey: 'plugins.printing-niimbot.name',
  descriptionKey: 'plugins.printing-niimbot.description',
  version: '1.0.0',
  icon: 'Printer',
  navigation: [],
  // The lens (#269): a direct-to-printer button beside the system print dialog
  // is a pro surface. Hidden in simple mode, re-enableable per feature.
  uxFeatures: [
    {
      key: 'printing-niimbot.driver',
      labelKey: 'printingNiimbot.ux.driver',
    },
  ],
};
