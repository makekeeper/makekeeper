import { RouteRecordRaw, type RouteLocationRaw } from 'vue-router';
import { ref, type Component } from 'vue';
import {
  PluginDashboardWidget,
  PluginLocaleMessages,
  PluginManifest,
  PluginMobileNavItem,
  PluginNavChild,
  PluginNavItem,
  PluginStatsChart,
  PluginUxFeature,
  parseObjectRef,
  type ObjectRef,
} from '@makekeeper/plugin-contract';

// A plugin's own settings surface, rendered inside the Settings plugin's page
// as one collapsible group. The group header shows the plugin's identity
// (name/description/version/icon); the body embeds `component`.
export interface PluginSettingsPanel {
  // i18n key for the description shown under the plugin name.
  descriptionKey: string;
  // Plugin version, shown as a badge (from the manifest).
  version: string;
  // Lucide icon name for the group header.
  icon: string;
  // The plugin's settings UI, embedded in the group body.
  component: Component;
}

// A dashboard block as registered on the frontend: the manifest descriptor
// (identity + placement) bound to the Vue component that renders it.
export type DashboardWidgetRegistration = PluginDashboardWidget & {
  component: Component;
};

// A UI contribution one plugin injects into a named slot owned by another
// plugin (#58): the slot host renders `component` for every enabled
// contributor via `<PluginSlot>`. `meta`'s shape is owned by the slot's
// contract (e.g. tab slots expect `{ tabId, labelKey, icon }`); communication
// back to the host goes through callback props passed in the slot's `ctx`.
export interface PluginContribution {
  slot: string;
  component: Component;
  // Render order within the slot (lower first; default 100).
  order?: number;
  meta?: Record<string, unknown>;
  // Optional live predicate: the contribution renders only while it returns
  // true. Evaluated inside `useSlotContributions`' computed — after pinia is
  // live — so the simple/pro lens plugs in as
  // `() => useUxMode().isFeatureVisible('<key>')` (#269). Tab slots keep the
  // `meta.visible` convention instead: their host must keep a deep-linked tab
  // rendering even while the tab strip hides its entry.
  visible?: () => boolean;
}

// A contribution paired with its owning plugin id, as consumed by slot hosts
// (the enabled-state filtering happens in `useSlotContributions`).
export type RegisteredContribution = PluginContribution & { pluginId: string };

