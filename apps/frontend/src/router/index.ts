import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import HomeView from '../views/HomeView.vue';
import {
  getMobileRoutes,
  getPluginRoutes,
  usePluginsStore,
  useSessionStore,
} from '@makekeeper/frontend-core';
import {
  hubRouteName,
  MOBILE_LOGIN_PATH,
  MOBILE_PAIR_PATH,
  MOBILE_PAIR_ROUTE_NAME,
  MOBILE_ROOT_PATH,
  MOBILE_ROOT_ROUTE_NAME,
} from '@makekeeper/plugin-contract';
import { unauthorizedRedirectTarget } from './unauthorized-target';

// Title resolves from the i18n key `routeTitles.home` (see App.vue header).
const coreRoutes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: coreRoutes,
});

// Register every plugin route. A route carrying `meta.hub` is a TAB of another
// plugin's hub (#110): it is nested under that hub's layout record instead of
// being added top-level, so the guest tab renders inside the hub's tab bar
// without either plugin importing the other. Hubs go in first (a child needs its
// parent registered), and a tab whose hub is absent — its owner disabled or not
// installed — is silently dropped, like a contribution to a missing slot.
export function initializeRouter() {
  const pluginRoutes = getPluginRoutes();
  const hubOf = (route: RouteRecordRaw): string | null => {
    const hub = route.meta?.hub;
    return typeof hub === 'string' ? hub : null;
  };
  for (const route of pluginRoutes) {
    if (hubOf(route) === null) router.addRoute(route);
  }
  for (const route of pluginRoutes) {
    const hub = hubOf(route);
    if (hub === null) continue;
    const parent = hubRouteName(hub);
    if (router.hasRoute(parent)) router.addRoute(parent, route);
  }
  // Phone screens (#198) nest under whichever plugin owns the mobile shell,
  // found by the contract's route NAME rather than by knowing that plugin.
  // Absent — the mobile plugin disabled or not installed — every `/m/**` route
  // is silently dropped, exactly like a tab whose hub is missing.
  if (router.hasRoute(MOBILE_ROOT_ROUTE_NAME)) {
    for (const route of getMobileRoutes()) {
      router.addRoute(MOBILE_ROOT_ROUTE_NAME, route);
    }
  }
}

// Gate navigation: multiuser auth first (redirect to /login while the mode is
// on and the visitor is anonymous), then disabled-plugin blocking (each plugin
// route carries its owning `meta.pluginId`), then admin-only routes.
router.beforeEach(async (to) => {
  const session = useSessionStore();
  // vue-router starts the initial navigation at `app.use(router)` — before the
  // bootstrap chain in main.ts resolves. A direct link would be judged against
  // the not-yet-loaded session/plugin state (multiuser looks off, every plugin
  // looks enabled) and slip past the /login redirect, so await both here; the
  // stores dedupe against the main.ts calls.
  if (!session.bootstrapped) await session.bootstrap();
  if (session.multiuserEnabled) {
    if (!session.isAuthenticated) {
      // Phone or desktop is the same decision the 401 handler makes, so it is
      // made in the same place (#207): a phone is sent to pairing, which is a
      // screen it can actually complete, not to the desktop login form. The
      // helper answers null for a public route — the one case where an
      // anonymous visitor stays put — so the guard does not re-test that here.
      const target = unauthorizedRedirectTarget(
        to,
        router.hasRoute(MOBILE_PAIR_ROUTE_NAME),
      );
      if (target !== null) return { path: target };
    }
    // A credential in hand leaves neither sign-in screen anything to say. The
    // phone's lands back on the PHONE shell, never the desktop dashboard —
    // that was the second half of #207.
    //
    // Pairing is deliberately not bounced: a phone that signed in with a
    // password holds a JWT and no device token, and `/m/pair` is precisely
    // where it goes to get one.
    if (session.isAuthenticated) {
      if (to.path === '/login') return { path: '/' };
      if (to.path === MOBILE_LOGIN_PATH) return { path: MOBILE_ROOT_PATH };
    }
    if (to.meta.adminOnly === true && !session.isAdmin) {
      return { path: '/' };
    }
  } else if (to.path === MOBILE_LOGIN_PATH) {
    // Single-user mode has no passwords, so the phone's sign-in screen has
    // nothing to render — pairing is the only way in, and the only thing worth
    // showing (#207).
    return { path: MOBILE_PAIR_PATH };
  }
  const pluginId = to.meta.pluginId as string | undefined;
  if (pluginId) {
    const plugins = usePluginsStore();
    if (!plugins.loaded) await plugins.ensureLoaded();
    if (!plugins.isEnabled(pluginId)) {
      // Bounce within the surface the user is actually in: sending a phone from
      // a disabled plugin's mobile screen to the desktop dashboard would strand
      // them outside the shell they entered (#198).
      return { path: to.meta.mobile === true ? MOBILE_ROOT_PATH : '/' };
    }
  }
  return true;
});

export default router;
