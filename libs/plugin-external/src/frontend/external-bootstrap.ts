import { defineComponent, h, useAttrs } from 'vue';
import type { Router, RouteRecordRaw } from 'vue-router';
import type { I18n } from 'vue-i18n';
import {
  registerPlugin,
  unregisterPlugin,
  useRealtime,
} from '@makekeeper/frontend-core';
import {
  DATA_CHANGED_EVENT,
  hubRouteName,
  type DataChangedRealtimePayload,
  type HeaderItemMeta,
} from '@makekeeper/plugin-contract';
import { externalManifest } from '../manifest';
import {
  externalI18nNamespace,
  type ExternalShellPlugin,
} from '../external-types';
import { fetchExternalShell } from './external-data';
import ExternalRouteView from './ExternalRouteView.vue';
import ExternalScreen from './ExternalScreen.vue';

// Runtime registration of external plugins (#134).
//
// Internal plugins register at import time; an external plugin cannot — it is
// discovered at runtime from the shell projection, which is built from the
// manifests cached at install. Everything here is therefore data-driven: ONE
// route component, ONE screen host, bound to (pluginId, screen) pairs.
//
// The shell is the reason a dead plugin still has a sidebar entry: nothing in
// this file talks to a plugin container.

// External screens live under a reserved path prefix so they can never collide
// with an internal plugin's routes.
export const externalScreenPath = (pluginId: string, screen: string): string =>
  `/x/${pluginId}/${screen}`;

// A widget/slot surface binds its (pluginId, screen) at registration time.
//
// A SLOT also carries the host's context: `PluginSlot` spreads its `ctx` onto
// the contribution as individual props, and those are exactly what tells the
// guest which object it is being rendered next to. They travel on as render
// params — string values only, because a param crosses an HTTP boundary and
// the plugin is not ours. Without this an external contribution could be
// mounted but never learn what it was mounted for.
const guestSurface = (
  pluginId: string,
  screen: string,
  surface: 'widget' | 'slot',
) =>
  defineComponent({
    name: `External${surface === 'widget' ? 'Widget' : 'Slot'}`,
    inheritAttrs: false,
    setup() {
      const attrs = useAttrs();
      return () => {
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(attrs)) {
          if (typeof value === 'string') params[key] = value;
        }
        return h(ExternalScreen, { pluginId, screen, surface, params });
      };
    },
  });

// A plugin's settings screen is NOT a tab of the Settings hub.
//
// It used to be, one guest tab per plugin — which reads fine with one plugin
// installed and shreds the Settings hub with five. Settings now live inside
// the plugin's own card in Settings → External plugins, expanded on demand:
// an admin already goes there to install, approve and disable a plugin, and
// its configuration is the same errand.
//
// The ROUTE stays. A plugin can send its user to its settings with a
// `navigate` command, and a link that resolves to nothing is worse than an
// extra route nobody walks in from.
const buildRoutes = (plugin: ExternalShellPlugin): RouteRecordRaw[] => {
  const routes: RouteRecordRaw[] = [];
  for (const screen of plugin.screens) {
    const item = plugin.nav.find((n) => n.screen === screen);
    const isHubTab = item?.hub !== undefined;
    routes.push({
      // A hub tab's path is relative to its hub (the shell nests it under the
      // hub's layout record); a standalone screen gets the reserved prefix.
      path: isHubTab
        ? `x-${plugin.pluginId}-${screen}`
        : externalScreenPath(plugin.pluginId, screen),
      name: `external:${plugin.pluginId}:${screen}`,
      component: ExternalRouteView,
      meta: {
        externalPluginId: plugin.pluginId,
        externalScreen: screen,
        ...(item?.hub ? { hub: item.hub } : {}),
      },
    });
  }
  return routes;
};

// Nav paths must match the routes above, including the hub-relative form.
const navPath = (plugin: ExternalShellPlugin, screen: string): string => {
  const item = plugin.nav.find((n) => n.screen === screen);
  if (!item?.hub) return externalScreenPath(plugin.pluginId, screen);
  return `/${item.hub}/x-${plugin.pluginId}-${screen}`;
};

// What is currently mounted, and how to take it back off. vue-router's
// addRoute returns a remover; without keeping them a disabled plugin's routes
// would linger and 404 on the way to a screen that no longer exists.
const mounted = new Map<
  string,
  { version: string; removeRoutes: Array<() => void> }
>();

