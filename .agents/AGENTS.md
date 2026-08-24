# Custom Rules

## NPM Package Management
- **Strict Version Pinning**: All dependencies in `package.json` must be strictly pinned (e.g., `"name": "1.2.3"` instead of `^1.2.3` or `~1.2.3`).
- **Release Date Restriction**: Installed NPM packages must have been released at least one week before the current date. Given the current date is **July 10, 2026**, all packages must have been released before **July 3, 2026**.
- **No Vulnerabilities**: Only install packages and versions that have no known security issues (no vulnerability reports).

## Docker Command Execution
- **Pre-approved Docker Commands**: Commands executed inside the running devcontainer utilizing the pattern `docker exec --user node -w /workspaces/makekeeper<any_subdirectory> makekeeper` are pre-approved and do not require additional confirmation.

## Agent Capabilities & Plugin Development
- **Self-contained plugin libraries**: Every plugin is its own NX library at `libs/plugin-<id>/`, exposed as `@makekeeper/plugin-<id>/{backend,frontend}`. A plugin declares its identity (`manifest.ts`), its own i18n (`src/i18n/{en,ru}.json`), its AI-agent tools, its optional settings, its sidebar entry and its routes — all in one place. The app shells consume the registry (data-driven sidebar/routes/i18n); nothing about a plugin is hardcoded in `apps/*`. Full recipe: [plugins.md](../docs/plugins.md).
- **Capabilities Layer**: Every existing and new backend plugin must implement a "capabilities layer" (atomic tools) to expose its methods to AI agents.
- **Tool text is i18n, never literal**: Each tool and each of its parameters carries a `descriptionKey` (an i18n key), never a `description` string literal. The text lives in the plugin's `i18n/{en,ru}.json`; the LLM receives it resolved to the user's locale via `PluginI18nService.resolveTool`, and the settings UI resolves it with `$t()`. See the i18n section below.
- **Permission Enforcement**: All tools exposed to the agent must be classified into three permission levels:
  - `READ` (safe queries/reads, no confirmation needed).
  - `WRITE` (adding/updating data). **Defaults to a confirmation gate** (like `DESTRUCTIVE`) so the end user approves the change before it runs; an admin can relax a specific tool to auto-run (with notification or non-blocking audit logging) from the settings UI. The default is seeded on a tool's first registration only (`defaultConfirmationPolicy`); existing per-tool config is never rewritten.
  - `DESTRUCTIVE` (deletion/wiping data, **MUST** block and require explicit human-in-the-loop confirmation before executing).
- **Documentation Reference**: Refer to [agent-capabilities.md](../docs/agent-capabilities.md) for architecture details and code templates.

## Cross-plugin integration — contributions, capabilities, events (#58)
> Canonical here (mirrored in CLAUDE.md §5.10) — keep both in sync when this changes.

A plugin never imports another plugin's code — only `plugin-contract`, `backend-core`, `frontend-core`. Disabling a plugin must remove exactly its functionality everywhere. Full guide: [plugins.md §8](../docs/plugins.md).

- **UI implementing another plugin's functionality** → a contribution into a named slot of the host: `registerPlugin({ contributions: [{ slot, component, order?, meta? }] })`; hosts render `<PluginSlot name :ctx>` / `useSlotContributions(slot)` — only enabled plugins' contributions render.
- **UI merely navigating to another plugin** → gate on `usePluginsStore().isEnabled('<id>')` and skip its API fetches while disabled; hidden inputs keep loaded values.
- **Backend writes to another plugin's models** → move to the owner: an endpoint under its `@PluginOwner` (guard 404s it when disabled) or an event listener the owner registers on `PluginEventBusService` in `onModuleInit()`; emitters `emit(event, payload)` fire-and-forget. Event names/payloads live in `plugin-contract/src/lib/capabilities.ts`.
- **Service surfaces offered to other plugins** → `CapabilityRegistryService` (backend-core): owner `registerCapability(pluginId, id, impl)`, consumer resolves per call via `getCapability<T>(id)` and treats `null` (unregistered or owner disabled) as "feature doesn't exist". Capability ids/interfaces live in the contract's `capabilities.ts`.
- **Data survives disable**: never drop rows/FKs; referential-integrity guards and purely historical reads of a neighbour's tables may stay direct. `projects` and `settings` are core (never disabled) — depending on their data/API is safe.

