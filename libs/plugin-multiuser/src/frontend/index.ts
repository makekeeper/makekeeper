import { registerPlugin } from '@makekeeper/frontend-core';
import { hubRouteName } from '@makekeeper/plugin-contract';
import { multiuserManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import LoginView from './LoginView.vue';
import SharingView from './SharingView.vue';
import AdminUsersView from './AdminUsersView.vue';
import MyPluginsView from './MyPluginsView.vue';
import MultiuserSettingsPanel from './MultiuserSettingsPanel.vue';
import MobileSignInPanel from './MobileSignInPanel.vue';
import AccessHubView from './AccessHubView.vue';
import { useModeTransitionStore } from './transition-store';

export { default as UserMenu } from './UserMenu.vue';
export { default as ModeTransitionOverlay } from './ModeTransitionOverlay.vue';

// Flipping this plugin swaps the app's entire auth/data universe, so both
// directions play the fullscreen transition effect and end in a hard reload:
// a guaranteed purge of every component-local cache (same rationale as the
// scope switcher). After the reload the router guard does the rest — enabling
// lands the anonymous admin on /login (register-first when no accounts exist),
// disabling lands on the single-user dashboard.
const playAndReload = async (
  phase: 'enabling' | 'disabling',
): Promise<void> => {
  await useModeTransitionStore().play(phase);
  window.location.assign('/');
};

registerPlugin({
  id: multiuserManifest.id,
  nameKey: multiuserManifest.nameKey,
  navigation: multiuserManifest.navigation,
  onInstanceEnabled: () => playAndReload('enabling'),
  onInstanceDisabled: () => playAndReload('disabling'),
  settings: {
    descriptionKey: multiuserManifest.descriptionKey,
    version: multiuserManifest.version,
    icon: multiuserManifest.icon,
    component: MultiuserSettingsPanel,
  },
  // The phone's sign-in form (#207). The mobile plugin owns the screen and
  // knows nothing about passwords; this owns the form and knows nothing about
  // phones — and with multi-user mode off there is no contribution, so the
  // screen is empty of its own accord instead of by a gate someone wrote.
  contributions: [
    {
      slot: 'mobile.auth.password',
      component: MobileSignInPanel,
    },
  ],
  routes: [
    {
      // Bare page outside the shell; `public` lets the router guard admit
      // anonymous visitors while multi-user mode is on.
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { fullscreen: true, public: true },
    },
    // The Access hub (#110): a container layout whose tabs are its children. No
    // index child — `/access` itself redirects to the first tab the user may see.
    {
      path: '/access',
      name: hubRouteName('access'),
      component: AccessHubView,
      children: [
        {
          path: 'users',
          name: 'multiuser-users',
          component: AdminUsersView,
          meta: { adminOnly: true },
        },
        {
          path: 'sharing',
          name: 'multiuser-sharing',
          component: SharingView,
        },
        {
          path: 'my-plugins',
          name: 'multiuser-my-plugins',
          component: MyPluginsView,
        },
      ],
    },
  ],
  messages: { en, ru },
});
