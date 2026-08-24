// The framework-agnostic descriptor every plugin declares exactly once. Both
// the NestJS backend module and the Vue frontend registration import the same
// manifest constant, so a plugin's identity lives in a single source of truth.
//
// All user-facing text is referenced by i18n key, never as a literal — the
// plugin ships its own locale bundles (see `PluginLocaleMessages`) and the app
// resolves the keys at render time.

import type { PluginExchangeDeclaration } from './exchange';

// Where in the app's navigation an entry is placed. `main` is the primary
// sidebar stack; `system` is the pinned bottom area (settings, access). It is
// NOT a "sidebar zone" anymore: an entry that is a hub TAB (see `hub`) is never
// a sidebar item, and its section is inherited from the hub it belongs to.
export type PluginNavSection = 'main' | 'system';

// A single navigation entry contributed by a plugin: either a sidebar item, a
// sidebar item that is a tabbed HUB (`hubId`), or a TAB of some hub (`hub`).
// One flat declaration, used identically by a hub's owner and by guest plugins
// contributing a tab to someone else's hub (no cross-plugin imports, §5.10).
export interface PluginNavItem {
  // Router path the entry links to.
  path: string;
  // i18n key for the sidebar/tab label.
  titleKey: string;
  // Lucide icon name.
  icon: string;
  // Placement in app navigation; defaults to `main` when omitted. Ignored for
  // tabs (an item declaring `hub`).
  section?: PluginNavSection;
  // Shown only to multiuser admins (hidden in single-user mode too, since the
  // entry's route is admin-gated on the backend). Defaults to false.
  adminOnly?: boolean;
  // Hidden while the UI is in simple mode (see `PluginUxFeature`). Defaults to
  // false — nav entries are core surfaces unless a plugin opts one out.
  advanced?: boolean;
  // The `PluginUxFeature.key` this entry's simple-mode visibility follows. An
  // `advanced` entry SHOULD name one (declared in the same manifest's
  // `uxFeatures`), so the user's per-feature override applies to the nav entry
  // too — a bare `advanced` flag hides the entry with no toggle to bring it
  // back, which is exactly the trap #269 removed. Ignored without `advanced`.
  uxFeatureKey?: string;
  // This item is a navigation HUB: one sidebar entry whose sub-sections render
  // as tabs (every item declaring `hub: <this id>`). A hub with no visible tab
  // is not rendered at all.
  hubId?: string;
  // This item is a TAB of the named hub, not a sidebar entry. A tab whose hub
  // is unregistered — or whose owning plugin is disabled — is silently dropped,
  // the same semantics as a slot contribution.
  hub?: string;
  // Sort weight among a hub's tabs; ties keep registration order. `0` is
  // reserved for the hub owner's own main tab, guest plugins use `>= 100`.
  order?: number;
  // Names a RUNTIME source of sub-items for this entry (#288): the shell asks
  // the plugin's frontend registration for the matching provider and renders
  // whatever it returns, indented under the entry. The manifest stays pure
  // data — the provider function is bound at `registerPlugin` time, exactly as
  // a dashboard widget's component is.
  //
  // The shell never learns what the children ARE: project groups today,
  // storages or tags tomorrow.
  childrenProvider?: string;
}

// One runtime sub-item under a nav entry (#288).
export interface PluginNavChild {
  // Stable identity for the list key; unique among an entry's children.
  id: string;
  // Router path the sub-item links to.
  path: string;
  // NOTE: plain TEXT, not an i18n key — deliberately. A child is user data (a
  // folder someone named), and user data has no translation. This is the one
  // place the "every string is a key" rule inverts; do not "fix" it.
  label: string;
}

// Route-record name of a hub's layout route. A guest plugin contributing a tab
// declares `meta.hub` on its route and the shell nests it under this record —
// so the hub owner and its guests share one layout without importing each
// other (§5.10).
export function hubRouteName(hubId: string): string {
  return `hub-${hubId}`;
}

// One UI surface a plugin places under the simple/pro UX lens. In pro
// (advanced) mode every feature is visible; in simple mode the feature shows or
// hides by the user's per-feature override, falling back to `defaultAdvanced`.
// The manifest therefore sets INITIAL defaults only — the user can pull any
// feature into simple mode or push it out, from the settings UI (#269). The
// mode is a display lens only — it never changes data or API behavior.
export interface PluginUxFeature {
  // Stable id, namespaced by the owning plugin: `<pluginId>.<feature>`.
  key: string;
  // i18n key for the human-facing toggle label in the settings UI.
  labelKey: string;
  // Whether the feature starts hidden in simple mode. Defaults to TRUE — a
  // declared feature is a pro surface unless it opts into the simple tier
  // (`false`: visible by default, but demotable by the user). The default is
  // `true` deliberately: pre-#269 manifests (including external plugins')
  // declared only pro surfaces and keep their meaning unchanged.
  defaultAdvanced?: boolean;
}

