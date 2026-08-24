import {
  EXCHANGE_INSTANCE_ROOT,
  PluginManifest,
} from '@makekeeper/plugin-contract';

// Single source of truth for the phone-bridge plugin's identity (#77). Imported
// by both the NestJS backend module and the Vue frontend registration.
//
// The phone-bridge owns the generic "pair a phone to the desktop" mechanism:
// the Cloudflare tunnel, the tokenized session, the QR, the single public phone
// route (/d/:token) and the realtime nudge. It carries no feature of its own —
// consumer plugins (capture, and later scan) declare a `kind` surface on top of
// it. No sidebar navigation; its only settings surface is the tunnel config,
// shown in the Settings host (admin-only — it runs/downloads OS binaries).
export const phoneBridgeManifest: PluginManifest = {
  id: 'phone-bridge',
  nameKey: 'plugins.phone-bridge.name',
  descriptionKey: 'plugins.phone-bridge.description',
  version: '1.0.0',
  icon: 'Smartphone',
  settingsAdminOnly: true,
  navigation: [],
  // Instance backup (#62): the tunnel/cloudflared settings singleton. Media
  // (the Attachment tree) stays with the capture plugin that owns it.
  exchange: {
    sections: [
      {
        key: 'phone-bridge.settings',
        labelKey: 'phoneBridge.exchange.sections.settings',
        roots: [EXCHANGE_INSTANCE_ROOT],
        hasFiles: false,
      },
    ],
  },
};
