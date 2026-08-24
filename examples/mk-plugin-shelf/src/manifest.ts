// Identity and declarations — everything the core caches at install and
// renders from while the container is down.

import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'shelf',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Layers',
  // Single-scope by default: an author writes an ordinary app with no tenancy.
  scopeModel: 'instance',
  permissions: ['inventory:read'],
  i18n: { en, ru },
  screens: ['home', 'widget'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'Layers' }],
  widgets: [
    {
      key: 'shelf.expiring',
      screen: 'widget',
      titleKey: 'widget',
      icon: 'Layers',
      size: 'panel',
    },
  ],
  tools: [
    {
      name: 'list_expiring',
      descriptionKey: 'tool',
      permission: PermissionLevel.READ,
      parameters: {
        properties: { days: { type: 'number', descriptionKey: 'toolDays' } },
      },
    },
  ],
  events: ['core.scope-deleted'],
  exchange: true,
  purgeHook: true,
};
