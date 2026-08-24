import { PluginManifest } from '@makekeeper/plugin-contract';

// Universal QR/barcode labelling (#74). The plugin has no sidebar entry and no
// screen of its own: scanning is only the header/contextual buttons and printing
// is a slot contribution on host detail views. Its one public route is the
// `/c/<code>` label deep-link.
export const codesManifest: PluginManifest = {
  id: 'codes',
  nameKey: 'plugins.codes.name',
  descriptionKey: 'plugins.codes.description',
  version: '1.0.0',
  icon: 'QrCode',
  navigation: [],
  // The lens (#269): printing a label is pro; SCANNING one stays basic — a
  // label someone already printed should resolve for every user of the
  // instance, whatever their interface tier. Scanning is still demotable
  // (`defaultAdvanced: false`); the public /c/<code> redirect never hides.
  uxFeatures: [
    { key: 'codes.labels', labelKey: 'codes.ux.labels' },
    {
      key: 'codes.scan',
      labelKey: 'codes.ux.scan',
      defaultAdvanced: false,
    },
  ],
};
