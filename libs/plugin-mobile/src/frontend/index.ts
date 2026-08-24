import { registerPlugin } from '@makekeeper/frontend-core';
import type { HeaderItemMeta } from '@makekeeper/plugin-contract';
import { mobileManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { mobileRootRoute } from './routes';
import MobilePairButton from './MobilePairButton.vue';
import MobileSettingsPanel from './MobileSettingsPanel.vue';

registerPlugin({
  id: mobileManifest.id,
  nameKey: mobileManifest.nameKey,
  navigation: mobileManifest.navigation,
  messages: { en, ru },
  routes: [
    // The phone surface itself. Other plugins' phone screens are nested under
    // this record by the shell, keyed on its NAME — the same mechanism the
    // settings hub uses for guest tabs, so neither side imports the other.
    mobileRootRoute(),
  ],
  // Publishing + paired devices as one group in Settings → General (#261),
  // instead of the two Settings-hub tabs this plugin used to own.
  settings: {
    descriptionKey: mobileManifest.descriptionKey,
    version: mobileManifest.version,
    icon: mobileManifest.icon,
    component: MobileSettingsPanel,
  },
  // "Open on your phone", right of the scan icon (the codes button declares no
  // order, so it sorts at 100 and this lands after it).
  contributions: [
    {
      slot: 'app.header.scan',
      component: MobilePairButton,
      order: 110,
      // Names the collapsed row in the header's overflow menu (#277); without
      // it the row would carry the plugin's name, which reads as a section.
      meta: { labelKey: 'mobile.pairQr.label' } satisfies HeaderItemMeta,
    },
  ],
});
