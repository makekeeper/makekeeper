import { registerPlugin } from '@makekeeper/frontend-core';
import { phoneBridgeManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import PhoneBridgeShell from './PhoneBridgeShell.vue';
import PhoneBridgeSettings from './PhoneBridgeSettings.vue';

registerPlugin({
  id: phoneBridgeManifest.id,
  nameKey: phoneBridgeManifest.nameKey,
  navigation: phoneBridgeManifest.navigation,
  messages: { en, ru },
  // The single public phone page. `fullscreen` renders it bare (no shell chrome);
  // `public` exempts it from the multiuser auth wall — the phone authenticates by
  // the unguessable session token in the URL, not a user login. The token only
  // unlocks reading this session and relaying its messages; every other surface
  // stays gated. The shell dispatches to the consumer surface by session kind.
  routes: [
    {
      path: '/d/:token',
      name: 'phoneBridge',
      component: PhoneBridgeShell,
      meta: { fullscreen: true, public: true },
    },
  ],
  // Cloudflare-tunnel configuration lives in the Settings host (admin-only).
  settings: {
    descriptionKey: phoneBridgeManifest.descriptionKey,
    version: phoneBridgeManifest.version,
    icon: phoneBridgeManifest.icon,
    component: PhoneBridgeSettings,
  },
});
