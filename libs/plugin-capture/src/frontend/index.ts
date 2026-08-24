import { registerPlugin } from '@makekeeper/frontend-core';
import { captureManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import CapturePhoneSurface from './CapturePhoneSurface.vue';
import CapturePhotoOption from './CapturePhotoOption.vue';
import CaptureChatOption from './CaptureChatOption.vue';

registerPlugin({
  id: captureManifest.id,
  nameKey: captureManifest.nameKey,
  navigation: captureManifest.navigation,
  messages: { en, ru },
  // No own routes: the phone page belongs to the bridge; capture only contributes.
  routes: [],
  // Capture is a phone-bridge consumer (#77): the tokenized phone page and the
  // tunnel now belong to the phone-bridge plugin. Capture contributes only its
  // camera surface and the desktop triggers that open the shared bridge modal.
  contributions: [
    // The phone camera UI, rendered by the bridge shell at /d/:token for a
    // session whose kind is 'capture'.
    {
      slot: 'phone-bridge.surface.capture',
      component: CapturePhoneSurface,
    },
    // Desktop triggers other plugins embed in their upload surfaces (#58):
    // a card in the logistics screenshot-import, a menu row in the chat
    // composer's attach menu. Each opens the shared phone-bridge modal.
    {
      slot: 'logistics.order-import.capture',
      component: CapturePhotoOption,
    },
    {
      slot: 'app.header.capture',
      component: CaptureChatOption,
    },
  ],
});
