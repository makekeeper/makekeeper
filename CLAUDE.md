# CLAUDE.md — Operating Manual

<!-- TODO: replace with a one-paragraph description of THIS project (what it is, who uses it). -->
This file is the operating manual for Claude Code in this repository. It is written so that a
model can work here correctly **without rediscovering the conventions**: read the section for the
kind of change you are making, follow the recipe, and check your work against the quality bar
before declaring done.

A sibling agent manifest for **Antigravity** lives in [`.agents/AGENTS.md`](.agents/AGENTS.md).
Claude Code does not read it (and Antigravity does not read this file), so a few rules are
intentionally mirrored in both — see §5.6, §5.7, §5.8 and §5.11. `.agents/AGENTS.md` is canonical for those;
keep the two in sync when it changes.

<!-- TODO: link any project-specific sub-documents here as they are written, e.g. per-app AGENTS.md,
     migration policy, design guidelines. This root file should link, not duplicate. -->

---

## 1. Environment

<!-- TODO: describe how/where commands run for THIS project (devcontainer? host? which service?),
     and how to detect it. Keep the nx-binary note if nx is used. -->

`nx` binary: `./node_modules/.bin/nx` if not on PATH.

## 2. Projects and Libs

<!-- TODO: fill in the real projects/ports/types and the @scope/* lib aliases for THIS repo. -->

| Project | Port | Type | Description |
|---|---|---|---|
| `backend` | — | NestJS | REST API + agent runtime; imports plugin backends + `backend-core`. |
| `frontend` | 4200 | Vue SPA | App shell (sidebar/router/i18n) that mounts plugin frontends. |

| Alias | Path | Description |
|---|---|---|
| `@makekeeper/plugin-contract` | `libs/plugin-contract` | Framework-agnostic types: `PluginManifest`, agent-tool types, `withPlugin`. |
| `@makekeeper/backend-core` | `libs/backend-core` | Shared NestJS infra: `PrismaService`, plugin/agent registries, error/uuid helpers. |
| `@makekeeper/frontend-core` | `libs/frontend-core` | Shared Vue infra: plugin registry, `buildMessages`, shared `Select`/`RichEditor`. |
| `@makekeeper/plugin-<id>/{backend,frontend}` | `libs/plugin-<id>` | One self-contained plugin (manifest + i18n + tools + settings + nav + routes). Plugins: `projects`, `inventory`, `storages`, `logistics`, `settings`, `chat`, `capture`, `uxmode` (simple/advanced interface mode — see [`docs/plugins.md`](docs/plugins.md) §2), `multiuser` (optional multi-user overlay — see [`docs/multiuser.md`](docs/multiuser.md)). |

**No cross-project relative imports** — use `@makekeeper/*` aliases only. NX enforces module
boundaries in lint.

**Plugin system:** every plugin is a self-contained library. To add or change one, follow the
canonical recipe in [`docs/plugins.md`](docs/plugins.md) — a plugin declares its identity, own
i18n, agent capabilities, optional settings, sidebar entry and routes in one place; the app shells
consume the registry (no hardcoded nav/routes/strings).

## 3. Key Commands

<!-- TODO: adjust project names to THIS repo. The shapes below are the standard NX commands. -->

```bash
nx serve <project>              # dev server for one project
nx build <project>              # build one project
nx run-many -t build            # build everything (libs first via ^build)

nx test <project>               # Jest (NestJS apps) / Vitest (Vue apps)
nx test <project> --testFile=src/path/to/file.spec.ts   # single file

nx lint <project>               # lint ONE project — always prefer this
npx eslint src/path/to/file.ts  # single file — fastest
npm run format                  # prettier
```

> **Lint rule:** During development, always lint the **specific project** you changed
> (`nx lint <project>`) or the single file. Reserve the full-repo lint sweep for a final
> pre-commit check or CI — never run it mid-task.

## 4. Architecture — the facts you must not re-derive

<!-- TODO: document THIS project's load-bearing, non-obvious architecture — the things a model
     would otherwise waste time rediscovering or get subtly wrong. Examples of the *kind* of fact
     that belongs here (delete/replace with your own):
       - how config/secrets are resolved (settings service? env fallback? vault?)
       - the main request/data pipeline end-to-end
       - any plugin/registry seams (how to add a provider/handler without special-casing app code)
       - message-bus / queue topology and which bus is for what
       - money/number handling rules (decimal columns, rounding helpers)
       - dev routing / ingress specifics
     Keep each to the facts that are non-obvious from reading the code. -->

## 5. Conventions

### 5.1 TypeScript (all projects)
Strict mode everywhere. Style: **Matt Pocock**. The operative rules:
- Zero `any`. Truly dynamic values are `unknown`, narrowed with type guards (`is` functions).
- No naked `as T` casts — use `satisfies` to validate object shapes while keeping literal types.
- Explicit return types on every exported function/method/handler.
- Derive types from code (`Pick`/`Omit`/`ReturnType`/template literals); discriminated unions over
  optional-field soups (`{ status: 'loading' } | { status: 'success'; data: T }`).
- Comments explain **why** a trick exists, never what the next line does.

### 5.2 Backend (NestJS)
- Decorators + DI only — never `new Service()`.
- One `private readonly logger = new Logger(ClassName.name)` per class. **No `console.log`.**
- Error extraction helper (used everywhere — copy it, don't invent variants):
  ```ts
  function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
  ```
- **WS ack contract** (if the project uses Socket.io gateways): every `@SubscribeMessage` handler
  returns a plain object — success shape (`{ ok: true, ... }` or the data itself) or
  `{ error: string }`. Handlers **never throw** out of the gateway; wrap the body in try/catch and
  return `{ error: getErrorMessage(err) }`.
- **Never put a top-level `event` key in an ack return value.** NestJS interprets `{ event, data }`
  as a `WsResponse` and re-routes it instead of acking — the client's `emitWithAck` hangs and
  parsing breaks.
- DTOs: `class-validator` classes in `<module>.dto.ts`; every string field carries `@MaxLength`;
  gateways use `@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))`.
- Secrets/config read through the project's settings/config service — never `process.env` directly
  in app code. Process-level config (`PUBLIC_BASE_URL`, `UPLOADS_DIR`, `PORT`) goes through
  `AppConfigService` (`@makekeeper/backend-core`); a plugin's own settings go through that
  plugin's settings service (e.g. `CaptureSettingsService`, `ProviderService`). The only sanctioned
  raw `process.env` reads are the bootstrap in `main.ts` and `prisma.service.ts`.

### 5.3 Vue (SPAs)
- Composition API with `<script setup>` only — no Options API in new code.
- State that outlives a component goes in a Pinia store, not component refs.
- **Plugin frontends live in `libs/plugin-<id>/src/frontend`**, registered via `registerPlugin`
  (one line in `apps/frontend/src/plugins/loader.ts`). The sidebar is data-driven from the plugin
  registry (`getPluginNavigation()` in `App.vue`) — never hardcode nav entries. Full recipe:
  [`docs/plugins.md`](docs/plugins.md).
- **Reuse the shared UI primitives — never hand-roll one.** `@makekeeper/frontend-core` owns the
  design system: `Button`, `Switch`, `Modal`, `Badge`, `Spinner`, `PageHeader`, `Select`,
  `RichEditor`, plus the `ToastViewport`/`useToastStore` and `ConfirmDialog`/`useConfirm` hosts
  (both mounted once in `App.vue`). Before writing a button/toggle/modal/spinner/badge/page-header,
  import the primitive. If it doesn't fit, **add a variant to the primitive**, don't create a
  one-off inline-classed control — that is how the UI drifted before. See §5.4.
- **User feedback goes through the app surfaces, never the browser's.** No `alert()`, no
  `confirm()`, no silent `console.error` for user-visible outcomes. Success/failure → `useToastStore()`
  (`toast.success`/`toast.error`); destructive confirmation → `await useConfirm()({ message, tone:
  'danger' })`. `DESTRUCTIVE` product-agent tools still gate separately (§5.7).
- Navigation state (drill-down, sub-tab, pagination, filters) is **route-driven** via vue-router —
  no hand-rolled `history.pushState` / `hashchange` / manual `currentTab`. Pagination/filters live
  in `route.query`.

### 5.4 Tailwind / styling — design-system rules (always apply when building/refactoring UI)

**Rule of thumb: every visual value is a token or a standard Tailwind step — never a magic literal
and never an invented one.** The single source of truth is
[`apps/frontend/tailwind.config.js`](apps/frontend/tailwind.config.js) (the only Tailwind config;
its `content` globs scan `apps/**` and `libs/**`, so plugins share it).

- **Colour.** Accent is the `brand.*` token scale (never raw `blue-*` for the accent role). Surfaces
  use the `dark.*` scale and the standard `slate` ramp. Semantic status stays on the standard
  `emerald`/`amber`/`red` families. **Only real steps exist** — `50,100,…,900,950` for stock ramps,
  and the shades the config actually defines for `brand`/`dark`. A class like `slate-350`, `red-655`
  or `brand-405` compiles to **nothing** (the element silently inherits colour); the same trap
  applies to invented spacing (`w-4.5`), opacity (`bg-white/2`), and `animate-*` names with no
  registered keyframes. If you need a value that isn't a token, **add it to the config**, don't
  sprinkle a one-off class that no rule generates.
- **Theming is class-based dark mode** (`darkMode: 'class'`; `.dark` toggled on `<html>`, persisted
  to `localStorage['theme']`). Every colour utility needs its `dark:` counterpart — light **and**
  dark are both first-class; a bare `bg-white/5` with no `dark:` pairing is invisible in light mode.
- **Fonts / sizes / animations are tokens too.** Use `font-sans` (the self-hosted Outfit/Inter
  stack), the `text-xxs` size token, and the registered `animate-fade-in` / `animate-scale-in`.
  Don't hardcode a family, define a size in a component `<style>`, or reference an unregistered
  animation.
- **Radius/shape convention:** inputs & small controls `rounded-xl`, cards & panels `rounded-2xl`
  (the dashboard hero's `rounded-3xl` is the one documented exception). Glass surfaces use the
  `.glass` / `.glass-card` / `.glass-input` helpers in
  [`apps/frontend/src/styles.css`](apps/frontend/src/styles.css) — don't re-derive them inline.
- **Prefer a shared primitive over raw utilities** for any interactive element (§5.3). Reach for
  Tailwind utilities to compose layout, not to re-implement a button/toggle/modal that already
  exists in `frontend-core`.
- **Accessibility is part of "done":** interactive controls carry a `focus-visible` ring (never
  `focus:outline-none` with no replacement); icon-only buttons need an `aria-label`; switches use
  `role="switch"` + `aria-checked`; form `<label>`s associate to their input via `for`/`id`. The
  shared primitives already bake these in — another reason to use them.

**Before adding UI, grep `frontend-core` for an existing primitive/token; extend it rather than
introducing a divergent variant.** Verify with a repo-wide sweep that no dead class slipped in:
`grep -rnE '(slate|red|blue|…)-(250|350|450|550|650|655|…)|w-4\.5|bg-white/2\b' libs apps --include='*.vue'`
must return nothing.

**Presentation lives in the component, never in a translation.** If a piece of text needs framing
to be read correctly — bracketing dashes, a prefix, a separator, indentation, capitalisation — the
component renders it and the locale file holds the bare words. A decoration every locale has to
remember is one half the locales will forget: `plugin-logistics` shipped `"— No supplier —"` and
`"— No project —"` alongside a bare `"No destination"`, in the same picker family, for exactly this
reason. The corollary is that a locale value is never *only* a value: if you find yourself typing a
dash, a colon or a bullet into `en.json`, the rendering belongs one level up. (Genuine punctuation
inside a sentence is not decoration — this is about framing that the UI, not the sentence, owns.)

**The empty option.** "Nothing chosen" in a picker is not a record and must never render like one.
Pass `empty: true` on the `Select` option — the primitive mutes it, brackets it in dashes and rules
it off from the data below, in the panel *and* in the closed trigger. Never hand-roll any of that,
and never bake it into the label. Two rules for the label itself: phrase it as an **absence**, not
as a place — `No parent`, not `Top level`, which read as the name of a category and was reported as
exactly that — and mark only real absences. An **action** (`Create new…`) and a **real choice among
choices** (`Whole order`) are not empty options; greying them out lies about what they do. A
"no filter applied" row (`All`, `All statuses`) *is* one.

**Know the variants before you hand-roll one.** Every divergent control in this repo started as
someone not knowing the primitive already covered the case. Current non-obvious ones:
`Button` `size="icon-sm"` + `variant="dangerGhost"` (the dense row-action pair: uniform small icon
buttons, destructive one quiet until hovered); `Badge` `variant="label"` (a chip carrying the
object's own text — natural case, and it survives wrapping, which a hand-rolled inline pill does
not: an inline box splits its background and border into one fragment per line);
`Select` `allow-custom` (combobox — never reach for a native `<datalist>`), plus `depth`/
`parentValue` on an option to render a tree with an ancestor-aware filter (build the list with
`buildTreeOptions` from `frontend-core`, never a second tree walk per call site).

### 5.5 i18n
- **No hardcoded text-string literals anywhere — the ONLY string literals allowed are i18n keys.**
  Ever. Not as placeholders, not "temporarily". This is broader than user-facing UI: it also covers
  text that never reaches the end user directly — **AI/LLM prompt text, agent-tool `descriptionKey`
  values, tool-parameter descriptions, model-facing history/notes, thrown error messages, persisted
  `note:` values, and page-context resolver output**. Do NOT treat backend `*.tools.ts` descriptions
  or chat system prompts as exempt just because they feed the model — they are still strings and must
  be keys. (Genuinely non-text literals — enum/union values, object keys, CSS classes, technical
  identifiers, model ids, provider brand nouns — are not "text" and are fine.)
- **Each plugin owns its i18n.** Locale keys live in `libs/plugin-<id>/src/i18n/{en,ru}.json`
  (both required, in the same commit), deep-merged into the app at bootstrap via `buildMessages()`.
  Core-app-only strings stay in `apps/frontend/src/i18n/locales/{en,ru}.json` (`common`, `header`,
  `dashboard`, `nav.dashboard`, `routeTitles.home`). Plugin display name/description →
  `plugins.<id>.name`/`.description`; sidebar label → `nav.<id>`; route title →
  `routeTitles.<routeName>`. See [`docs/plugins.md`](docs/plugins.md) §3.
- **Backend i18n (text assembled server-side).** The frontend resolves keys with `t()`/`$t()`; text
  built on the backend (LLM prompts, tool descriptions, guard/exception messages) is resolved with
  **`PluginI18nService`** (`@makekeeper/backend-core`). Each plugin backend module registers its
  own bundle once in `onModuleInit()` — `this.i18n.registerBundle({ en, ru })` (importing its own
  `../i18n/{en,ru}.json`) — then resolves via `this.i18n.t(key, params?, locale?)`.
  - **Agent tools:** a tool declares `descriptionKey` (not `description`) on itself and on every
    parameter; the frontend resolves the key with `$t()`, and the chat runtime resolves it for the
    LLM via `i18n.resolveTool(tool, locale)`. Never put a literal in a `*.tools.ts` file.
  - **Per-user locale:** AI-facing text follows the caller's locale, threaded from the client via the
    `x-locale` header → controller → service → `t()`/`resolveTool()`. Text without a per-user locale
    on its path (persisted notes, shared guard errors) resolves at the default locale.
  - **Core (non-plugin) backend text** lives in `apps/backend/src/app/i18n/{en,ru}.json` under `core.*`,
    registered by `AppModule`. Follow the `plugin-capture` pattern: throw i18n keys, don't build prose.
  - **Swagger/OpenAPI doc text — the one sanctioned exception.** Endpoint/DTO doc strings
    (`@ApiOperation` summaries, `@ApiProperty` descriptions) are a developer-facing surface that
    never reaches an end user through `t()`/`$t()`. Prefer the `i18n:<key>` marker that
    `apps/backend/src/app/swagger.ts` resolves to English; where no key fits, a plain **English**
    literal is allowed. This carve-out covers **only** API-docs text — nothing else. See
    [`docs/api-docs.md`](docs/api-docs.md).

### 5.6 Dependency management (npm)
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

- **Strict version pinning.** Every dependency in `package.json` is pinned to an exact version
  (`"name": "1.2.3"`) — never `^` or `~` ranges.
- **Maturity window.** Only install a package version released **at least one week before the
  current date** (rolling rule). *Example:* on 2026-07-10, the newest allowed release date is
  2026-07-03. Do not adopt a version younger than that.
- **No known vulnerabilities.** Only install packages/versions with no outstanding vulnerability
  reports.

### 5.7 Agent capabilities layer (product feature — the AI agents this app ships)
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

> **Scope:** this section is about the AI agents that are a **runtime feature of the product we
> build** — the tools the product exposes to *its own* AI agents at runtime. It is **not** about
> Claude Code / the dev agent working on this repo (those rules are §8–§10). "Human-in-the-loop"
> below means the product's **end user**, enforced in code — not the developer.

Every existing and new backend plugin exposes its methods to the product's AI agents through a
**capabilities layer** (atomic tools). When adding or changing a plugin, keep this layer in sync.

- **Every exposed tool is classified in code into one of three permission levels, and the runtime
  enforces the level:**
  - `READ` — safe queries/reads. No confirmation needed.
  - `WRITE` — adds/updates data. **Defaults to a confirmation gate** (like `DESTRUCTIVE`), so the
    end user approves the change before it runs. An admin can relax a specific tool to auto-run (with
    a notification / non-blocking audit-log entry) from the settings UI. The default is seeded on a
    tool's first registration only (`defaultConfirmationPolicy`); existing per-tool config is never
    rewritten.
  - `DESTRUCTIVE` — deletes/wipes data. The runtime **MUST block and require explicit
    human-in-the-loop (end-user) confirmation before executing.**
- Architecture details and code templates: [`docs/agent-capabilities.md`](docs/agent-capabilities.md).
- Each plugin declares its tools in `libs/plugin-<id>/src/backend/<id>.tools.ts` via
  `withPlugin('<id>', 'plugins.<id>.name', [...])`. Plugin authoring recipe:
  [`docs/plugins.md`](docs/plugins.md).
- **Tool text is i18n, never literal.** A tool and each of its parameters carry a `descriptionKey`
  (i18n key), not a `description` literal. The value lives in the plugin's `i18n/{en,ru}.json`; the
  LLM gets it resolved to the user's locale via `PluginI18nService.resolveTool` and the settings UI
  resolves it with `$t()`. See §5.5.

### 5.8 Multi-user overlay — declaring rights & permissions in plugins
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

The optional `multiuser` plugin adds JWT auth, per-user data scopes, scope sharing and per-user
plugin sets. Every plugin must stay correct with the overlay **on and off**; the overlay consumes
only declarations. Full author's guide: [`docs/multiuser.md`](docs/multiuser.md).

- **Manifest flags:** `settingsAdminOnly` (settings surface is instance administration — pair with
  `@AdminOnly()` on its routes), `readOnlyScopeExempt` (ONLY when every mutation writes user-bound
  private data; keeps the plugin usable in READ-shared scopes), `defaultEnabled: false` (opt-in
  overlays ship disabled), nav item `adminOnly: true` (+ route `meta.adminOnly`).
- **Route decorators** (backend-core): `@PluginOwner('<id>')` on every controller; `@Public()` only
  for surfaces authenticated by other means (tokenized phone routes, capability URLs, the auth
  endpoints) — everything else 401s anonymously while the mode is on; `@AdminOnly()` for instance
  administration.
- **Data scoping:** every new top-level model gets a nullable `scopeId` column (`@@index`, no FK)
  **and an entry in `SCOPE_MODEL_MAP`**
  ([`libs/plugin-multiuser/src/backend/scope-model-map.ts`](libs/plugin-multiuser/src/backend/scope-model-map.ts))
  — `direct` or `child` (relation filter + flat-FK `parents`); `binding: 'user'` for private
  per-creator data. A scoped model missing from the map **leaks across users**. Flat FKs only, no
  `upsert` on scoped models (the policy fails loud on both). Add the model to
  `BackfillService.claimOrphans` if rows can predate the mode.
- **Optional:** `ScopeRestrictionDescriptor` via `ScopeRestrictionRegistryService` (data-level
  sharing restrictions the plugin announces; never include user-bound models);
  `registerLifecycleHooks('<id>', { onEnabled?, onDisabled? })`.
- **Frontend:** all HTTP via `apiFetch`/`apiJson` (never raw `fetch`; `public: true` for tokenless
  surfaces); route `meta` `public`/`fullscreen`/`adminOnly`; role/mode from `useSessionStore()`;
  `usePluginsStore().isEnabled` is the per-user effective state, `instanceEnabled` the raw admin
  toggle; shell-level fetches must not fire pre-login.
- **Agent tools:** nothing extra to declare — the runtime filters by the caller's effective plugin
  set and hides non-READ tools in READ-shared scopes; handlers run inside the request context, so
  their Prisma calls are scoped automatically.

### 5.9 Object references (ORef) — one canonical object identity
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

Every object is named by ONE canonical reference:
`mk://<pluginId>/<entityType>/<entityId>[#<fragment>]`. `format`/`parse`/guards + `resolveEntityId`
live **only** in [`libs/plugin-contract/src/lib/object-ref.ts`](libs/plugin-contract/src/lib/object-ref.ts)
— never hand-roll an ORef regex. Full guide: [`docs/object-refs.md`](docs/object-refs.md).

- **Contract.** `entityId` is the Prisma `@id` **verbatim** (never a name, never composite); a
  fragment's grammar is owned by its entity type (the storage cell reuses `grid-address.ts`);
  `parse(format(x))` round-trips, invalid ⇒ `null`.
- **A plugin that owns referenceable entities declares its types:** backend
  `agentRegistry.registerObjectRefResolver(pluginId, entityType, resolver)` (resolves to name +
  breadcrumb via its own service), frontend `refToRoute` on `registerPlugin` (ORef → route); detail/
  form views publish the current selection via `setPageContextRefs` (→ `PageContext.refs`).
- **Agent tools** accept an ORef wherever they take a raw id (`resolveEntityId` → ownership check →
  id; raw ids still work) and return a canonical `ref` on outputs. The generic READ tool
  `resolve_object_ref` turns any ref into name + location.
- **Chat replies** link the object's **name** via a Markdown link `[name](mk://…)` — never print a
  bare `mk://…`; the renderer resolves it to an in-app link (`resolveObjectRefRoute`).

### 5.10 Cross-plugin integration — contributions, capabilities, events
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

**A plugin never imports another plugin's code** — only `plugin-contract`, `backend-core`,
`frontend-core`. Disabling a plugin removes exactly its functionality, everywhere. Full guide with
the slot/capability/event catalogue: [`docs/plugins.md`](docs/plugins.md) §8.

- UI implementing another plugin's functionality → a **contribution** into a named slot of the
  host (`registerPlugin({ contributions })`; hosts render `<PluginSlot>` /
  `useSlotContributions(slot)` — enabled contributors only).
- UI merely navigating to another plugin → gate on `usePluginsStore().isEnabled('<id>')` and skip
  its API fetches while disabled; hidden inputs keep their loaded values.
- Backend writes to another plugin's models → move to the owner: an endpoint under its
  `@PluginOwner`, or an owner-registered listener on `PluginEventBusService` (emitters
  `emit(event, payload)` fire-and-forget; the bus skips disabled listeners).
- Service surfaces between plugins → `CapabilityRegistryService`: owner registers in
  `onModuleInit()`, consumer resolves per call; `null` (unregistered or owner disabled) means
  "the feature doesn't exist" — degrade or throw an i18n-keyed error.
- Contracts (slot meta, capability interfaces, event payloads) live in
  `libs/plugin-contract/src/lib/capabilities.ts`. Data always survives disable; `projects` and
  `settings` are core (never disabled), so depending on their data/API is safe.

### 5.11 Standalone third-party-style code (`libs/plugin-sdk`, `examples/*`)
> Mirrored from [`.agents/AGENTS.md`](.agents/AGENTS.md) (Antigravity). That file is canonical for
> this rule — keep both in sync when it changes.

`libs/plugin-sdk` and every plugin under `examples/*` are deliberately **standalone code written
the way a third-party author would write it**: plain Node processes with no NestJS, no
`PluginI18nService`, no `AppConfigService` and no access to the app's Vue layer. For these paths
only, the repo conventions that assume that infrastructure do **not** apply:

- `console.*` logging is allowed (there is no Nest `Logger`) — the §5.2 ban targets app code.
- Raw `process.env` reads are allowed (there is no settings/config service).
- Operator-facing log/error strings are plain **English** literals (there is no i18n runtime);
  strings that travel through the contract to the core (manifest labels, screen trees) still carry
  i18n keys, resolved by the core. This is a sanctioned exception to §5.5, like Swagger doc text.
- Each example ships its own `CLAUDE.md`/`AGENTS.md`; inside an example directory those files
  govern, not this one.

Everything else still holds — strict TS (no `any`, no naked `as`), exact-version dependency
pinning (§5.6), and the Apache import boundary (§11: `plugin-sdk` imports only `plugin-contract`;
examples import only `plugin-sdk`/`plugin-contract`).

## 6. Named failure modes — and the rule that prevents each

<!-- TODO: this section is the highest-value part of the file, but it must be grown from THIS
     project's own history — the mistakes actually made here. Seed it with the stack-generic traps
     below, then add project-specific ones as they occur. -->

1. **The `event`-key ack trap.** Returning `{ event: '...', ... }` from a WS ack handler makes
   NestJS treat it as a `WsResponse`; the client's `emitWithAck` hangs.
   *Rule:* never include a top-level `event` key in any gateway return value.
2. **The hardcoded string.** Any text-string literal in code — a UI label, a toast/alert, a thrown
   error, a persisted note, an **LLM prompt**, or an **agent-tool description**. The only allowed
   string literals are i18n keys.
   *Rule:* every string is an i18n key — `t()`/`$t()` on the frontend, `PluginI18nService` on the
   backend, `descriptionKey` on tools. Follow the §5.5 recipe. Before declaring done, scan the diff
   for any text literal (Cyrillic or prose) outside `i18n/*.json`.
3. **The full-repo lint.** Running ESLint for every project sequentially mid-task.
   *Rule:* `nx lint <project>` or `npx eslint <file>`; the full run is CI/final-check only.
4. **The pushState regression.** Hand-rolled navigation in a view instead of vue-router.
   *Rule:* vue-router is the single source of truth; drill-downs are route-driven with a
   `watch(() => route.fullPath, syncFromRoute, { immediate: true })`.
5. **The generated-file edit.** Changing `dist/**` or generated files under `node_modules/`.
   *Rule:* never — these are build outputs; find the source.
6. **The infra rabbit hole.** Probing Docker/nginx/tunnel/DNS to explain a blank page.
   *Rule:* suspect application code first — read the wiring (route registration, imports, handler,
   data shape) before touching infrastructure, and don't investigate infra until the code is ruled
   out and the user explicitly said to.

## 7. Quality bar per deliverable — checkable criteria

Each item is verifiable yes/no. "Done" means every applicable item passes; if one is intentionally
skipped, say so explicitly when reporting.

**Any change**
- [ ] `nx lint <each-changed-project>` passes.
- [ ] `nx build <each-changed-project>` (or `nx run-many -t build` when a lib changed) passes.
- [ ] No `any`, no naked `as`, no `console.log`, no cross-project relative imports in the diff.
- [ ] Existing tests still pass: `nx test <project>`; new logic with branching gets a spec next to it.
- [ ] New/changed behavior reported honestly: what was verified, how, and what was not.

**Backend change**
- [ ] Every new `@SubscribeMessage` handler: has a DTO with `@MaxLength` on strings, returns the
      documented ack shape, never throws, and has no top-level `event` key.
- [ ] Shared payload shapes (client + server both touch them) are declared in a shared types lib.
- [ ] Secrets/config read through the settings/config service — never `process.env` directly.

**Frontend change**
- [ ] Zero new hardcoded strings — every new key present in the schema + all required locales.
- [ ] Dark and light theme both checked.
- [ ] Interactive UI reuses a `frontend-core` primitive (Button/Switch/Modal/Badge/Spinner/…), not a
      new hand-classed control; user feedback via `useToastStore`/`useConfirm`, never `alert`/`confirm`.
- [ ] No invented Tailwind classes — the dead-class sweep in §5.4 returns nothing; new tokens/sizes/
      animations are registered in `tailwind.config.js`. Interactive controls have focus rings + labels.
- [ ] No presentation baked into a locale value (framing dashes, prefixes, separators) — the
      component renders it; every "nothing chosen" picker row carries `empty: true` (§5.4).
- [ ] Cross-screen state lives in a Pinia store; route guards updated if the flow changed.
- [ ] Navigation state is route-driven — no `history.pushState`, no manual hash handling.

**Commit / ticket close** (see §9)
- [ ] Commit message `type(scope): description`, footer `Closes #N` / `Refs #N`, **no AI attribution
      of any kind**.
- [ ] Only intentional files staged (check `git status` for strays).

## 8. When uncertain — escalation rules

Work autonomously by default; escalate on these exact triggers:

1. **Answer exists in the repo** (code, git history, AGENTS.md, docs, the tracker issue) → find it
   and cite the file. Do not ask the user things the codebase already answers.
2. **Two valid designs with different user-visible behavior** (UX flow, data retention, pricing
   semantics, event naming the client depends on) → present both options with a recommendation
   **before** building either.
3. **Destructive or irreversible actions** → always stop and show exactly what will run first:
   any raw SQL / schema push against the DB, deleting/purging queues, `git push --force`, rewriting
   published history, deleting files you did not create, prod-facing config changes.
   (This governs *your* actions as the dev agent. The product's own runtime `DESTRUCTIVE`-tool
   confirmation is a separate, code-enforced feature — see §5.7.)
4. **Scope growth.** If the correct fix exceeds the ticket, do the ticket-sized fix, then propose a
   follow-up issue — do not silently expand the diff.
5. **Blocked by environment.** If something env-related fails twice (ports, containers, tunnel),
   report the exact state and stop; do not modify infrastructure without an explicit go-ahead.
6. **Issue state is authoritative.** Never assume what a ticket says, its parent, or its status —
   read it via the tracker before branching or closing.
7. **Conflicting instructions** (this file vs. a sub-AGENTS.md vs. the user) → the user wins, then
   the more specific document; say which rule you overrode and why.

## 9. Git, Tickets, Time

### Forgejo (tracker)
Development happens on a private **Forgejo** instance; the public repository is
`makekeeper/makekeeper` on GitHub. Neither the instance address nor its repository path belongs in
this repository — read both from the (gitignored) `.env`, together with the API token:

- `FORGEJO_BASE_URL` — instance base URL, no trailing slash.
- `FORGEJO_REPO` — `<owner>/<repo>` on that instance. API base:
  `$FORGEJO_BASE_URL/api/v1/repos/$FORGEJO_REPO`.
- `FORGEJO_TOKEN` — API token; auth header `Authorization: token <TOKEN>`.

All three are documented (empty) in [`.env.example`](.env.example). Use **curl** for all repository
interaction (issues, comments, labels, time): write a small script into the scratchpad that reads
the values itself and never echoes the token, and build JSON bodies with
`jq -n --arg title "$T" --rawfile body body.md '{title:$title, body:$body}'`. Default push remote:
`origin`.

There is **no MCP server for the tracker** in this repo — the previous `.mcp.json` + submodule
wiring was dead (uninitialized submodule, no env expansion) and was removed. To use one, clone it
into `.tools/` (gitignored) and add a local `.mcp.json` — do not commit either.

### Branching
- **Always create a branch before starting** — never work on `master`/`main`.
  Naming: `feature/<issue>-<slug>`, `fix/<slug>`, `chore/<slug>`.
- **Task hierarchies:** a head/parent task gets one integration branch off the default branch.
  Subtasks branch **off the head branch**, merge back into it with `--no-ff` when done, and never
  touch the default branch directly. The default branch is merged once, at the very end, only when
  the whole hierarchy is complete **and the user confirmed**.

### Commits
- **Never commit without explicit user approval** — show what will be committed and wait.
- Message: `type(scope): description`; footer `Refs #<n>` or `Closes #<n>`.
- Commit messages must not mention AI agents, assistants, or tools — no `Co-Authored-By`, no
  "Generated with …", nothing similar.
- **Never push** without explicit user instruction.

### Time tracking
1. On starting an issue: state "Starting work on #N at HH:MM UTC".
2. On finish or pause: log elapsed minutes via the tracker's add-time tool.

### Ticket completion ritual
When the user explicitly signals a ticket is done ("ticket done", "close the ticket", "wrap up"),
execute **in order, without further confirmation**:
1. Log time.
2. Post an English summary comment on the issue (specific: backend + frontend changes, new
   events/components/translations, notable decisions).
3. Stage and commit (conventional message, `Closes #<n>` footer).
4. Close the issue.
5. Push the branch.
6. Merge to the right target: subtask → `--no-ff` into its head branch and push that;
   head/standalone → into the default branch **only** after all subtasks are done and the user
   confirmed.

## 10. Do Not

- Edit `dist/**` (build output) or generated files under `node_modules/`.
- Run any destructive DB/queue/history operation without reviewing exactly what will run first.
- Ship a product `DESTRUCTIVE`-classified agent tool that executes without a code-enforced
  human-in-the-loop (end-user) confirmation gate (§5.7).
- Add a dependency with a `^`/`~` range, younger than one week, or with known vulnerabilities (§5.6).
- Write framing punctuation into a locale value (`"— No supplier —"`), or hand-roll a "nothing
  chosen" picker row instead of `empty: true` — presentation belongs to the component, or half the
  locales and half the call sites will diverge from it (§5.4).
- Write a text-string literal in code — UI text, thrown errors, persisted notes, LLM prompts, or
  agent-tool descriptions. The only allowed string literals are i18n keys; backend text resolves
  through `PluginI18nService`, tools use `descriptionKey` (§5.5).
- Import one plugin's code from another plugin (`@makekeeper/plugin-<other>` inside
  `libs/plugin-<id>`) — integrate via contributions, capabilities or events instead (§5.10).
- Hand-roll an ORef — regex/format a `mk://…` string by hand — instead of `object-ref.ts`'s
  `formatObjectRef`/`parseObjectRef`/`resolveEntityId`; or pass a raw id where a tool now accepts an
  ORef without the ownership check (§5.9).
- Call this project "open source", or change a `LICENSE` / `LICENSE.md` / `LICENSING.md` file
  without reading §11 first.

---

## 11. Licensing — facts you must not re-derive

The repository is **multi-licensed**, and the split is deliberate. [`LICENSING.md`](LICENSING.md) is
the authoritative path-level map; this section exists so the rules are in front of you before you
touch anything public-facing.

| Path | License |
|---|---|
| `apps/*`, `libs/plugin-*` (the product) | **FSL-1.1-ALv2** — [`LICENSE.md`](LICENSE.md) |
| `libs/plugin-contract`, `libs/frontend-core`, `libs/backend-core` (the SDK plugin authors import) | **Apache-2.0** — per-directory `LICENSE` |

Principle: **what others build on is permissive; what is our product is FSL.** A plugin-facing
library must never import from `apps/*` or `libs/plugin-*` — that would drag the FSL restriction
onto third-party plugin authors and defeat the split. This boundary was verified in #84 and must
stay clean.

- **Licensor / copyright holder:** DMITRII TITOV.
- **FSL permits, for free:** personal use, self-hosting (including inside a company), modification,
  forking, non-commercial education and research, contributing back.
- **FSL forbids:** a *Competing Use* — offering MakeKeeper, or something substantially similar, to
  others as a commercial or managed service.
- **Future license:** each released version additionally becomes **Apache-2.0 two years** after its
  release.
- **Contributions:** DCO sign-off (`git commit -s`), inbound = outbound, and the Licensor reserves
  the right to license contributions under additional commercial terms — see
  [`CONTRIBUTING.md`](CONTRIBUTING.md). Do not accept a contribution that bypasses this.

**Never describe the project as "open source."** The term is defined by the OSI, whose definition
forbids restricting fields of endeavour — which FSL does. The correct word is **source-available**.
AGPL was considered and rejected: it would have kept the label but only forces a competitor to
publish modifications, not to refrain from competing. GitHub showing the license as "Other" is
expected — FSL is not an SPDX identifier.

Public-facing wording (site, README, release notes) is governed by the same rule; the marketing
site keeps its own decision record with the full reasoning.
- <!-- TODO: add project-specific hard "never do this" rules as they are discovered. -->