// How much dashboard real estate a widget occupies. `hero` is a full-width
// block pinned to the TOP of the dashboard, above the stats row, rendering its
// own chrome (the bench, #90); `stat` is a compact key-figure tile in the top
// stats row; `panel` is a half-width card in the main grid; `full` spans the
// whole main grid row. `panel`/`full` widgets live in the collapsible
// "Insights" section below the hero.
export type PluginDashboardWidgetSize = 'hero' | 'stat' | 'panel' | 'full';

// One dashboard block a plugin publishes to the home dashboard. This is the
// declarative half of the contract (identity + placement); the Vue component
// that renders the block is bound at frontend registration time, mirroring the
// settings-panel pattern. The dashboard host renders only widgets whose owning
// plugin is enabled for the calling user.
export interface PluginDashboardWidget {
  // Stable id, namespaced by the owning plugin: `<pluginId>.<widget>`.
  key: string;
  // i18n key for the block heading (rendered by the dashboard host for
  // `panel`/`full` widgets; `stat` tiles render their own label).
  titleKey: string;
  // Lucide icon name shown next to the heading (resolved via the shared
  // plugin-icon registry).
  icon: string;
  // Placement; defaults to `panel` when omitted.
  size?: PluginDashboardWidgetSize;
  // Sort weight inside its size group — lower renders first. Defaults to 100.
  order?: number;
  // Hidden while the UI is in simple mode (same semantics as a nav entry's
  // `advanced` flag). Defaults to false.
  advanced?: boolean;
}

// ---------------------------------------------------------------------------
// Statistics declarations (ticket #56). A plugin remains the source of raw
// data; it declares WHICH metrics/graphs it can supply and WHICH charts the
// stats plugin should build from them. The stats plugin owns aggregation,
// storage and rendering — these declarations carry meaning only, no code.
// ---------------------------------------------------------------------------

// How a per-day metric is interpreted. `counter` sums per-day events (messages,
// tasks); `level` is a point-in-time reading sampled per day (stock on hand).
export type PluginStatsMetricKind = 'counter' | 'level';

// One per-day statistic a plugin can supply to the stats plugin. The plugin
// implements a matching provider handler in its backend module (see
// `StatsRegistryService.registerStatsProvider`); the stats plugin aggregates
// and stores the daily series.
export interface PluginStatsMetric {
  // Stable id, namespaced by the owning plugin: `<pluginId>.<metric>`.
  key: string;
  // i18n key for the metric label (plugin's own bundle).
  labelKey: string;
  // i18n key for the unit label (`messages`, `pcs`, …), when meaningful.
  unitKey?: string;
  kind: PluginStatsMetricKind;
  // Optional breakdown keys the metric is dimensioned by (e.g. `['provider']`).
  dimensions?: string[];
}

// A relational graph source (e.g. a Sankey flow) — a cross-sectional aggregate
// over ONE time window, with typed nodes and weighted links, NOT a per-day
// series. Declared here so a plugin can publish a graph chart through the same
// manifest contract; the backend graph provider + rendering land in a later
// phase (the declaration is forward-compatible today).
export interface PluginStatsGraph {
  // Stable id, namespaced by the owning plugin: `<pluginId>.<graph>`.
  key: string;
  // i18n key for the graph label (plugin's own bundle).
  labelKey: string;
  // Window presets the graph supports (days). Defaults are a stats-plugin concern.
  rangeDays?: number[];
}

// The chart shapes the stats plugin can render. Series forms consume per-day
// metrics; `sankey` consumes a relational graph source.
export type PluginStatsChartForm =
  | 'line'
  | 'area'
  | 'stackedArea'
  | 'bars'
  | 'heatmapCalendar'
  | 'donut'
  | 'rows'
  | 'sankey';

// One series feeding a series chart, bound to a declared metric.
export interface PluginStatsChartSeries {
  // References a `PluginStatsMetric.key` declared by the SAME plugin.
  metricKey: string;
  labelKey: string;
}

// A chart built from one or more per-day metric series (shared x = date axis).
export interface PluginStatsSeriesChart {
  kind: 'series';
  // Stable id, namespaced by the owning plugin: `<pluginId>.<chart>`.
  key: string;
  titleKey: string;
  form: Exclude<PluginStatsChartForm, 'sankey'>;
  series: PluginStatsChartSeries[];
  // Split each series into one segment per value of this dimension.
  splitByDimension?: string;
  // Initial range preset in days (still user-selectable).
  defaultRangeDays?: number;
  // Hidden while the UI is in simple mode. Defaults to false.
  advanced?: boolean;
}

