# Plugin System — authoring guide

This is the canonical recipe for building and changing plugins in MakeKeeper.
Every plugin is a **self-contained NX library** that declares everything about
itself in one place: its identity, its own i18n, its AI-agent capabilities, its
optional settings, its sidebar entries and its routes. Adding a plugin means
creating one library and wiring nothing by hand in the app shells.

> Related: [`agent-capabilities.md`](agent-capabilities.md) for the READ/WRITE/
> DESTRUCTIVE tool model. Operating-manual rules live in [`CLAUDE.md`](../CLAUDE.md)
> §5.3/§5.5/§5.7 and the mirror in [`.agents/AGENTS.md`](../.agents/AGENTS.md).

---

## 1. Library layout

A plugin lives at `libs/plugin-<id>/` and is exposed through **two subpath
aliases** (declared in `tsconfig.base.json` `paths`):

```
libs/plugin-<id>/
  src/
    manifest.ts            → shared identity (id, icon, i18n keys, nav, settings)
    backend/
      index.ts             → @makekeeper/plugin-<id>/backend  (re-exports the Nest module)
      <id>.module.ts        NestJS module — registers manifest + agent tools
      <id>.controller.ts    REST controller
      <id>.service.ts       business logic (Prisma via @makekeeper/backend-core)
      <id>.dto.ts           class-validator DTOs (@MaxLength on every string)
      <id>.tools.ts         agent capability tools (withPlugin + PermissionLevel)
    frontend/
      index.ts             → @makekeeper/plugin-<id>/frontend  (registerPlugin side-effect)
      *.vue                 views
    i18n/
      en.json, ru.json      the plugin's OWN locale bundles
  project.json             NX project (tags: scope:plugin, plugin:<id>)
  tsconfig.json / tsconfig.lib.json
  eslint.config.mjs
  vue-shims.d.ts
```

Rules:

- **No cross-project relative imports.** Depend on other libs only through their
  `@makekeeper/*` alias (NX enforces this in lint).
- Backend code imports shared infra from `@makekeeper/backend-core`
  (`PrismaService`, `PluginRegistryService`, `AgentRegistryService`,
  `getErrorMessage`, `generateUuid`) and shared types from
  `@makekeeper/plugin-contract`.
- Frontend code imports shared UI + the registry from
  `@makekeeper/frontend-core` (`registerPlugin`, `Select`, `RichEditor`,
  `buildMessages`, `getPluginNavigation`).
- Libraries are **source-only** (no build target): both apps bundle them through
  tsconfig `paths` (backend via webpack/tsc, frontend via Vite `nxViteTsPaths`).

---

## 2. The manifest — one source of truth

`manifest.ts` is framework-agnostic and imported by **both** sides. It never
contains user-facing literals — only i18n keys.

```ts
import { PluginManifest } from '@makekeeper/plugin-contract';

export const inventoryManifest: PluginManifest = {
  id: 'inventory',
  nameKey: 'plugins.inventory.name',
  descriptionKey: 'plugins.inventory.description',
  version: '1.0.0',
  icon: 'Wrench', // Lucide icon name
  navigation: [{ path: '/inventory', titleKey: 'nav.inventory', icon: 'Wrench', section: 'main' }],
  // Surfaces placed under the simple/pro UX lens (see "Simple/Pro UX mode").
  uxFeatures: [{ key: 'inventory.extraFields', labelKey: 'inventory.uxFeatures.extraFields' }],
  // settings: { route, titleKey, fields: [...] }  // only if the plugin has its own settings
};
```

- `section: 'main'` → primary sidebar stack; `'system'` → pinned bottom area
  (Settings, Access). `section` means "place in app navigation", **not** "sidebar
  zone": an item that is a hub _tab_ is never a sidebar entry (see below).
- If a new `icon` name is used, add it to the `iconMap` in `App.vue` (and, for
  agent-tool groups, in `AgentCapabilitiesView.vue`).
- `core: true` marks a plugin that **cannot be disabled** from the admin (e.g.
  `settings`, `projects`). Omit it for normal, toggleable plugins.

### Simple/Pro UX mode (`uxFeatures`)

The app has a global **Simple/Pro interface mode** (header toggle +
Settings → Interface mode; persisted in `localStorage`, default `simple`). A
plugin declares each surface it places under the lens in the **manifest** as
`uxFeatures` — one entry per toggleable surface, `key` namespaced
`'<pluginId>.<feature>'`, `labelKey` pointing into the plugin's own i18n
(`<id>.uxFeatures.<feature>`, both locales), plus an optional
`defaultAdvanced`. The frontend registration passes them through
(`uxFeatures: <id>Manifest.uxFeatures`), and the `uxmode` settings panel
renders one switch per declared entry.

