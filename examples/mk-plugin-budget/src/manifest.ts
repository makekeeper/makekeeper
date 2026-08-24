import type { ExternalPluginManifest } from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 0 },
  pluginId: 'budget',
  version: '0.2.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'ShoppingBag',
  scopeModel: 'instance',
  // The grant that lets this plugin call the other one. Without it the relay
  // returns 403 — the core checks the CONSUMER's manifest, not the offerer's
  // willingness.
  permissions: ['capability:rates.convert'],
  i18n: { en, ru },
  screens: ['home'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'ShoppingBag' }],
};