// The frontend face of a plugin: everything the SPA needs to mount it —
// its routes, its sidebar entries, its own i18n bundle, and (optionally) its
// own settings panel. Registered once, as an import side-effect, from the
// plugin library's frontend entry point.
export interface FrontendPlugin {
  id: string;
  // i18n key for the plugin's display name.
  nameKey: string;
  // Sidebar entries this plugin contributes (already carrying i18n keys).
  navigation: PluginNavItem[];
  routes: RouteRecordRaw[];
  // The plugin's tabs in the mobile shell's bottom bar (#198), passed through
  // from the manifest. Omitted when the plugin has no mobile surface.
  mobileNavigation?: PluginMobileNavItem[];
  // Routes mounted as children of the `/m` shell. Kept apart from `routes` so
  // the desktop router never sees them and the mobile shell never sees desktop
  // routes; both carry the same `meta.pluginId` stamp for the disabled-plugin
  // guard.
  mobileRoutes?: RouteRecordRaw[];
  // `{ en: {...}, ru: {...} }` — merged into the app's i18n at bootstrap.
  messages: PluginLocaleMessages;
  // The plugin's own settings surface, shown in the Settings plugin. Omitted
  // when the plugin has no settings of its own.
  settings?: PluginSettingsPanel;
  // Advanced UI surfaces this plugin hides in simple UX mode, each individually
  // re-enableable from the settings UI. Views gate on
  // `useUxMode().isFeatureVisible(key)`; the keys declared here drive the
  // settings toggles. Omitted when the plugin has no advanced surfaces.
  uxFeatures?: PluginUxFeature[];
  // Dashboard blocks this plugin publishes, each binding a manifest-declared
  // descriptor to its component (see `bindDashboardWidgets`). Omitted when the
  // plugin publishes nothing to the dashboard.
  dashboardWidgets?: DashboardWidgetRegistration[];
  // UI this plugin injects into other plugins' named slots (#58). Omitted when
  // the plugin contributes nothing. Rendered only while this plugin is enabled.
  contributions?: PluginContribution[];
  // Charts this plugin publishes to the stats plugin (ticket #56). Pure
  // declarations (form + series/graph) — the stats plugin owns the rendering, so
  // no component binding happens here (unlike `dashboardWidgets`). Passed through
  // from the manifest unchanged. Omitted when the plugin declares no charts.
  statsCharts?: PluginStatsChart[];
  // Frontend counterparts of the backend lifecycle hooks: fired in the acting
  // admin's browser right after the instance-level toggle succeeds (state
  // already refetched). A plugin whose enable/disable changes the app's whole
  // behavior (e.g. multiuser) uses these for its transition UX. Errors are
  // logged, never rolled back — the toggle itself already happened.
  onInstanceEnabled?: () => Promise<void> | void;
  onInstanceDisabled?: () => Promise<void> | void;
  // Runtime sub-items for this plugin's nav entries (#288), keyed by the
  // `childrenProvider` name the manifest entry declares. The manifest stays pure
  // data and the function is bound here, exactly as a dashboard widget binds its
  // component. Each provider is called inside the sidebar's computed, so a
  // reactive source (a pinia store) re-renders the sub-items on its own.
  navChildrenProviders?: Record<string, () => PluginNavChild[]>;
  // Turns a canonical ORef this plugin owns into a navigable vue-router location, so
  // an ORef in an assistant reply renders as a clickable link (#16). Given a parsed
  // ObjectRef whose pluginId is this plugin's id; returns null for an entity type it
  // doesn't map to a route.
  refToRoute?: (ref: ObjectRef) => RouteLocationRaw | null;
}

// Resolve a canonical ORef string to a navigable route, or null when it is
// unparseable, owned by an unregistered plugin, or of a type the owning plugin
// doesn't map. The single frontend entry point for turning an ORef into a link.
export function resolveObjectRefRoute(ref: string): RouteLocationRaw | null {
  const parsed = parseObjectRef(ref);
  if (!parsed) return null;
  const plugin = activePlugins.find((p) => p.id === parsed.pluginId);
  return plugin?.refToRoute?.(parsed) ?? null;
}

// A nav entry paired with its owning plugin id, as consumed by the shell.
export type RegisteredNavItem = PluginNavItem & { pluginId: string };

// A settings panel paired with its owning plugin's id + name key, as consumed
// by the Settings host to render one group per plugin.
export type RegisteredSettingsPanel = PluginSettingsPanel & {
  pluginId: string;
  nameKey: string;
};

const activePlugins: FrontendPlugin[] = [];

// Bumped whenever the SET of registered plugins changes. The array itself is
// deliberately plain — it is read on every navigation render and reactivity on
// its contents would buy nothing — but consumers derived from it (the sidebar,
// hub tabs, slot contributions) must re-evaluate when a plugin is registered
// or removed at runtime, which only happens for external plugins (#150).
const registryVersion = ref(0);

// Read this inside a computed to make it re-run when plugins come and go.
export const pluginRegistryVersion = registryVersion;

export function registerPlugin(plugin: FrontendPlugin): void {
  // Stamp each route with its owning plugin id so the router guard can redirect
  // away from a disabled plugin's routes. A plugin may own no routes (e.g. a
  // contribution-only consumer like capture, #77), so guard the optional field.
  for (const route of [
    ...(plugin.routes ?? []),
    ...(plugin.mobileRoutes ?? []),
  ]) {
    // `/plugins/` belongs to the web proxy of external plugins' public paths
    // (#250): a request there never reaches the SPA in production, so a route
    // claiming the prefix would work in dev and 404 deployed. Fail loud at
    // registration instead. The message is a machine-facing invariant breach,
    // thrown as a code per the error convention.
    if (route.path === '/plugins' || route.path.startsWith('/plugins/')) {
      throw new Error('core.errors.reservedRoutePrefix');
    }
    route.meta = { ...route.meta, pluginId: plugin.id };
  }
  activePlugins.push(plugin);
  registryVersion.value += 1;
}

