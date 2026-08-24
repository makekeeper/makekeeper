import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

// Notifications to the person, not to the instance.
//
// Everything here follows from one fact: a chat belongs to a HUMAN, and this
// workspace may have several. So the plugin is `per-scope` for its storage and
// keys every chat by the caller's opaque `userRef` (contract 1.4) — it can
// tell two people apart without being told who either of them is.
//
// It asks for one core permission: `logistics:read`, because it subscribes to
// `logistics.order.received` and the rule is "hearing is reading" — the
// subscription is inert until the admin grants the read. The handler re-reads
// the order through the scoped surface and quotes only what it read; other
// plugins still hand it messages through the `telegram.notify` capability.
export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 5 },
  pluginId: 'telegram',
  version: '0.2.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Send',
  scopeModel: 'per-scope',
  permissions: ['logistics:read'],
  i18n: { en, ru },
  screens: ['home', 'settings'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'Send' }],
  settingsScreen: 'settings',
  capabilities: [{ id: 'telegram.notify', version: '1' }],
  tools: [
    {
      name: 'send_me_a_message',
      descriptionKey: 'toolSend',
      // WRITE, not READ: it reaches out of the app and into someone's phone.
      // The runtime gates it behind the user's confirmation by default, which
      // is exactly right for an action a model can decide to take.
      permission: PermissionLevel.WRITE,
      parameters: {
        properties: {
          text: { type: 'string', descriptionKey: 'toolSendText' },
        },
        required: ['text'],
      },
    },
  ],
  events: ['core.scope-deleted', 'logistics.order.received'],
  purgeHook: true,
};
