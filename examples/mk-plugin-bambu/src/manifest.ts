import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  // 1.1 for the `password` field on the settings screen.
  contract: { major: 1, minor: 1 },
  pluginId: 'bambu',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Box',
  scopeModel: 'instance',
  // Nothing. This plugin brings data IN from a machine on the network and
  // takes nothing out of the core — the narrowest possible consent screen.
  // Filament deduction would need `inventory:write`; that waits until we know
  // what the printer actually reports about usage (see README).
  permissions: [],
  i18n: { en, ru },
  screens: ['home', 'widget', 'settings'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'Box' }],
  // Mounted by the shell as a tab of the Settings hub — the same place an
  // internal plugin's settings live, so an admin looks in one spot.
  settingsScreen: 'settings',
  widgets: [
    {
      key: 'bambu.status',
      screen: 'widget',
      titleKey: 'widget',
      icon: 'Box',
      size: 'panel',
    },
  ],
  tools: [
    {
      name: 'printer_status',
      descriptionKey: 'tool',
      permission: PermissionLevel.READ,
      parameters: { properties: {} },
    },
  ],
};
