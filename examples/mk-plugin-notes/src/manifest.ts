import {
  PermissionLevel,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';
import { en } from './i18n/en.ts';
import { ru } from './i18n/ru.ts';

// A note is attached to ONE object and belongs to ONE person.
//
// Two declarations carry that. `scopeModel: 'per-scope'` promises the plugin
// keeps workspaces apart in its own storage. No `permissions` at all: a note
// references an object by its canonical ORef and never needs to read it — the
// core resolves the reference into a link when it renders one.
export const manifest: ExternalPluginManifest = {
  contract: { major: 1, minor: 4 },
  pluginId: 'notes',
  version: '0.1.0',
  nameKey: 'name',
  descriptionKey: 'description',
  icon: 'StickyNote',
  scopeModel: 'per-scope',
  permissions: [],
  i18n: { en, ru },
  screens: ['home', 'aside'],
  nav: [{ screen: 'home', titleKey: 'nav', icon: 'StickyNote' }],
  // The same screen, mounted next to an inventory item. The host passes the
  // item's ORef as slot context; the screen renders that object's notes.
  slots: [{ slot: 'inventory.form.aside', screen: 'aside' }],
  tools: [
    {
      name: 'list_my_notes',
      descriptionKey: 'toolList',
      permission: PermissionLevel.READ,
      parameters: { properties: {} },
    },
  ],
  events: ['core.scope-deleted'],
  purgeHook: true,
};
