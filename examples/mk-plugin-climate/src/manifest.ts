import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'climate',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'HardDrive',
  scopeModel: 'instance',
  // Read-only, and only storages: the plugin builds its picker from the core's
  // own list instead of keeping a copy, and never writes anything back.
  permissions: ['storages:read'],
  i18n: { en, ru },
  screens: ['home', 'widget'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'HardDrive' }],
  widgets: [
    {
      key: 'climate.state',
      screen: 'widget',
      titleKey: 'widget',
      icon: 'HardDrive',
      size: 'panel',
    },
  ],
  tools: [
    {
      name: 'climate_status',
      descriptionKey: 'tool',
      permission: PermissionLevel.READ,
      parameters: { properties: {} },
    },
  ],
  purgeHook: true,
};