## Internationalization (i18n) — no hardcoded strings
> Canonical here (mirrored in CLAUDE.md §5.5) — keep both in sync when this changes.

- **No text-string literals anywhere in code — the ONLY string literals allowed are i18n keys.** No exceptions, no placeholders, no "temporary" values. This is broader than user-facing UI: it also covers text that never reaches the end user directly — **AI/LLM prompt text, agent-tool and parameter descriptions, model-facing history/notes, thrown error messages, persisted `note:` values, and page-context resolver output**. A `*.tools.ts` description or a chat system prompt is NOT exempt because it "only feeds the model" — it is still a string and must be a key. (Non-text literals — enum/union values, object keys, CSS classes, technical identifiers, model ids, provider brand nouns — are fine.)
- **Each plugin owns its i18n**: keys live in `libs/plugin-<id>/src/i18n/{en,ru}.json` (both locales, same commit).
- **Frontend** resolves keys with `t()`/`$t()`. **Backend** text assembled server-side (LLM prompts, tool descriptions, guard/exception messages) resolves with **`PluginI18nService`** (`@makekeeper/backend-core`): each plugin backend module calls `this.i18n.registerBundle({ en, ru })` once in `onModuleInit()`, then resolves via `this.i18n.t(key, params?, locale?)`.
- **Per-user locale**: AI-facing text follows the caller's locale, threaded from the client via the `x-locale` header → controller → service → `t()`/`resolveTool()`. Text with no per-user locale on its path (persisted notes, shared guard errors) resolves at the default locale. Core (non-plugin) backend text lives in `apps/backend/src/app/i18n/{en,ru}.json` under `core.*`. Follow the `plugin-capture` pattern: throw i18n keys, don't build prose.
- **Before declaring done**, scan the diff for any text literal (Cyrillic or prose) outside `i18n/*.json`.


## Standalone third-party-style code (`libs/plugin-sdk`, `examples/*`)
> Canonical here (mirrored in CLAUDE.md §5.11) — keep both in sync when this changes.

`libs/plugin-sdk` and every plugin under `examples/*` are deliberately **standalone code written
the way a third-party author would write it**: plain Node processes with no NestJS, no
`PluginI18nService`, no `AppConfigService` and no access to the app's Vue layer. For these paths
only, the repo conventions that assume that infrastructure do **not** apply:

- `console.*` logging is allowed (there is no Nest `Logger`).
- Raw `process.env` reads are allowed (there is no settings/config service).
- Operator-facing log/error strings are plain **English** literals (there is no i18n runtime);
  strings that travel through the contract to the core (manifest labels, screen trees) still carry
  i18n keys, resolved by the core.
- Each example ships its own `CLAUDE.md`/`AGENTS.md`; inside an example directory those files
  govern, not this one.

Everything else still holds — strict TS (no `any`, no naked `as`), exact-version dependency
pinning, and the Apache import boundary (`plugin-sdk` imports only `plugin-contract`; examples
import only `plugin-sdk`/`plugin-contract`).


## Multi-user overlay — declaring rights & permissions in plugins
> Canonical here (mirrored in CLAUDE.md §5.8) — keep both in sync when this changes.

The optional `multiuser` plugin turns the app multi-tenant: JWT auth, per-user data scopes, scope sharing, per-user plugin sets. Every plugin must stay correct with the overlay **on and off**; the overlay consumes only declarations. Full author's guide: [multiuser.md](../docs/multiuser.md).

- **Manifest flags** (`libs/plugin-<id>/src/manifest.ts`):
  - `settingsAdminOnly: true` — the plugin's settings surface is instance administration (OS interaction, shared credentials, instance-wide policy): the Settings host hides the panel from regular users; pair it with `@AdminOnly()` on the settings routes.
  - `readOnlyScopeExempt: true` — ONLY when every mutating route writes user-bound (private) data, never scope data; keeps the plugin usable inside READ-shared scopes (e.g. chat). The DB policy still blocks scope-bound writes independently.
  - `defaultEnabled: false` — opt-in overlays whose mere enablement changes app behavior; seeded disabled on first registration.
  - Nav item `adminOnly: true` (+ route `meta.adminOnly`) — instance-administration pages, hidden from non-admins while the mode is on.
