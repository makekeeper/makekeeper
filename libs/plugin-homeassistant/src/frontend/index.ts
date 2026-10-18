import { registerPlugin } from '@makekeeper/frontend-core';
import { homeassistantManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import HomeAssistantSettings from './HomeAssistantSettings.vue';

// A transport has no screen and no sidebar entry — only the connection it
// keeps. Everything it enables shows up in whichever plugin owns the device on
// the other side (#364).
registerPlugin({
  id: homeassistantManifest.id,
  nameKey: homeassistantManifest.nameKey,
  navigation: homeassistantManifest.navigation,
  // A transport has no screens of its own.
  routes: [],
  messages: { en, ru },
  settings: {
    descriptionKey: homeassistantManifest.descriptionKey,
    version: homeassistantManifest.version,
    icon: homeassistantManifest.icon,
    component: HomeAssistantSettings,
  },
});