export function registerExternalPlugin(
  plugin: ExternalShellPlugin,
  router: Router,
  i18n: I18n,
): void {
  // Locale bundles are namespaced under `ext.<pluginId>` so a third-party
  // bundle can never shadow a core or internal-plugin key (a plugin shipping
  // its own `common.save` would otherwise repaint the whole app).
  const namespace = externalI18nNamespace(plugin.pluginId);
  for (const [locale, messages] of Object.entries(plugin.i18n)) {
    i18n.global.mergeLocaleMessage(locale, {
      ext: { [plugin.pluginId]: messages },
    } as never);
  }
  // The plugin's own display name is resolvable through the same namespace.
  void namespace;

  const routes = buildRoutes(plugin);

  registerPlugin({
    id: plugin.pluginId,
    nameKey: `${namespace}.${plugin.nameKey}`,
    navigation: plugin.nav.map((item) => ({
      path: navPath(plugin, item.screen),
      titleKey: `${namespace}.${item.titleKey}`,
      icon: item.icon,
      section: item.section,
      advanced: item.advanced,
      uxFeatureKey: item.uxFeatureKey,
      hub: item.hub,
      order: item.order,
    })),
    routes,
    // Bundles are merged above (namespaced); nothing extra folds into the app.
    messages: {},
    uxFeatures: plugin.uxFeatures.map((f) => ({
      key: f.key,
      labelKey: `${namespace}.${f.labelKey}`,
      // Carried through, or a third-party plugin's simple-tier surfaces would
      // silently become pro ones (#269).
      defaultAdvanced: f.defaultAdvanced,
    })),
    dashboardWidgets: plugin.widgets.map((w) => ({
      key: w.key,
      titleKey: `${namespace}.${w.titleKey}`,
      icon: w.icon,
      size: w.size,
      order: w.order,
      advanced: w.advanced,
      component: guestSurface(plugin.pluginId, w.screen, 'widget'),
    })),
    contributions: plugin.slots.map((s) => ({
      slot: s.slot,
      order: s.order,
      component: guestSurface(plugin.pluginId, s.screen, 'slot'),
      // Namespaced here like every other key, so a header-slot host (#277)
      // resolves it with a plain $t() — indistinguishable from a built-in
      // plugin's meta.
      meta: s.labelKey
        ? ({ labelKey: `${namespace}.${s.labelKey}` } satisfies HeaderItemMeta)
        : undefined,
    })),
    // ORef → route for the entity types the plugin declared (#134/§5.9).
    refToRoute: (ref) => {
      const decl = plugin.objectRefs.find(
        (d) => d.entityType === ref.entityType,
      );
      if (!decl) return null;
      return {
        path: externalScreenPath(plugin.pluginId, decl.screen),
        query: { id: ref.entityId },
      };
    },
  });

  // vue-router is already running by now, so routes are added live. Hub tabs
  // nest under their hub's layout record; a tab whose hub is absent is silently
  // dropped — the same semantics an internal guest tab already has.
  const removeRoutes: Array<() => void> = [];
  for (const route of routes) {
    const hub = route.meta?.['hub'];
    if (typeof hub === 'string') {
      const parent = hubRouteName(hub);
      if (router.hasRoute(parent))
        removeRoutes.push(router.addRoute(parent, route));
    } else {
      removeRoutes.push(router.addRoute(route));
    }
  }
  mounted.set(plugin.pluginId, { version: plugin.version, removeRoutes });
}

// Takes a plugin back off: its routes, its registration, and with it the nav
// entries, widgets and slot contributions derived from it. The locale bundle
// stays — merged messages cannot be un-merged, and leaving unused keys behind
// is harmless where leaving a route behind is not.
export function unregisterExternalPlugin(pluginId: string): void {
  const entry = mounted.get(pluginId);
  if (!entry) return;
  for (const remove of entry.removeRoutes) remove();
  mounted.delete(pluginId);
  unregisterPlugin(pluginId);
}

// The router and i18n instance the app bootstrapped with, so a later refresh
// does not have to be handed them again — an admin action happens inside a
// component that has no business knowing how plugins are mounted.
let host: { router: Router; i18n: I18n } | null = null;

// Re-reads the shell and makes the mounted set match it: newly approved
// plugins appear, disabled or uninstalled ones disappear, and a plugin whose
// manifest changed is remounted. Called at bootstrap, after an admin action,
// and when the core says the external plugin set changed — so a menu entry
// never waits for a page reload (#150).
export async function refreshExternalPlugins(
  router?: Router,
  i18n?: I18n,
): Promise<void> {
  const target = router && i18n ? { router, i18n } : host;
  // Called before bootstrap (or after a failed one) there is nothing to mount
  // into; silently doing nothing beats throwing inside a toast handler.
  if (!target) return;
  host = target;
  const shell = await fetchExternalShell().catch(() => null);
  // A failed fetch is not an instruction to unmount everything: a flaky
  // request would otherwise blank the sidebar.
  if (!shell) return;

  const live = new Map(shell.map((plugin) => [plugin.pluginId, plugin]));
  for (const pluginId of [...mounted.keys()]) {
    const still = live.get(pluginId);
    if (!still || still.version !== mounted.get(pluginId)?.version) {
      unregisterExternalPlugin(pluginId);
    }
  }
  for (const plugin of shell) {
    if (!mounted.has(plugin.pluginId)) {
      registerExternalPlugin(plugin, target.router, target.i18n);
    }
  }
}

// The nudge carries plugin ids only, never a payload — this one says "the
// external set changed, re-read the shell".
const isExternalChange = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  Array.isArray((payload as DataChangedRealtimePayload).pluginIds) &&
  (payload as DataChangedRealtimePayload).pluginIds.includes(
    externalManifest.id,
  );

// Called once during app bootstrap, after the session/plugins stores resolve.
// Failure is non-fatal by design: the app must start even when the shell
// endpoint is unreachable — external plugins are an overlay, never a
// prerequisite.
export async function bootstrapExternalPlugins(
  router: Router,
  i18n: I18n,
): Promise<void> {
  // The core broadcasts a `data:changed` for this plugin whenever the external
  // set changes — approve, enable, disable, uninstall. Listening here rather
  // than in the shell keeps the reactivity with the plugin that owns it, and
  // covers the OTHER tabs and devices too: only the acting tab knows it acted.
  useRealtime().on(DATA_CHANGED_EVENT, (payload) => {
    if (!isExternalChange(payload)) return;
    void refreshExternalPlugins();
  });
  await refreshExternalPlugins(router, i18n);
}
