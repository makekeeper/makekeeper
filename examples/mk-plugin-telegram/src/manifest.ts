import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

// A DELIVERY CHANNEL for the core's notifications (#312).
//
// Everything here follows from one fact: a chat belongs to a HUMAN, and this
// workspace may have several. So the plugin is `per-scope` for its storage and
// keys every chat by the caller's opaque `userRef` (contract 1.4) — it can tell
// two people apart without being told who either of them is.
//
// What it deliberately does NOT do any more: decide who should hear about
// what. It used to subscribe to `logistics.order.received` and offer a
// `telegram.notify` capability, which made it a second, competing notification
// system — a person with it installed got two messages about one order, and had
// two places to switch that off. Now the core's bus decides and this plugin
// delivers, which is the whole of the rule:
//
//   Domain events are machine-to-machine. The notify bus is the only path to a
//   person. Want to say something? Put it on the bus. Want to deliver?
//   Declare a channel.
//
// `deliveryChannel` is its own manifest field, not an ordinary capability,
// because it is the one grant that hands a third-party container rendered TEXT
// and a person's contact — the admin has to see that when they approve it.
export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 13 },
  pluginId: 'telegram',
  version: '0.3.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Send',
  scopeModel: 'per-scope',
  // Nothing to read any more: a channel is handed what to say. The only thing
  // it needs is the right to deliver, and that is the declaration below.
  permissions: [],
  i18n: { en, ru },
  screens: ['home', 'settings'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'Send' }],
  settingsScreen: 'settings',
  deliveryChannel: { labelKey: 'channelLabel' },
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
  // Only the housekeeping one is left: when a scope goes, its chat links go
  // with it. Domain facts are the bus's business now.
  events: ['core.scope-deleted'],
  purgeHook: true,
};
