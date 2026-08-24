import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the capture plugin's identity ("Фото с телефона").
// Imported by both the NestJS backend module and the Vue frontend registration.
// No sidebar navigation — the plugin is a utility surfaced through the chat
// composer (desktop) and a tokenized phone route; its only settings surface is
// the Cloudflare-tunnel configuration, shown in the Settings host.
export const captureManifest: PluginManifest = {
  id: 'capture',
  nameKey: 'plugins.capture.name',
  descriptionKey: 'plugins.capture.description',
  version: '1.0.0',
  icon: 'Smartphone',
  // Tunnel settings run/download OS binaries — instance administration.
  settingsAdminOnly: true,
  navigation: [],
  // Instance backup (#62): every uploaded attachment (rows + binaries — the
  // whole uploads tree) and the capture settings row. Media is capture's
  // domain, so this plugin carries the shared Attachment table.
  exchange: {
    sections: [
      {
        key: 'capture.attachments',
        labelKey: 'capture.exchange.sections.attachments',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        hasFiles: true,
      },
    ],
  },
};