// Removes a plugin registered at RUNTIME. Internal plugins never need this —
// they are imported once and live as long as the tab — but an external plugin
// can be disabled or uninstalled while the app is open, and its menu entry
// must go with it rather than waiting for a reload (#150). Routes are removed
// by their owner, which holds the removers vue-router returned.
export function unregisterPlugin(pluginId: string): void {
  const index = activePlugins.findIndex((p) => p.id === pluginId);
  if (index >= 0) {
    activePlugins.splice(index, 1);
    registryVersion.value += 1;
  }
}

export function getActivePlugins(): FrontendPlugin[] {
  return activePlugins;
}

export function getFrontendPlugin(
  pluginId: string,
): FrontendPlugin | undefined {
  return activePlugins.find((p) => p.id === pluginId);
}

export function getPluginRoutes(): RouteRecordRaw[] {
  return activePlugins.flatMap((p) => p.routes ?? []);
}

// Flattened navigation entries across all plugins (sidebar items, hubs and hub
// tabs alike), each tagged with its plugin id. Unfiltered — consumers take the
// visible view through `useSidebarNav` / `useHubTabs` (see navigation.ts), which
// own the single visibility filter.
export function getPluginNavigation(): RegisteredNavItem[] {
  return activePlugins.flatMap((p) =>
    p.navigation.map((item) => ({ ...item, pluginId: p.id })),
  );
}

// The runtime sub-items of a nav entry, or an empty list when the entry names
// no provider, its plugin registered none under that name, or the provider
// throws. The shell calls this and renders what comes back — it never learns
// what the children are (project groups today, storages tomorrow).
export function getNavChildren(item: RegisteredNavItem): PluginNavChild[] {
  if (!item.childrenProvider) return [];
  const provider = activePlugins.find((p) => p.id === item.pluginId)
    ?.navChildrenProviders?.[item.childrenProvider];
  if (!provider) return [];
  try {
    return provider();
  } catch {
    // A provider that fails must cost its own sub-items, never the sidebar.
    return [];
  }
}

// What decides whether a navigation entry is visible right now. Passed in
// rather than read from the stores so the filter stays a pure function (the
// stores already import the registry — same cycle-avoidance as contributions).
export interface NavVisibility {
  isPluginEnabled: (pluginId: string) => boolean;
  multiuserEnabled: boolean;
  isAdmin: boolean;
  // The UI is in simple mode, so `advanced` entries are hidden.
  simpleMode: boolean;
  // The per-feature visibility rule (preferences store). An `advanced` entry
  // naming a `uxFeatureKey` follows it instead of the bare mode, so the user's
  // simple/pro override applies to nav entries too (#269).
  isFeatureVisible: (key: string) => boolean;
}

// THE navigation visibility rule — one implementation shared by the sidebar and
// by every hub's tab bar. `adminOnly` only applies while multi-user mode is on:
// in single-user mode there is no admin and the single user administers all.
export function isNavItemVisible(
  item: RegisteredNavItem,
  ctx: NavVisibility,
): boolean {
  // The ux lens: an entry keyed to a feature follows the feature (override
  // included); a bare `advanced` flag falls back to the mode alone — legacy,
  // kept for external manifests that predate `uxFeatureKey`.
  const uxVisible =
    item.advanced !== true ||
    (item.uxFeatureKey !== undefined
      ? ctx.isFeatureVisible(item.uxFeatureKey)
      : !ctx.simpleMode);
  return (
    ctx.isPluginEnabled(item.pluginId) &&
    uxVisible &&
    (!ctx.multiuserEnabled || item.adminOnly !== true || ctx.isAdmin)
  );
}

