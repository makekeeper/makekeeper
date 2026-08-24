import type { RouteRecordRaw } from 'vue-router';
import {
  MOBILE_LOGIN_ROUTE_NAME,
  MOBILE_PAIR_ROUTE_NAME,
  MOBILE_ROOT_PATH,
  MOBILE_ROOT_ROUTE_NAME,
  type MobileRouteMeta,
} from '@makekeeper/plugin-contract';
import MobileShell from './MobileShell.vue';
import MobileHomeView from './MobileHomeView.vue';
import MobileLoginView from './MobileLoginView.vue';
import MobilePairView from './MobilePairView.vue';

// The mobile surface's route root (#198). Entered explicitly only — nothing
// redirects here by screen width, so a phone opening a deep link still gets the
// full app.
//
// The record is named, and other plugins' phone screens are nested under that
// NAME by the shell — the same trick the settings hub uses for guest tabs, so no
// plugin has to know this one exists.
export function mobileRootRoute(): RouteRecordRaw {
  return {
    path: MOBILE_ROOT_PATH,
    name: MOBILE_ROOT_ROUTE_NAME,
    component: MobileShell,
    // `fullscreen` makes App.vue render this bare, without the desktop sidebar,
    // header and chat panel — the same branch the phone-bridge surfaces use.
    meta: { fullscreen: true, mobile: true },
    // Every screen states its title here rather than rendering one: the shell
    // owns the header, so the surface cannot drift back into a per-view <h1>
    // with its own padding beside a bar with none.
    children: [
      {
        path: '',
        name: 'mobile-home',
        component: MobileHomeView,
        meta: {
          titleKey: 'mobile.home.title',
          subtitleKey: 'mobile.home.subtitle',
        } satisfies MobileRouteMeta,
      },
      {
        // Public: the phone arrives here with a one-time code and nothing else
        // (#199), so the login redirect must not intercept it.
        path: 'pair',
        name: MOBILE_PAIR_ROUTE_NAME,
        component: MobilePairView,
        meta: {
          public: true,
          titleKey: 'mobile.pair.title',
          subtitleKey: 'mobile.pair.subtitle',
        } satisfies MobileRouteMeta & { public: true },
      },
      {
        // The phone's password fallback (#207) — public for the same reason the
        // pairing screen is: it is the screen you reach WITHOUT a credential.
        path: 'login',
        name: MOBILE_LOGIN_ROUTE_NAME,
        component: MobileLoginView,
        meta: {
          public: true,
          titleKey: 'mobile.login.title',
          subtitleKey: 'mobile.login.subtitle',
        } satisfies MobileRouteMeta & { public: true },
      },
    ],
  };
}
