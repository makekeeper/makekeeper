import { registerPlugin } from '@makekeeper/frontend-core';
import { hubRouteName } from '@makekeeper/plugin-contract';
import { settingsManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import SettingsView from './SettingsView.vue';
import AgentCapabilitiesView from './AgentCapabilitiesView.vue';
import PluginsAdminView from './PluginsAdminView.vue';
import UpdatesView from './UpdatesView.vue';
import AboutView from './AboutView.vue';
import DiskUsageView from './DiskUsageView.vue';
import SettingsHubView from './SettingsHubView.vue';

registerPlugin({
  id: settingsManifest.id,
  nameKey: settingsManifest.nameKey,
  navigation: settingsManifest.navigation,
  messages: { en, ru },
  // The API section of the General page hides in simple mode (#282); this is
  // the toggle that offers it back.
  uxFeatures: settingsManifest.uxFeatures,
  // The Settings hub (#110): a layout route carrying the tab bar, with one child
  // route per tab so each keeps its own path and `meta.adminOnly` guard. The
  // record's conventional `hubRouteName` name is what lets a guest plugin nest
  // its own tab route here without either side importing the other (§5.10).
  routes: [
    {
      path: '/settings',
      name: hubRouteName('settings'),
      component: SettingsHubView,
      children: [
        { path: '', name: 'settings', component: SettingsView },
        // Instance-wide agent tool policy — admin territory in multi-user mode.
        {
          path: 'agent',
          name: 'settings-agent',
          component: AgentCapabilitiesView,
          meta: { adminOnly: true },
        },
        // Instance-wide plugin toggles — admin territory in multi-user mode.
        {
          path: 'plugins',
          name: 'settings-plugins',
          component: PluginsAdminView,
          meta: { adminOnly: true },
        },
        // What the product is and how to write to us (#342). Deliberately NOT
        // adminOnly: it is the app's route back to us, and a regular user in
        // multi-user mode is exactly the reporter we are missing today.
        {
          path: 'about',
          name: 'settings-about',
          component: AboutView,
        },
        // Instance version + update checker — admin territory in multi-user
        // mode, and a sub-path of About so the tab bar keeps About lit while an
        // admin is inside it (#342): the two are one family with one tab.
        {
          path: 'about/updates',
          name: 'settings-updates',
          component: UpdatesView,
          meta: { adminOnly: true },
        },
        // What the uploads directory is made of (#120) — reports across every
        // user's data, so admin territory in multi-user mode.
        {
          path: 'disk',
          name: 'settings-disk',
          component: DiskUsageView,
          meta: { adminOnly: true },
        },
      ],
    },
  ],
});