// Tab ordering bands (#110): `0` is reserved for a hub's own main tab, the hub
// owner's remaining tabs take 1…99, and a guest plugin contributing into
// someone else's hub starts here — so a guest can never wedge itself between
// the owner's tabs.
export const GUEST_TAB_ORDER = 100;

// A tab that declares no `order` is NOT a guest: sorting it last keeps the
// documented `(order, registration order)` rule honest, where defaulting to
// `GUEST_TAB_ORDER` would silently drop an owner's tab into the guest band.
const UNORDERED_TAB_ORDER = Number.MAX_SAFE_INTEGER;

// The visible tabs of one hub, in declaration order weighted by `order` (ties
// keep registration order — `sort` is stable). Empty for an unknown hub id.
export function getHubTabs(
  hubId: string,
  ctx: NavVisibility,
): RegisteredNavItem[] {
  return getPluginNavigation()
    .filter((item) => item.hub === hubId && isNavItemVisible(item, ctx))
    .sort(
      (a, b) =>
        (a.order ?? UNORDERED_TAB_ORDER) - (b.order ?? UNORDERED_TAB_ORDER),
    );
}

// THE "is this navigation entry the one the current route belongs to" rule,
// shared by the sidebar and by every tab bar (#110). Active on an exact match
// OR when the route drills into the entry (`/inventory/123` keeps `/inventory`
// lit). The `+ '/'` guards against the root entry (`/`) matching everything and
// against sibling-prefix collisions (`/inventoryX` must not light `/inventory`).
export function isNavPathActive(routePath: string, navPath: string): boolean {
  return routePath === navPath || routePath.startsWith(`${navPath}/`);
}

// The same question for the MOBILE tab bar, where the answer above is not enough
// on its own.
//
// A phone screen may DECLARE the tab it belongs to (`MobileRouteMeta.tab`), and
// the declaration wins outright, because the path tree is not the drill-down
// tree: the part detail is spelled `/m/inventory/item/:id` — nested under the
// intake tab — while it is opened from Stock and belongs there. Tapping a part
// on one tab and watching the highlight jump to another is what this exists to
// stop, and no prefix rule can know it.
//
// Anything that declares nothing keeps the old behaviour: the LONGEST tab path
// the route sits under. Longest, not first — `/m` is a prefix of every mobile
// path, so a first-match rule would light Home from everywhere.
export function resolveActiveTab(
  routePath: string,
  declaredTab: string | null,
  tabPaths: readonly string[],
): string | null {
  if (declaredTab !== null) return declaredTab;
  return tabPaths
    .filter((path) => isNavPathActive(routePath, path))
    .reduce<
      string | null
    >((best, path) => (best === null || path.length > best.length ? path : best), null);
}

// The visible sidebar entries: plain items and hubs, never tabs. A hub with no
// visible tab has nothing to show, so it is dropped entirely (e.g. `access` for
// a regular user whose sharing and my-plugins tabs are both unavailable).
export function getSidebarNav(ctx: NavVisibility): RegisteredNavItem[] {
  const registered = getPluginNavigation();
  return registered.filter(
    (item) =>
      item.hub === undefined &&
      isNavItemVisible(item, ctx) &&
      (item.hubId === undefined ||
        registered.some(
          (tab) => tab.hub === item.hubId && isNavItemVisible(tab, ctx),
        )),
  );
}

// A mobile tab paired with its owning plugin id, as consumed by the mobile
// shell's tab bar.
export type RegisteredMobileNavItem = PluginMobileNavItem & {
  pluginId: string;
};

// Every mobile route across all plugins, mounted as children of the `/m` shell.
export function getMobileRoutes(): RouteRecordRaw[] {
  return activePlugins.flatMap((p) => p.mobileRoutes ?? []);
}