// A chart built from a relational graph source (Sankey). Contract-only in the
// current phase — declared and validated, rendered later.
export interface PluginStatsGraphChart {
  kind: 'graph';
  key: string;
  titleKey: string;
  form: 'sankey';
  // References a `PluginStatsGraph.key` declared by the SAME plugin.
  graphKey: string;
  defaultRangeDays?: number;
  advanced?: boolean;
}

// A chart a plugin publishes. Discriminated on `kind`: series charts reference
// this plugin's `statsProviders` metrics; graph charts reference its
// `statsGraphs` source. The stats plugin validates these references at
// registration and renders the chart with shared frontend-core primitives.
export type PluginStatsChart = PluginStatsSeriesChart | PluginStatsGraphChart;

export type PluginSettingFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'secret'
  | 'select';

// One configurable field of a plugin's OWN settings (distinct from the agent
// capability permissions). Rendered by the settings UI and persisted through
// the settings/config service — never read from `process.env` directly.
export interface PluginSettingField {
  key: string;
  labelKey: string;
  type: PluginSettingFieldType;
  required?: boolean;
  // i18n key for helper text shown under the field.
  descriptionKey?: string;
  // For `select`: the option values plus an i18n key per option label.
  options?: { value: string; labelKey: string }[];
}

// The declarative schema for a plugin's own settings surface. A plugin without
// settings simply omits this from its manifest.
export interface PluginSettingsSchema {
  // Route the settings surface is reachable at (e.g. `/settings/inventory`).
  route: string;
  titleKey: string;
  fields: PluginSettingField[];
}

// The shared plugin descriptor. Framework-agnostic on purpose: it names the
// plugin, its icon, its navigation and (optional) settings — but not its Vue
// components or Nest module, which live on the respective side of the plugin
// library.
export interface PluginManifest {
  // Stable machine id, also the i18n namespace the plugin registers under.
  id: string;
  // i18n keys for the human-facing name/description.
  nameKey: string;
  descriptionKey: string;
  version: string;
  // Lucide icon representing the plugin as a whole.
  icon: string;
  // Sidebar entries this plugin contributes.
  navigation: PluginNavItem[];
  // Advanced UI surfaces this plugin hides in simple UX mode, each individually
  // re-enableable from the settings UI. Declared in the manifest (single source
  // of truth); the frontend registration passes them through unchanged and the
  // views gate on `useUxMode().isFeatureVisible(key)`.
  uxFeatures?: PluginUxFeature[];
  // Dashboard blocks this plugin publishes to the home dashboard. Declared in
  // the manifest (single source of truth for identity/placement); the frontend
  // registration binds each key to its Vue component via `dashboardWidgets`.
  dashboardWidgets?: PluginDashboardWidget[];
  // Per-day statistics this plugin can supply to the stats plugin (ticket #56).
  // Declarative only — the plugin implements a matching provider handler in its
  // backend module; the stats plugin aggregates and stores the series.
  statsProviders?: PluginStatsMetric[];
  // Relational graph sources (e.g. Sankey flows) this plugin can supply. The
  // graph provider + rendering land in a later phase; the declaration is
  // forward-compatible today.
  statsGraphs?: PluginStatsGraph[];
  // Charts this plugin publishes to the stats plugin, built from its own
  // declared metrics/graphs. The stats plugin owns the rendering.
  statsCharts?: PluginStatsChart[];
  // Export/import declarations (#62): the exchange roots this plugin owns and
  // the data sections it provides. Declarative only — the plugin registers a
  // matching `ExchangeSectionProvider` per section in its backend module; the
  // exchange plugin orchestrates archives from these declarations.
  exchange?: PluginExchangeDeclaration;
  // The plugin's own settings schema, when it has one.
  settings?: PluginSettingsSchema;
  // Core plugins cannot be disabled from the admin (disabling them would break
  // the app — e.g. the settings admin itself). Defaults to false when omitted.
  core?: boolean;
  // Initial enable state seeded on first registration (no PluginConfig row
  // yet). Defaults to true; opt-in overlays (multiuser) ship disabled so an
  // upgrade never changes behavior until the user flips them on.
  defaultEnabled?: boolean;
  // The plugin's settings surface is instance administration (OS interaction,
  // shared credentials) — while multi-user mode is on, only admins see and
  // change it. Regular users may still toggle the plugin itself per-user.
  // No effect in single-user mode. Defaults to false.
  settingsAdminOnly?: boolean;
  // The plugin's mutating routes act on the CALLER's private (user-bound)
  // data, never on the shared scope — so they stay usable inside a read-only
  // shared scope (e.g. chat: everyone talks in their own sessions). The DB
  // access policy still blocks scope-bound writes independently. Defaults to
  // false.
  readOnlyScopeExempt?: boolean;
  // Universal QR/barcode labelling opt-in (#74). Host-agnostic: the `codes`
  // plugin reads these declarations and contributes its buttons into the named
  // host slots, so a plugin joins labelling/scanning with one manifest line and
  // no cross-plugin imports. `labelable` — entity types this plugin owns that
  // can carry a printable label, each paired with the slot where the "Print
  // label" button mounts (the host renders `<PluginSlot :name>` with a
  // `{ entityRef }` ctx). `scan` — the slot where a contextual "Scan with
  // phone" button mounts (the host owns the ctx and the decoded-value action).
  codes?: PluginCodesDeclaration;
  // Entries this plugin contributes to the MOBILE surface (#198): the phone-
  // sized shell mounted under `/m`, whose tab bar is built from the plugin
  // registry exactly the way the sidebar is. A plugin without mobile screens
  // omits this and simply has no tab. Declarative half only — the Vue
  // components behind the paths are bound at frontend registration
  // (`mobileRoutes`), mirroring the dashboard-widget split.
  mobile?: PluginMobileNavItem[];
}

