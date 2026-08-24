import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'loans',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'Share2',
  // The declaration that changes everything: this plugin promises to keep
  // scopes apart in its own storage, and the core may enable it everywhere.
  scopeModel: 'per-scope',
  permissions: [],
  i18n: { en, ru },
  screens: ['home', 'widget'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'Share2' }],
  widgets: [
    {
      key: 'loans.out',
      screen: 'widget',
      titleKey: 'count',
      icon: 'Share2',
      size: 'stat',
    },
  ],
  tools: [
    {
      name: 'list_loans',
      descriptionKey: 'tool',
      permission: PermissionLevel.READ,
      parameters: { properties: {} },
    },
  ],
  events: ['core.scope-deleted'],
  purgeHook: true,
};
