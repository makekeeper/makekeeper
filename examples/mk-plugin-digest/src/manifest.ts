import type { ExternalPluginManifest } from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'digest',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'ChartColumn',
  scopeModel: 'instance',
  // The elevated grant, and the only one. Everything this plugin does is
  // aggregate reading; it asks for no scoped grant at all, because it never
  // touches a record.
  permissions: ['instance:inventory:read'],
  i18n: { en, ru },
  screens: ['home', 'widget'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'ChartColumn' }],
  widgets: [
    {
      key: 'digest.latest',
      screen: 'widget',
      titleKey: 'name',
      icon: 'ChartColumn',
      size: 'panel',
    },
  ],
};
