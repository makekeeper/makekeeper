import {
  registerPlugin,
  registerPrintDriver,
  useUxMode,
} from '@makekeeper/frontend-core';
import { printingNiimbotManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import NiimbotSettings from './NiimbotSettings.vue';
import PrintHandoffView from './PrintHandoffView.vue';
import { createNiimbotDriver } from './niimbot-driver';

registerPlugin({
  id: printingNiimbotManifest.id,
  nameKey: printingNiimbotManifest.nameKey,
  navigation: printingNiimbotManifest.navigation,
  uxFeatures: printingNiimbotManifest.uxFeatures,
  messages: { en, ru },
  // One route, and it is not a screen of the app: the handoff page (#361) a
  // browser near the printer opens from a one-time link. `fullscreen` renders
  // it bare (no shell chrome, the capture phone-surface pattern); `public`
  // exempts it from the auth wall — the token in the URL is the authority, and
  // it unlocks exactly one parked raster.
  routes: [
    {
      path: '/print/niimbot/:token',
      name: 'printingNiimbotHandoff',
      component: PrintHandoffView,
      meta: { fullscreen: true, public: true },
    },
  ],
  settings: {
    descriptionKey: printingNiimbotManifest.descriptionKey,
    version: printingNiimbotManifest.version,
    icon: printingNiimbotManifest.icon,
    component: NiimbotSettings,
  },
});

// The driver announces itself to the printing registry; `codes` (and anything
// else with a raster) finds it there. The lens predicate is evaluated lazily,
// after pinia is live, exactly as a slot contribution's is.
registerPrintDriver(
  createNiimbotDriver(() =>
    useUxMode().isFeatureVisible('printing-niimbot.driver'),
  ),
);
