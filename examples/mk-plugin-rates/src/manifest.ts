import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 6 },
  pluginId: 'rates',
  version: '0.2.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'ArrowLeftRight',
  scopeModel: 'instance',
  // Reads nothing from the core: it brings data IN, it does not take any out.
  permissions: [],
  i18n: { en, ru },
  screens: ['home', 'settings'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'ArrowLeftRight' }],
  settingsScreen: 'settings',
  tools: [
    {
      name: 'convert_currency',
      descriptionKey: 'tool',
      permission: PermissionLevel.READ,
      parameters: {
        properties: {
          amount: { type: 'number', descriptionKey: 'toolAmount' },
          from: { type: 'string', descriptionKey: 'toolFrom' },
          to: { type: 'string', descriptionKey: 'toolTo' },
          date: { type: 'string', descriptionKey: 'toolDate' },
        },
        required: ['amount', 'from', 'to'],
      },
    },
  ],
  // The offer. Same id and methods across versions — consumers do not care
  // that the numbers stopped being hardcoded.
  capabilities: [{ id: 'rates.convert', version: '1.1' }],
};
