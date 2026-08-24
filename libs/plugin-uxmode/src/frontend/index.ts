import { registerPlugin } from '@makekeeper/frontend-core';
import { uxmodeManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import UxModeSettings from './UxModeSettings.vue';

registerPlugin({
  id: uxmodeManifest.id,
  nameKey: uxmodeManifest.nameKey,
  navigation: uxmodeManifest.navigation,
  messages: { en, ru },
  routes: [],
  // The per-feature override panel, hosted by the Settings plugin. The header
  // segmented toggle is rendered by the shell (App.vue) while this plugin is
  // enabled — same pattern as the chat panel.
  settings: {
    descriptionKey: uxmodeManifest.descriptionKey,
    version: uxmodeManifest.version,
    icon: uxmodeManifest.icon,
    component: UxModeSettings,
  },
});