// One tab of the mobile shell's bottom bar. Deliberately thinner than
// `PluginNavItem`: the mobile surface has no hubs, no sections and no
// simple/advanced lens — it is a device shape, not an interface mode, so the
// only visibility inputs are the owning plugin's enabled state and `adminOnly`.
export interface PluginMobileNavItem {
  // Router path under the `/m` root, written in full (e.g. `/m/inventory`).
  path: string;
  // i18n key for the tab label.
  titleKey: string;
  // Lucide icon name.
  icon: string;
  // Shown only to multiuser admins. Defaults to false.
  adminOnly?: boolean;
  // Sort weight in the tab bar (lower first; ties keep registration order).
  order?: number;
}

// What a mobile ROUTE declares about its place in the phone surface, read by
// the shell off `route.meta`.
//
// It exists because the shell cannot infer either fact from the path. Which tab
// a screen belongs to looked like a prefix question and is not: the part detail
// lives at `/m/inventory/item/:id`, is opened from the STOCK tab, and by string
// nesting lit the intake tab instead. And "where does back go" has no path
// answer at all — an installed PWA opened on a deep link has no history to pop,
// so `router.back()` there walks the person out of the app.
//
// Declared, never guessed, and by the plugin that owns the screen: the shell
// stays ignorant of anybody's drill-downs, exactly as it is of their tabs.
export interface MobileRouteMeta {
  // The tab path this screen belongs under, when it is not the tab root itself.
  // Without it the shell falls back to the longest matching tab path.
  tab?: string;
  // Where the back arrow leads. A tab root declares none — there is nothing to
  // climb out of — and simply gets a header with no arrow.
  parent?: string;
  // i18n key for the screen title. EVERY mobile screen declares one: the title
  // is the shell's to render, in one bar, at one size, so the surface cannot
  // drift back into the three mechanisms it had (a view's own <h1>, the shell's
  // bar, and nothing at all on the camera). Omitted only where the title is not
  // a constant — a part's name — and the screen supplies it at runtime instead.
  titleKey?: string;
  // i18n key for the line under the title, where the screen needs to say what
  // it is for. Same bar, so it cannot drift either.
  subtitleKey?: string;
}

// A host plugin's participation in the universal labelling/scanning system
// (#74). Consumed only by the `codes` plugin; framework-agnostic data.
export interface PluginCodesDeclaration {
  labelable?: PluginLabelableEntity[];
  // Contextual scanning (#74/#79). `slot`: where codes mounts the "Scan with
  // phone" trigger. `statusSlot`: optional second mount point for the live
  // indicator, so a session started here is still visible after the user
  // navigated away and came back — the host renders it wherever the context
  // itself is shown (a cell's own header), and passes the same `originRef`.
  scan?: { slot: string; statusSlot?: string };
}

export interface PluginLabelableEntity {
  // Lowercase-kebab entity type this plugin owns (matches the ORef entityType).
  entityType: string;
  // Slot name where the host renders `<PluginSlot :ctx="{ entityRef }">` so the
  // codes plugin can mount its "Print label" button for that entity.
  slot: string;
}

// The manifest as sent to the frontend, augmented with the plugin's current
// state. Returned by `GET /api/plugins`.
// - `isEnabled` is the EFFECTIVE state for the calling user (instance state
//   narrowed by their per-user set and, in a shared scope, the grant) — what
//   the sidebar/router/settings host consume.
// - `instanceEnabled` is the raw instance-level toggle — what the plugins
//   admin manages. Identical to `isEnabled` in single-user mode.
export type PluginPublic = PluginManifest & {
  isEnabled: boolean;
  instanceEnabled: boolean;
};

// Shape of a plugin's locale bundle: `{ en: {...}, ru: {...} }`. Merged into
// the app's i18n under the plugin's `id` namespace at registration time.
export type PluginLocaleMessages = Record<string, Record<string, unknown>>;
