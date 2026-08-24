import { registerPlugin } from '@makekeeper/frontend-core';
import { externalManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import ExternalPluginsView from './ExternalPluginsView.vue';

// Runtime registration of the third-party plugins themselves (#134): the app
// shell calls this after bootstrap, once the session is known.
export { bootstrapExternalPlugins } from './external-bootstrap';

registerPlugin({
  id: externalManifest.id,
  nameKey: externalManifest.nameKey,
  navigation: externalManifest.navigation,
  messages: { en, ru },
  // A guest tab of the Settings hub (#110): managing external plugins is
  // instance configuration. Admin-only — mirrored on the backend by
  // @AdminOnly() on every /external/admin route.
  routes: [
    {
      path: 'external',
      name: 'external',
      component: ExternalPluginsView,
      meta: { hub: 'settings', adminOnly: true },
    },
  ],
});