// The visible tabs of the mobile shell, ordered. Reuses the SAME enabled/admin
// inputs as the sidebar, minus the simple/advanced lens: the mobile surface is
// a device shape, not an interface mode (#198), so `simpleMode` never hides a
// tab — otherwise a user in simple mode would find the phone app empty.
export function getMobileNav(ctx: NavVisibility): RegisteredMobileNavItem[] {
  return activePlugins
    .flatMap((p) =>
      (p.mobileNavigation ?? []).map((item) => ({ ...item, pluginId: p.id })),
    )
    .filter(
      (item) =>
        ctx.isPluginEnabled(item.pluginId) &&
        (!ctx.multiuserEnabled || item.adminOnly !== true || ctx.isAdmin),
    )
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// A UX feature paired with its owning plugin's id + name key, as consumed by
// the settings UI to render per-feature simple-mode toggles grouped by plugin.
export type RegisteredUxFeature = PluginUxFeature & {
  pluginId: string;
  nameKey: string;
};

// Advanced-mode features across all plugins that declare any, tagged with the
// owning plugin's identity for grouping in the settings UI.
export function getPluginUxFeatures(): RegisteredUxFeature[] {
  return activePlugins.flatMap((p) =>
    (p.uxFeatures ?? []).map((f) => ({
      ...f,
      pluginId: p.id,
      nameKey: p.nameKey,
    })),
  );
}

// Every configurable simple/pro toggle the settings UI should offer: the
// declared `uxFeatures` PLUS every `advanced` stats chart and dashboard widget
// (their simple/pro split is declared in the manifest, and the user can flip
// each in simple mode — same override machinery as a uxFeature, keyed by the
// chart/widget key).
//
// Deduped by key, first declaration winning: a chart and a dashboard widget
// deliberately SHARE a key when they are the same feature on two screens
// (`inventory.stockTimeline` is both), and one feature must offer exactly one
// switch — not two rows that write the same override.
export function getConfigurableFeatures(): RegisteredUxFeature[] {
  const all = activePlugins.flatMap((p) => [
    ...(p.uxFeatures ?? []).map((f) => ({
      ...f,
      pluginId: p.id,
      nameKey: p.nameKey,
    })),
    ...(p.statsCharts ?? [])
      .filter((c) => c.advanced === true)
      .map((c) => ({
        key: c.key,
        labelKey: c.titleKey,
        defaultAdvanced: true,
        pluginId: p.id,
        nameKey: p.nameKey,
      })),
    ...(p.dashboardWidgets ?? [])
      .filter((w) => w.advanced === true)
      .map((w) => ({
        key: w.key,
        labelKey: w.titleKey,
        defaultAdvanced: true,
        pluginId: p.id,
        nameKey: p.nameKey,
      })),
  ]);
  const byKey = new Map<string, RegisteredUxFeature>();
  for (const feature of all) {
    if (!byKey.has(feature.key)) byKey.set(feature.key, feature);
  }
  return [...byKey.values()];
}

// key → "hidden in simple mode by default". The preferences store's
// `isFeatureVisible` falls back to this when the user holds no override for
// the key, so the manifests set initial defaults ONLY (#269). Cached per
// registry version — the rule runs per nav item per render.
let uxDefaultsCache: { version: number; map: Map<string, boolean> } | null =
  null;

export function isUxFeatureAdvancedByDefault(key: string): boolean {
  if (uxDefaultsCache?.version !== registryVersion.value) {
    const map = new Map<string, boolean>();
    for (const f of getConfigurableFeatures()) {
      map.set(f.key, f.defaultAdvanced !== false);
    }
    uxDefaultsCache = { version: registryVersion.value, map };
  }
  // An undeclared key keeps the pre-#269 semantics: a view that gates on a key
  // nobody declared behaves as a pro surface. Declaring the key is what makes
  // it user-configurable — the lint for that is the settings panel itself.
  return uxDefaultsCache.map.get(key) ?? true;
}

// A dashboard widget paired with its owning plugin id, as consumed by the
// dashboard host to filter by the plugin's enabled state.
export type RegisteredDashboardWidget = DashboardWidgetRegistration & {
  pluginId: string;
};

// Binds manifest-declared dashboard widgets to their Vue components by key.
// Keeps the manifest the single source of truth for identity/placement while
// the component stays a frontend concern (the settings-panel split, applied
// per-widget). A descriptor with no component in the map is dropped — it has
// nothing to render.
export function bindDashboardWidgets(
  widgets: PluginDashboardWidget[] | undefined,
  components: Record<string, Component>,
): DashboardWidgetRegistration[] {
  return (widgets ?? []).flatMap((widget) => {
    const component = components[widget.key];
    return component ? [{ ...widget, component }] : [];
  });
}

// Dashboard widgets across all plugins, tagged with the owning plugin id and
// sorted by `order` (stable within equal weights). The dashboard host is the
// single consumer; it still filters by plugin enabled state and UX mode.
export function getPluginDashboardWidgets(): RegisteredDashboardWidget[] {
  return activePlugins
    .flatMap((p) =>
      (p.dashboardWidgets ?? []).map((w) => ({ ...w, pluginId: p.id })),
    )
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// A stats chart declaration paired with its owning plugin id, as consumed by
// the stats plugin to render it (filtering by the plugin's enabled state).
export type RegisteredStatsChart = PluginStatsChart & { pluginId: string };

// Stats charts across all plugins that declare any (ticket #56), tagged with
// the owning plugin id. Returns the discriminated union as-is; the stats plugin
// renders `kind: 'series'` charts today and reserves the `kind: 'graph'`
// (Sankey) branch for a later phase. The stats plugin still filters by the
// plugin's enabled state, like the dashboard host does for widgets.
export function getPluginStatsCharts(): RegisteredStatsChart[] {
  return activePlugins.flatMap((p) =>
    (p.statsCharts ?? []).map((c) => ({ ...c, pluginId: p.id })),
  );
}

// Contributions targeting `slot` across all plugins, tagged with the owning
// plugin id and sorted by `order`. Registry-level and unfiltered — slot hosts
// consume the enabled-only view via `useSlotContributions` (kept apart to
// avoid a registry ↔ plugins-store import cycle).
export function getSlotContributions(slot: string): RegisteredContribution[] {
  return activePlugins
    .flatMap((p) =>
      (p.contributions ?? [])
        .filter((c) => c.slot === slot)
        .map((c) => ({ ...c, pluginId: p.id })),
    )
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// Manifest-driven contributions (#74): a plugin whose target slots aren't known
// until the plugin manifests load (their names are declared in OTHER plugins'
// manifests) registers a provider that, given the live manifest list, yields the
// contributions to mount. This keeps such a plugin host-agnostic — a host opts
// in with a manifest field, no hardcoded slot names on either side. The provider
// is re-run reactively by `useSlotContributions` as the manifest list resolves.
type ManifestContributionProvider = (
  manifests: PluginManifest[],
) => PluginContribution[];

const manifestContributionProviders: {
  pluginId: string;
  provide: ManifestContributionProvider;
}[] = [];

export function registerManifestContributions(
  pluginId: string,
  provide: ManifestContributionProvider,
): void {
  manifestContributionProviders.push({ pluginId, provide });
}

// The manifest-driven contributions targeting `slot`, tagged with their owning
// plugin id. Given the manifest list (from the plugins store); enabled-state
// filtering happens in `useSlotContributions`, like `getSlotContributions`.
export function getManifestContributions(
  manifests: PluginManifest[],
  slot: string,
): RegisteredContribution[] {
  return manifestContributionProviders
    .flatMap(({ pluginId, provide }) =>
      provide(manifests)
        .filter((c) => c.slot === slot)
        .map((c) => ({ ...c, pluginId })),
    )
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// Settings panels of every plugin that declares one, tagged with the owning
// plugin's id + name key. Consumed by the Settings host (one group per plugin).
export function getPluginSettingsPanels(): RegisteredSettingsPanel[] {
  return activePlugins
    .filter((p): p is FrontendPlugin & { settings: PluginSettingsPanel } =>
      Boolean(p.settings),
    )
    .map((p) => ({ ...p.settings, pluginId: p.id, nameKey: p.nameKey }));
}