**The manifest sets INITIAL defaults only (#269).** `defaultAdvanced: true`
(the default when omitted) means "hidden in simple mode until the user says
otherwise"; `defaultAdvanced: false` means "visible in simple mode, but the
user may push it into Pro". Both directions are user-configurable from the
settings panel — nothing may be invisible in simple mode without a toggle that
brings it back. Effective rule (`preferences-store.isFeatureVisible`):

```
Pro mode (or the uxmode plugin disabled) → visible
Simple mode                              → override ?? !defaultAdvanced
```

Views gate each declared surface with
`useUxMode().isFeatureVisible('<pluginId>.<feature>')` (never on the raw mode).
Rules: the mode is a **display lens** — no data changes on toggle; data created
while a feature was visible keeps a read-only representation when it is hidden;
deep links (`?tab=`, `?view=`) still render a hidden surface — only entry
points are hidden. The backend is mode-unaware.

Non-view surfaces join the lens the same way, always **keyed to a declared
feature** so the settings toggle reaches them:

| Surface                        | How it opts in                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nav entry / hub tab            | `advanced: true` **+ `uxFeatureKey: '<pluginId>.<feature>'`** on the `PluginNavItem`. A bare `advanced` flag hides the entry with no toggle to bring it back — legacy only. |
| Dashboard widget / stats chart | `advanced: true` on the declaration; its own `key` doubles as the feature key, and the settings panel lists it automatically.                                               |
| Slot contribution              | `visible: () => useUxMode().isFeatureVisible('<key>')` on the contribution (tab slots use `meta.visible`, so the host can still render a deep-linked tab).                  |

Both mode-independent exceptions stay: the **mobile shell** is a device shape,
not an interface mode (#198), and the mode's own surfaces belong to the
`uxmode` plugin — disabling it makes everything visible (the store/composable
in frontend-core stay; they are shared infrastructure).

### Navigation hubs and tabs (`hubId` / `hub` / `order`)

A **hub** is one sidebar entry whose sub-sections render as tabs instead of
stacking in the sidebar (`Settings`, `Access`). It is declared on the same flat
`PluginNavItem`, so a hub's owner and a guest plugin contributing a tab into
someone else's hub use exactly the same mechanism — and neither imports the
other (§5.10):

```ts
// The hub owner: one sidebar entry + its own tabs. Order 0 = the hub's main tab.
{ path: '/settings', titleKey: 'nav.settings', icon: 'Settings', section: 'system', hubId: 'settings' },
{ path: '/settings', titleKey: 'nav.general', icon: 'SlidersHorizontal', hub: 'settings', order: 0 },
{ path: '/settings/agent', titleKey: 'nav.agentCapabilities', icon: 'Bot', hub: 'settings', order: 10, adminOnly: true },

// A guest plugin contributing a tab into someone else's hub — order >= 100.
// Under the UX lens, so it names the feature key its toggle lives under (#269).
{ path: '/settings/exchange', titleKey: 'nav.exchange', icon: 'ArrowLeftRight', hub: 'settings', order: 100, advanced: true, uxFeatureKey: 'exchange.page' },
```

- **Ordering** is `(order, registration order)`; `0` is reserved for the hub's
  own main tab, the owner's remaining tabs take `1…99`, guests take
  `>= GUEST_TAB_ORDER` (100). A tab that declares no `order` sorts **last** —
  it is not treated as a guest.
- **Visibility** — enabled / `adminOnly` / `advanced` — is decided by ONE shared
  filter (`useSidebarNav` / `useHubTabs` in `frontend-core`), so a tab and a
  sidebar entry can never disagree. A tab whose hub is unregistered or whose
  plugin is disabled is silently dropped, like a slot contribution; a hub with no
  visible tab is not rendered in the sidebar at all.
- **Routing** is path-based, not `?tab=`: the hub owner registers a layout route
  named `hubRouteName('<hubId>')` whose component is the shared `<HubLayout>`
  (tab bar + `<RouterView>`), with one child route per tab (so each tab keeps
  its own `meta.adminOnly` guard). A guest tab's route declares
  `meta: { hub: '<hubId>' }` and a **relative** path; the shell nests it under
  that layout.
- `<HubLayout hub-id path label-key />` is all a hub view needs — it wires the
  tab bar and the landing redirect. Landing on the hub root forwards to the
  first **visible** tab (`router.replace`, so Back leaves the hub), which makes
  the landing tab follow the user's role; it is inert when the hub's main tab is
  the hub root itself (Settings → General), and falls back to `/` when the user
  may see no tab at all.

### Enable / disable

Plugins are toggled from **Settings → Plugins** (`/settings/plugins`). State is
persisted in the `PluginConfig` table and enforced without a restart:

- **Backend:** each plugin controller is tagged `@PluginOwner('<id>')`; a global
  `PluginEnabledGuard` returns 404 for a disabled plugin's routes, and
  `AgentRegistryService.getEnabledTools()` removes its agent tools.
- **Frontend:** the shared `usePluginsStore` (from `@makekeeper/frontend-core`)
  holds the enabled state; the sidebar, router guard (`meta.pluginId`) and the
  settings host all filter by it reactively.
- **Core plugins** (`core: true`) reject being disabled at the service layer.

### Plugin settings panel (optional)

A plugin that has its **own** settings exposes them by registering a settings
panel — a Vue component plus manifest meta. The `settings` plugin is a generic
host: it renders one collapsible group per registered panel (styled like the AI
Agent Capabilities section), with a header showing the plugin's name,
description, version and icon, and the plugin's component embedded in the body.

Register it from the plugin's `frontend/index.ts`:

```ts
registerPlugin({
  // …id, nameKey, navigation, messages, routes…
  settings: {
    descriptionKey: chatManifest.descriptionKey,
    version: chatManifest.version,
    icon: chatManifest.icon,
    component: AiProviderSettings, // the plugin's own settings UI
  },
});
```

The component is a normal plugin view: it fetches from the plugin's **own**
backend routes (e.g. Chat's provider settings live at `/api/chat/providers`) and
uses the plugin's own i18n namespace. Reference example: the `chat` plugin owns
the AI-provider configuration (`AiProviderSettings.vue` + `ProvidersController` +
`ProviderService`), surfaced through the `settings` host.

> `PluginSettingsSchema` on the manifest (declarative fields) remains available
> for simple key/value settings; component panels are for richer UIs.

### Dashboard widgets (optional)

The home dashboard (`HomeView.vue`) is a pure **host**: every block on it is
published by a plugin. The contract has two halves, mirroring the settings-panel
split:

1. **Manifest** — declare identity + placement in `dashboardWidgets`
   (`PluginDashboardWidget` from `@makekeeper/plugin-contract`):

   ```ts
   dashboardWidgets: [
     // A compact key-figure tile in the top stats row.
     { key: 'inventory.lowStock', titleKey: 'inventory.dashboard.lowStock',
       icon: 'Wrench', size: 'stat', order: 20 },
     // A half-width card in the main grid ('full' spans the whole row).
     { key: 'inventory.restockList', titleKey: 'inventory.dashboard.restockList',
       icon: 'Wrench', size: 'panel', order: 20 },
   ],
   ```

   `key` is namespaced `'<pluginId>.<widget>'`; `titleKey` lives in the plugin's
   own i18n; `icon` is resolved through the shared plugin-icon registry (add new
   names to `frontend-core/plugin-icons.ts`); `order` sorts within a size group
   (default 100); `advanced: true` puts the widget under the UX lens, keyed by
   its own `key` — the settings panel lists it and the user can flip it either
   way (see "Simple/Pro UX mode").

2. **Frontend registration** — bind each key to its Vue component with
   `bindDashboardWidgets` (a declared widget with no bound component is dropped):

   ```ts
   registerPlugin({
     // …id, nameKey, navigation, messages, routes…
     dashboardWidgets: bindDashboardWidgets(inventoryManifest.dashboardWidgets, {
       'inventory.lowStock': LowStockStatWidget,
       'inventory.restockList': RestockListWidget,
     }),
   });
   ```

Widget components are normal plugin views: they fetch from the plugin's **own**
backend routes via `apiFetch`/`apiJson`, use the plugin's own i18n namespace
(`<id>.dashboard.*`, both locales), and render their own loading
(`Spinner`) / empty (`EmptyState`) / error states — a failed fetch shows a
placeholder, never a toast (several widgets loading at once must not spam). The
host renders the heading (`titleKey` + `icon`) for `panel`/`full` widgets;
`stat` tiles render themselves — compose them from the shared
`DashboardStatCard` primitive so every tile keeps the same geometry, and
single-series bar charts from the shared `MiniBarChart` primitive (hover
tooltip, baseline, `aria-label` summary built in). The host
filters by the owning plugin's enabled state automatically — a widget never
checks that itself. When two widgets of one plugin need the same list, dedupe
concurrent fetches in a tiny shared module (see
`plugin-projects/src/frontend/dashboard/projects-dashboard-data.ts`).

### Statistics providers (optional)

Statistics are a **dedicated `stats` plugin** (ticket #56). It owns aggregation,
storage of daily aggregates and their presentation; other plugins stay the
**source of raw data** and declare _what_ they can supply — never reaching into
another plugin's tables. A plugin joins in three declarative steps:

1. **Manifest** — declare per-day metrics (`statsProviders`) and the charts built
   from them (`statsCharts`) from `@makekeeper/plugin-contract`:

   ```ts
   statsProviders: [
     { key: 'chat.messages', labelKey: 'chat.stats.messages.label',
       unitKey: 'chat.stats.messages.unit', kind: 'counter' },   // 'counter' | 'level'
   ],
   statsCharts: [
     { kind: 'series', key: 'chat.messagesActivity',
       titleKey: 'chat.stats.messagesActivity.title', form: 'area',
       series: [{ metricKey: 'chat.messages', labelKey: 'chat.stats.messages.seriesLabel' }],
       defaultRangeDays: 14 },
   ],
   ```

   `key` is namespaced `'<pluginId>.<metric|chart>'`; all `*Key`s live in the
   plugin's own i18n (both locales). A `kind: 'series'` chart's `series[].metricKey`
   must reference one of the **same plugin's** `statsProviders`. A relational graph
   chart (`kind: 'graph'`, `form: 'sankey'`, referencing a `statsGraphs` source) is
   declarable today but its backend provider + rendering land in a later phase.

2. **Backend provider** — implement the raw-data range query over your OWN tables
   and register it in `onModuleInit()` (mirrors `AgentRegistryService`):

   ```ts
   this.statsRegistry.registerStatsProvider('chat', 'chat.messages', {
     // Aggregate [from, to) into per-day points; carry each row's scopeId so the
     // stats table can scope reads per user. Runs inside the job's systemBypass
     // context, so it sees every scope at once.
     fetchRange: (from, to) => this.chatService.getMessageCountsByDayScope(from, to),
   });
   ```

   `StatsPoint = { date: 'yyyy-mm-dd'; value: number; scopeId?; dimensions? }`.
   Providers of a disabled plugin disappear from the job and the API automatically
   (filtered via `PluginConfigService.isEnabled`, like agent tools).

3. **Consume** — the stats plugin's daily job rolls every provider up into the
   scoped `StatsDaily` table (delete-then-insert per day — never `upsert` on a
   scoped model) and serves compact per-day series from
   `GET /api/stats/series?metric=<key>&days=<n>`. Its dashboard widget reads that
   endpoint; the declaring plugin owns the metric's meaning, the stats plugin owns
   the rendering (shared `frontend-core` chart primitives). A new scoped aggregate
   model needs its `SCOPE_MODEL_MAP` entry (see [`multiuser.md`](multiuser.md)).

---

## 3. i18n — the plugin owns its strings

**No hardcoded user-facing strings, ever** (CLAUDE.md §5.5). Each plugin ships
`src/i18n/en.json` and `src/i18n/ru.json` (both required). At bootstrap,
`buildMessages()` deep-merges every registered plugin's bundle onto the core
messages, so a plugin may contribute to shared sections (`nav`, `routeTitles`)
as well as its own top-level namespace.

A bundle typically contains:

```jsonc
{
  "nav": { "inventory": "Inventory" }, // sidebar label
  "routeTitles": { "inventory": "Component Inventory", "inventory-new": "…" },
  "plugins": { "inventory": { "name": "Inventory", "description": "…" } },
  "inventory": {
    /* everything the views reference via t('inventory.…') */
  },
}
```

- Route titles resolve from `routeTitles.<routeName>` (see `App.vue`
  `getHeaderTitle`) — do **not** set a hardcoded `meta.title`.
- The agent-tool group header and any "plugin name" display use
  `plugins.<id>.name` (that is the `pluginLabelKey`).
- Every key added must exist in **both** `en.json` and `ru.json`.

---

## 4. Backend — module, tools, DTOs

The module registers the manifest and its tools on init:

```ts
@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly inventoryService: InventoryService,
  ) {}

  onModuleInit() {
    this.registry.register(inventoryManifest);
    this.agentRegistry.registerTools(getInventoryTools(this.inventoryService));
  }
}
```

Then wire it once in `apps/backend/src/app/app.module.ts`:

```ts
import { InventoryPluginModule } from '@makekeeper/plugin-inventory/backend';
// … add InventoryPluginModule to the `imports` array.
```

**Agent capabilities** (see [`agent-capabilities.md`](agent-capabilities.md)):
`withPlugin('<id>', 'plugins.<id>.name', [...])` stamps ownership; every tool is
classified `READ` / `WRITE` / `DESTRUCTIVE`. DESTRUCTIVE tools are code-gated
behind human-in-the-loop confirmation — the runtime blocks them (§5.7).

DTOs are `class-validator` classes with `@MaxLength` on every string. Config and
secrets are read through the settings/config service, never `process.env`.

---

## 5. Frontend — registration side-effect

`frontend/index.ts` registers the plugin exactly once, folding in the manifest,
its routes and its i18n bundle:

```ts
import { registerPlugin } from '@makekeeper/frontend-core';
import { inventoryManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import InventoryView from './InventoryView.vue';

registerPlugin({
  id: inventoryManifest.id,
  nameKey: inventoryManifest.nameKey,
  navigation: inventoryManifest.navigation,
  messages: { en, ru },
  routes: [{ path: '/inventory', name: 'inventory', component: InventoryView }],
});
```

Then add one line to `apps/frontend/src/plugins/loader.ts`:

```ts
import '@makekeeper/plugin-inventory/frontend';
```

That is the **only** app-shell edit needed: the sidebar entry, routes, and
strings all flow from the registry. `App.vue` renders the sidebar from
`getPluginNavigation()`; the router mounts `getPluginRoutes()`; `i18n/index.ts`
merges bundles via `buildMessages()` (it imports the loader first so all plugins
are registered before messages are built).

- Views must use the shared styled `Select` from `@makekeeper/frontend-core`,
  never a native `<select>`.
- Navigation state stays route-driven (vue-router) — no `history.pushState`.
- **Reloading data does not blank the screen** — see "Refresh without a blink"
  below.
- Optional frontend lifecycle hooks `onInstanceEnabled` / `onInstanceDisabled`
  (counterparts of the backend `registerLifecycleHooks`) fire in the acting
  admin's browser after the instance-wide toggle succeeds — use them when the
  toggle needs a transition UX (see the multiuser plugin's fullscreen
  mode-transition overlay, `docs/multiuser.md` §"Mode-transition UX"). Hook
  errors are logged and never roll the persisted toggle back. Declaring either
  hook also marks the plugin as **mode-changing**: Settings → Plugins keeps its
  row in the shared list but highlights it (iridescent row tint + aurora icon
  chip) automatically — no per-plugin code in `PluginsAdminView`.

### Uploads declare their owning plugin (#120)

Every call into `AttachmentStorageService` names the plugin the upload belongs
to. It is a required field, not an optional hint:

```ts
await this.attachments.saveDataUrl({ pluginId: 'inventory' }, dataUrl);
await this.attachments.saveBuffer({ pluginId: 'chat', sessionId }, buffer, mime);
```

`projectId` / `sessionId` / `bridgeSessionId` stay what they always were —
optional links to a specific record. `pluginId` answers a different question:
whose bytes are these. The disk report used to infer the answer from whichever
id column was set, which meant a surface that links to no record — an inventory
photo, referenced only by a denormalized URL — was reported as belonging to
nobody, and its share of the disk was unattributable.

- The field is required, so a new upload surface cannot forget it: omitting it
  fails to compile.
- `claim()` re-declares ownership too — a capture photo pulled into a chat
  message becomes the chat's disk cost from then on.
- An exchange importer writing rows directly sets `ownerPluginId` in the same
  place it sets the other columns.
- Rows written before the declaration existed were backfilled from their id
  columns where those said anything; the rest are reported as undetermined,
  never merged into some plugin's total.

### Refresh without a blink (#120)

The default async view — `v-if="loading"` shows a spinner, `v-else` shows the
data — is correct for the FIRST load and wrong for every reload after it. On a
refresh it removes the content, collapses the section to a spinner, then rebuilds
it: the page jumps, scroll position moves, and a request that answers in 40 ms
shows as a flicker that reads like a glitch rather than an update.

Three pieces, each owning one concern:

```ts
const report = useResource<DiskUsageReport>((signal) => apiJson<DiskUsageReport>('/api/disk/usage', { signal }), {
  keepPreviousData: true, // the old value stays available while reloading
  minLoadingMs: 800, // …and the state stays legible once shown
});
```

```vue
<Refreshable :refreshing="report.refreshing.value">
  <!-- whatever the section renders -->
</Refreshable>
```

- **`keepPreviousData`** (`useResource`) keeps the last loaded value visible
  during a refetch, and exposes `refreshing` — "loading ON TOP of something
  already on screen", as opposed to `loading`, which stays the first-load
  signal. A failed refresh drops the stale value: yesterday's numbers under an
  error message are worse than the error alone.
- **`minLoadingMs`** (`useResource`) is the shortest time a loading state may be
  visible. Without it a fast answer never lets the transition finish. It delays
  only the moment the new value is painted — nothing else waits on it. Errors are
  held for the same minimum, for the same reason.
- **`Refreshable`** (`frontend-core`) is the visual half and is stateless: it
  blurs and dims its slot, blocks clicks on values that are about to change, and
  puts a spinner near the top of them, where it stays in sight on a section whose
  bottom is off-screen. It never decides _when_ anything reloads.

Use it wherever a view reloads data it is already showing — a refresh button, a
post-write refetch, a drill-down into another level. Keep the plain spinner for
the first load, when there is nothing yet to keep.

---

## 6. Checklist for a new / changed plugin

- [ ] Library at `libs/plugin-<id>/` with `project.json`, tsconfig(s), eslint config.
- [ ] `tsconfig.base.json` `paths` has `/backend` and `/frontend` aliases.
- [ ] `manifest.ts` carries only i18n keys (no literals); new icons added to the maps.
- [ ] `en.json` **and** `ru.json` present; every referenced key exists in both.
- [ ] Backend module registers manifest + tools; wired in `app.module.ts`.
- [ ] Tools classified READ/WRITE/DESTRUCTIVE; DESTRUCTIVE gated (§5.7); DTOs `@MaxLength`.
- [ ] Frontend registers routes + nav + messages; one line in `loader.ts`.
- [ ] Object references (§ [`object-refs.md`](object-refs.md)): if the plugin owns
      referenceable entities, declare their types — backend
      `registerObjectRefResolver` per type, frontend `refToRoute`, and detail views
      publish their selection via `setPageContextRefs`. Tools accept an ORef
      (`resolveEntityId`) wherever they take a raw id and return a `ref` on outputs.
- [ ] Own settings (if any) declared as a `settings` schema on the manifest.
- [ ] Dashboard widgets (if any) declared in the manifest's `dashboardWidgets`
      and bound via `bindDashboardWidgets` in `frontend/index.ts`; strings under
      `<id>.dashboard.*` in both locales.
- [ ] Multi-user declarations (§7): new top-level models have `scopeId` + a
      `SCOPE_MODEL_MAP` entry; manifest flags (`settingsAdminOnly`,
      `readOnlyScopeExempt`, nav `adminOnly`) set where applicable;
      `@Public()`/`@AdminOnly()` on the relevant routes; HTTP via `apiFetch`.
- [ ] Cross-plugin integration (§8): no `@makekeeper/plugin-<other>` imports —
      UI into other plugins via `contributions`, service surfaces via the
      capability registry, cross-domain writes via the event bus; UI that only
      links to a neighbour is gated on `usePluginsStore().isEnabled('<id>')`.
- [ ] `nx lint`, `nx build`, `nx test` pass for the plugin lib and both apps.

## 7. Multi-user mode requirements

The optional `multiuser` overlay scopes data per user, adds authentication and
scope sharing. Every plugin must stay correct with it ON and OFF. What a
plugin declares — manifest flags (`settingsAdminOnly`, `readOnlyScopeExempt`,
`defaultEnabled`, nav `adminOnly`), route decorators (`@Public()`,
`@AdminOnly()`), a `SCOPE_MODEL_MAP` entry per scoped model (with
`binding: 'user'` for private data), optional `ScopeRestrictionDescriptor`
and lifecycle hooks — is specified in the author's guide:
[multiuser.md → "Writing a multiuser-aware plugin"](multiuser.md#writing-a-multiuser-aware-plugin-authors-guide).

## 8. Cross-plugin integration — contributions, capabilities, events (#58)

> A fourth registry-mediated surface exists for export/import: a plugin declares
> exchange roots/sections in its manifest and registers `ExchangeSectionProvider`s
> — see [`docs/exchange.md`](exchange.md) (#62).

**A plugin never imports another plugin's code.** The only allowed
`@makekeeper/*` imports inside `libs/plugin-<id>` are `plugin-contract`,
`backend-core` and `frontend-core`. Everything a plugin offers to (or renders
inside) another plugin flows through one of three registries, all of which hide
the integration while the owning plugin is disabled — so disabling a plugin
removes exactly its functionality, everywhere, and nothing else breaks.

The rules:

1. **UI that implements another plugin's functionality** (a tab, section,
   modal, action button) → a **contribution into a named slot** of the host.
   The contributor declares it in `registerPlugin({ contributions })`
   (`{ slot, component, order?, meta? }`); the host renders
   `<PluginSlot name="…" :ctx="…" />` (or reads `useSlotContributions(slot)`
   for bespoke rendering, e.g. tab bars). `ctx` is spread onto the contribution
   as props — callbacks (`onX`) included — and `meta`'s shape is the slot's
   contract. Only enabled plugins' contributions render.
   Existing slots: `projects.detail.tabs` (meta `{ tabId, labelKey, icon,
visible? }`; logistics + chat), `projects.shopping-list.actions`,
   `projects.task-form.order`, `projects.component-row.actions`,
   `logistics.order-form.quick-create`, `logistics.order-import.capture`.
   A global **`page.header.actions`** slot (ctx `{ entityRef?: string }`) is
   rendered by `PageHeader` whenever a view passes its entity ORef as the
   `context-ref` prop (detail views that don't use `PageHeader` render the same
   `<PluginSlot>` in their own action row). It is the one predictable, top-right
   home for cross-plugin actions on the shown entity — `exchange` fills it with
   the in-context **Export** control, self-hiding for non-exportable/absent refs.
   Tag slots (#60, filled by `tags`): a global header search box
   `app.header.search` (ctx `{}`); tag-chip metas on host detail/edit/list
   surfaces — `projects.detail.meta`, `projects.card.badges`,
   `inventory.row.badges`, `inventory.form.meta`, `storages.detail.meta`,
   `storages.cell.meta` (its `entityRef` carries the cell `#B1` fragment),
   `logistics.order-form.meta` (all ctx `TagChipsSlotCtx` =
   `{ entityRef, editable?, compact? }`); and list-view tag filters
   `projects.list.filters`, `inventory.list.filters`, `storages.list.filters`
   (ctx `TagFilterSlotCtx` — the host stays route-driven and receives the
   matching entity ids via `onMatches`). Ctx interfaces live in
   `plugin-contract/src/lib/capabilities.ts`.
   **`inventory.category-property.form`** and
   **`inventory.category-property.badges`** (#205, both ctx `TagSourceSlotCtx` =
   `{ fieldRef, valueKind, onReady? }`) are the pattern worth copying when a
   _host owns a field_ and another plugin wants to do something with its values.
   Inventory renders the editable slot inside its own property modal and the
   read-only one on the property row, and stores nothing about either; `tags`
   contributes the "this field's value becomes a tag" switch, keeps the marking
   in its own `TagSource` table (keyed by the field's ORef) and acts on it by
   listening for `INVENTORY_ITEM_PROPERTY_VALUES_EVENT`. The host has no column,
   no switch and — crucially — no `isEnabled('tags')` check: disabling tags
   removes the contributions and the listener, which _is_ the whole feature.

   **`onReady` is the part to copy.** An editable contribution inside a _create_
   form has nothing to key itself by — the host's entity does not exist yet. So
   the contribution hands the host a `SlotFieldCommit` and the host calls it with
   the entity's ORef once it has saved. The contribution therefore inherits the
   form's Save/Cancel for free (cancel ⇒ never called ⇒ nothing written) while
   still persisting through its own API. Two rules for the host: capture the id
   from your own create response (see `saveProperty` in `CategoriesView.vue`),
   and **reset the commit registry each time the form opens** — `Modal` is
   `v-if`, so contributions remount and re-register on every open. Omit `onReady`
   from the ctx to mark a slot read-only, which is what the row's `badges` slot
   does.
   Storage-cell slots (#79, rendered by `storages` for the open grid cell):
   **`storages.cell.actions`** (ctx `StorageCellActionsSlotCtx` =
   `{ storageId, row, col, cellAddress, cellRef, onChanged }`) — actions on what
   _lives_ in the cell, filled by the plugin that owns the placement
   (`inventory`, which contributes "scan items into this cell"); and
   **`storages.cell.status`** (ctx `{ entityRef }`) — the cell header's home for
   a background process running against that cell (a live scan session).
   Storages names the cell and never writes another plugin's models.
   Inbox action slot (#315, rendered by `notify` in the bell): 
   **`notify.inbox.actions`** (no ctx) — what a person could set up so that
   something reaches them, filled by `schedule` with "New reminder". Rendered
   in the empty state's action area, and on a ruled-off footer line when the
   list is not empty; the host asks `useSlotContributions` first, so the rule
   never draws under nothing. The inbox names the slot and learns nothing about
   reminders; a contributor here must NAVIGATE rather than open a dialog,
   because the popover renders its content behind `v-if` and would destroy a
   modal mounted inside it.
   Phone sign-in slot (#207, rendered by `mobile` on the phone's own sign-in
   screen `/m/login`): **`mobile.auth.password`** (ctx `MobileAuthSlotCtx` =
   `{ onAuthenticated }`), filled by `multiuser`. The phone shell owns the
   SCREEN — a surface inside the shell, reachable without a credential — and
   what a fresh session is worth on a phone (it trades it for a device token);
   the auth owner owns the FORM and knows nothing about phones. In single-user
   mode nobody contributes, so there is no password form to hide: the screen is
   empty of its own accord, and the router sends the visitor to pairing.

2. **UI that merely navigates to another plugin** (a link/handoff to its route,
   a fetch of its API for a picker) → gate on
   `usePluginsStore().isEnabled('<id>')` and skip the fetch while disabled.
   Hidden inputs keep their loaded values so saving never clobbers data.
3. **Backend logic that writes another plugin's models** belongs to the owner:
   either an endpoint under the owner's `@PluginOwner` (the guard 404s it when
   disabled — e.g. `PATCH /api/components/:id/reserve`), or an **event
   listener** the owner registers on `PluginEventBusService` in
   `onModuleInit()` (`on(pluginId, event, handler)`). Emitters call
   `emit(event, payload)` and never notice whether anyone listened; the bus
   skips listeners of disabled plugins and swallows their errors. Event names +
   payload types live in `plugin-contract/src/lib/capabilities.ts`
   (`logistics.stock.adjust`, `projects.component.unlinked`).
4. **Service surfaces offered to other plugins** (LLM vision, order-derived
   facts) → the **capability registry** (`CapabilityRegistryService`,
   backend-core). The owner registers in `onModuleInit()`
   (`registerCapability(pluginId, capabilityId, impl)`); consumers resolve per
   call with `getCapability<T>(id)` and treat `null` (unregistered OR owner
   disabled) as "the feature doesn't exist" — degrade or throw an i18n-keyed
   error. Capability ids + interfaces live in the contract's `capabilities.ts`
   (`chat.vision-completion`, `logistics.component-order-info`).
5. **Data survives disable.** Disabling removes surfaces (routes, UI, tools,
   capabilities, listeners) — never rows, columns or FKs. Referential-integrity
   guards and purely historical _reads_ of a neighbour's tables (e.g. activity
   timelines) may stay direct: they keep working whether or not the owner is
   enabled. The **projects** and **settings** plugins are core (never
   disabled), so depending on their data/API is as safe as depending on
   backend-core.

Adding a new slot, capability or event: declare the contract (id + payload
/meta interface) in `plugin-contract`, document it here, and keep both sides
free of each other's imports.

### Universal labelling & scanning — the `codes` plugin (#74)

The `codes` plugin adds printable/scannable QR + Code128 labels that resolve to
any object's ORef. It is **host-agnostic**: a host plugin opts in with one
manifest field and never imports `codes`.

- **`manifest.codes`** (`PluginCodesDeclaration`, in `plugin-contract`):
  `{ labelable?: [{ entityType, slot }], scan?: { slot, statusSlot? } }`.
  `labelable` declares an owned entity type as labelable and the slot where the
  host renders `<PluginSlot :name :ctx="{ entityRef }">`; `codes` mounts its
  **"Print label"** button there. `scan.slot` is where a contextual **"Scan with
  phone"** button mounts (ctx `ScanContextSlotCtx` =
  `{ actions?, originRef?, contextLabel?, onScan? }` — the host describes what a
  scanned code may do and applies the confirmed result; `codes` resolves the raw
  string to a canonical ORef first). `scan.statusSlot` is the optional companion
  where `codes` mounts its "scanning into this object" badge, matched on
  `originRef`. Adopters: inventory (`component` → `inventory.detail.actions`,
  scan → `inventory.cell.scanPlace`/`inventory.cell.scanStatus`, which inventory
  itself renders inside its `storages.cell.actions` contribution) and storages
  (`storage`/grid-cell → `storages.detail.actions`).
- **Manifest-driven contributions** (`registerManifestContributions(pluginId,
(manifests) => PluginContribution[])`, frontend-core): a plugin whose target
  slots are only known from _other_ plugins' manifests registers a provider that,
  given the live manifest list, yields its contributions. `useSlotContributions`
  merges them, filtering by both the contributor's and the host's enabled state.
  This is how `codes` stays host-agnostic.
- **Global scan** — `codes` contributes a header button into the app-owned
  **`app.header.scan`** slot (`App.vue`), mirroring `app.header.capture`.
- **App-header slots & overflow (#274/#277).** The header's plugin-facing slots
  (`app.header.search`, `app.header.scan`) are the rows of the `HEADER_SLOTS`
  table (`apps/frontend/src/app/header-overflow.ts`) — a closed set: a new
  header role is a new row with a deliberate rank, never a shared free-for-all
  slot. The slot ranks; a contribution refines only within its slot via its
  existing `order` (leftmost survives longest; no `order` value can cross a
  slot boundary). When the row narrows, a contribution that no longer fits
  collapses into the avatar menu; `meta.labelKey` (an i18n key in the
  contributor's own bundle, `HeaderItemMeta` in `plugin-contract`) names the
  collapsed row — undeclared, it falls back to the plugin's display name. A
  narrower pre-collapse form is discovered from the rendered markup: mark the
  parts the control drops with `data-compact-drop`, nothing is declared.
  External plugins declare `labelKey` on their manifest slot entry.
- **Scan transport** reuses the phone-bridge (#77): the phone surface is a
  **`phone-bridge.surface.scan`** contribution (BarcodeDetector, on the phone);
  the desktop opens `<PhoneBridgeModal :context="{ kind: 'scan' }">`; the relay is
  a `PhoneBridgeKindHandler` registered under `phone-bridge.kind.scan`. `codes`
  ships no phone route of its own — only the public `/c/<code>` label deep-link.
- **A session outlives the screen that started it** (#79): the always-mounted
  header button is the single session host; contextual triggers only describe the
  session they want through the `codes-scan-session` Pinia store, and re-attach to
  a running one by the context's canonical ORef (component identity does not
  survive an unmount). One session relays many codes; the desktop ends it, and
  clicking scan in another context **retargets** the live session
  (`PATCH /api/phone-bridge/sessions/:token/context`) instead of re-pairing.
- **`realtime.guest-auth`** capability (`RealtimeGuestAuthCapability`, registered
  by `phone-bridge`): maps a live bridge-session token to exactly one realtime
  room, so the phone — which holds no user credential — gets pushed desktop-side
  changes (retarget, end) instead of polling. The gateway grants such a socket no
  user, no scope, no commands and no other room; the token is a capability, the
  same model as the public `/d/:token` routes.
- **`codes.raw-resolve`** capability (`CodesRawResolveCapability`): a scanned
  string that is neither an ORef nor one of our label codes is handed to whichever
  plugin can map it (inventory maps SKU → component ORef); `null` (unregistered or
  owner disabled) means "no mapping", so scanning degrades cleanly.
- **`attachment-target.<pluginId>`** capability (`AttachmentTargetCapability`,
  built with `attachmentTargetCapability(pluginId)`; registered by `inventory`,
  consumed by `chat`): who owns a file dropped into the chat while a given object
  is on screen (#130). The chat walks the page's ORefs most-specific first and
  asks the plugin named **inside the ref** — `describeAttachmentTarget(ref)` for
  the destination's name, stated in the composer _before_ the file is sent, then
  `adoptAttachments(ref, urls)` once the bytes are stored. A plugin that registers
  nothing, or answers `null`, means "no owner here": the upload falls back to the
  turn's project scope. Note the split of duties — the chat owns the upload
  pipeline and the attachment rules and therefore saves the bytes; the row that
  links a file to another plugin's record is written by that plugin, never across
  the seam. Adoption is best-effort: an owner that throws (object deleted
  mid-turn, picture already owned elsewhere) leaves the file with the
  conversation rather than failing the turn.