- **Route decorators** (`@makekeeper/backend-core`): `@PluginOwner('<id>')` on every controller (plugin gating); `@Public()` only for surfaces that authenticate by other means (tokenized phone routes, opaque capability URLs, the auth endpoints) — everything else answers 401 to anonymous callers while the mode is on; `@AdminOnly()` for instance administration (no-op in single-user mode).
- **Data scoping**: every new top-level model gets a nullable `scopeId` column (`@@index`, NO FK to User) **and an entry in `SCOPE_MODEL_MAP`** (`libs/plugin-multiuser/src/backend/scope-model-map.ts`) — `direct` (own column) or `child` (relation filter + flat-FK `parents` for create-time ownership checks); `binding: 'user'` for private per-creator data (chat sessions and messages); `binding: 'conditional'` when the row belongs to its **parent** and falls back to its creator only when it has no parent at all (`Attachment`, #125 — a file follows its project or its component; a chat or bridge session is not a parent, so it confers nothing). The policy owns the conditional split: re-parenting restamps `scopeId` (state every parent or it fails loud), a READ grant confines mutations to the parentless half rather than refusing them, and restrictions narrow the shared half only. A conditional model also needs a separate column for attribution (`Attachment.uploadedByUserId` = who added it) since `scopeId` now answers only who owns it — never consult attribution for visibility. A scoped Prisma model missing from the map LEAKS across users. Services must use flat FKs (no nested writes) and no `upsert` on scoped models — the policy fails loud on both. Add the model to `BackfillService.claimOrphans` if rows can exist before the mode is enabled.
- **Scope restrictions (optional)**: if the plugin's data can narrow a shared scope (e.g. "share only project X"), register a `ScopeRestrictionDescriptor` (contract in `@makekeeper/plugin-contract`) with `ScopeRestrictionRegistryService` in `onModuleInit` — `labelKey` (i18n), `listOptions(ownerScopeId)`, `buildModelConstraints(ownerScopeId, ids)`. Never include user-bound models in the constraint map.
- **Lifecycle hooks (optional)**: `pluginConfig.registerLifecycleHooks('<id>', { onEnabled?, onDisabled? })` — run on real enable/disable transitions, awaited, best-effort.
- **Frontend**: all HTTP via `apiFetch`/`apiJson` from `@makekeeper/frontend-core` (never raw `fetch`; `public: true` for tokenless surfaces); route `meta` `public`/`fullscreen`/`adminOnly`; role/mode state from `useSessionStore()`, effective plugin states from `usePluginsStore()` (`isEnabled` per-user vs `instanceEnabled` raw); shell-level fetches must not fire pre-login.
- **Agent tools**: nothing extra — the runtime filters tools by the caller's effective plugin set and hides WRITE/DESTRUCTIVE tools in READ-shared scopes; handlers run inside the request context, so their Prisma calls are scoped automatically.

## Object references (ORef) — one canonical object identity
> Canonical here (mirrored in CLAUDE.md §5.9) — keep both in sync when this changes.

Every object is named by ONE canonical reference: `mk://<pluginId>/<entityType>/<entityId>[#<fragment>]`. `format`/`parse`/guards + `resolveEntityId` live **only** in `libs/plugin-contract/src/lib/object-ref.ts` — never hand-roll an ORef regex. Full guide: [object-refs.md](../docs/object-refs.md).

- **Contract**: `entityId` is the Prisma `@id` **verbatim** (never a name, never composite); a fragment's grammar is owned by its entity type (the storage cell reuses `grid-address.ts`); `parse(format(x))` round-trips, invalid ⇒ `null`.
- **A plugin that owns referenceable entities declares its types**: backend `agentRegistry.registerObjectRefResolver(pluginId, entityType, resolver)` in `onModuleInit` (resolves to name + breadcrumb via its own service); frontend `refToRoute` on `registerPlugin` (ORef → route); detail/form views publish the current selection via `setPageContextRefs` (→ `PageContext.refs`).
- **Agent tools** accept an ORef wherever they take a raw id (`resolveEntityId` → ownership check → id; raw ids still work) and return a canonical `ref` on outputs. The generic READ tool `resolve_object_ref` turns any ref into name + location.
- **Chat replies** link the object's **name** via a Markdown link `[name](mk://…)` — never print a bare `mk://…`; the renderer resolves it to an in-app link (`resolveObjectRefRoute`).
