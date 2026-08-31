import {
  registerNavBadgeSource,
  registerPlugin,
} from '@makekeeper/frontend-core';
import { notifyManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import NotificationBell from './NotificationBell.vue';
import NotifySettingsView from './NotifySettingsView.vue';
import RefRedirectView from './RefRedirectView.vue';
import { useNotifyStore } from './notify-store';

registerPlugin({
  id: notifyManifest.id,
  nameKey: notifyManifest.nameKey,
  navigation: notifyManifest.navigation,
  messages: { en, ru },
  // Where a link inside a channel message lands: the ORef is resolved in the
  // browser, which is the only place that knows a plugin's routes.
  routes: [
    { path: '/r/:ref', name: 'refRedirect', component: RefRedirectView },
  ],
  // One of the plugin panels under Settings → General, like every other
  // plugin's: the host renders the heading, the version and the frame, and this
  // plugin contributes only what is inside.
  settings: {
    descriptionKey: notifyManifest.descriptionKey,
    version: notifyManifest.version,
    icon: notifyManifest.icon,
    component: NotifySettingsView,
  },
  // The bell lives in the header's own slot table (#277), so the shell decides
  // where it sits and when it collapses — this plugin only says what it is.
  contributions: [
    { slot: 'app.header.notifications', component: NotificationBell },
  ],
});

// Sidebar badges (#307). The count belongs to the plugin the notification came
// FROM, so a nav entry is matched by its owner — logistics' entry carries
// logistics' unread rows, and neither plugin knows about the other.
registerNavBadgeSource(notifyManifest.id, (item) =>
  useNotifyStore().unreadFor(item.pluginId),
);
