// Self-hosted brand fonts (no runtime CDN, per §5.6). Variable builds cover the
// 400–700 weights the UI uses (font-medium/semibold/bold) in a single file each.
import '@fontsource-variable/outfit';
import '@fontsource-variable/inter';
// themes.css is NOT imported here: index.html links it directly so the scheme
// variables are in the cascade before the anti-FOUC script runs (#236).
import './styles.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './app/App.vue';
import router, { initializeRouter } from './router';
import { MOBILE_PAIR_ROUTE_NAME } from '@makekeeper/plugin-contract';
import { unauthorizedRedirectTarget } from './router/unauthorized-target';
// i18n bootstrap also runs the plugin loader (registers routes/nav/i18n).
import { i18n } from './i18n';
import {
  setApiLocaleProvider,
  setApiUnauthorizedHandler,
  usePluginsStore,
  useSessionStore,
} from '@makekeeper/frontend-core';
import { bootstrapExternalPlugins } from '@makekeeper/plugin-external/frontend';

const app = createApp(App);

app.use(createPinia());
app.use(i18n);

initializeRouter();

app.use(router);

// Wire the shared API client: every request carries the UI locale, and a 401
// (expired/revoked token while multi-user mode is on) drops the session and
// lands on the login screen.
setApiLocaleProvider(() => i18n.global.locale.value);
setApiUnauthorizedHandler(() => {
  useSessionStore().clearSession();
  const target = unauthorizedRedirectTarget(
    router.currentRoute.value,
    router.hasRoute(MOBILE_PAIR_ROUTE_NAME),
  );
  // Null means "stay where you are": a public page is not the login wall's
  // business, whatever some background request just answered.
  if (target) router.push(target);
});

// Resolve the multiuser session first (is the mode on? who am I?), then the
// plugin states — GET /api/plugins returns per-user effective states when a
// token is attached. Both must land before mount so the sidebar, route guard
// and login redirect reflect them from the first render.
const session = useSessionStore();
// External (out-of-process) plugins register at RUNTIME from the shell
// projection (#134) — routes, nav, widgets and i18n are data, not imports. It
// runs after the session so the request carries the caller's identity, and
// never blocks the mount: unreachable external plugins are an overlay failing,
// not the app failing.
session
  .bootstrap()
  .then(() => usePluginsStore().fetchPlugins())
  .then(() => bootstrapExternalPlugins(router, i18n))
  .finally(() => app.mount('#root'));
