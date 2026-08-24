# Multi-user mode (`multiuser` plugin)

An **optional overlay** that adds accounts, per-user data scopes, scope sharing
and access control. Packaged as a regular plugin: its enable/disable flag in
*Settings → Plugins* **is** the multi-user mode toggle. Disabled (the default),
the app runs single-user with no authentication — exactly as if the plugin did
not exist.

## Configuration

| Env var | Required | Meaning |
|---|---|---|
| `JWT_SECRET` | yes (to sign in) | JWT signing secret, **min 32 chars**. Unset/short ⇒ login & registration answer 503; rotating it invalidates every issued token (the token-revocation escape hatch). |
| `JWT_TTL` | no | Token lifetime: `3600`, `45m`, `12h` or `30d` (default `7d`). |

## Enable / disable semantics

- **Enabling** (Settings → Plugins, anonymous in single-user mode): after the
  transition effect (below) the app reloads and the router guard lands on
  `/login`:
  - no users yet → the **register** tab with a first-admin hint; the first
    registered account becomes the administrator and **claims all existing
    data** (rows with `scopeId NULL`) into its scope;
  - users exist (re-enable) → the normal login form; accounts and scopes
    survived from the previous enablement. The `onEnabled` lifecycle hook
    re-claims rows created while the mode was off for the oldest admin.
- **Disabling**: admin-only while the mode is on (`PATCH /api/plugins/:id` is
  `@AdminOnly`). Afterwards the app is single-user again: no login, all data
  visible, every enforcement seam passes through.

### Mode-transition UX

Because flipping this one plugin swaps the app's entire auth/data universe, its
toggle is deliberately theatrical — implemented via the **frontend lifecycle
hooks** `onInstanceEnabled`/`onInstanceDisabled` the plugin declares in its
`registerPlugin` call (see `docs/plugins.md`), not via special cases in the
settings UI:

- Both directions play a fullscreen Siri-style overlay
  (`ModeTransitionOverlay.vue`, mounted once in `App.vue`): an orb of swirling
  blurred color blobs with an aurora glow running around the screen edge and a
  progress sweep. Enabling runs it in full spectrum with a hue-rotate shimmer;
  disabling is the same swirl drained to slate grays. Palette/animation tokens
  (`bg-mode-aurora`, `bg-mode-aurora-dim`, `animate-mode-*`) live in
  `tailwind.config.js`; the overlay duration is `TRANSITION_MS` in the plugin's
  `transition-store.ts` and must stay in sync with the registered
  `mode-sweep` animation duration.
- The hook ends in a **hard reload** to `/` — a guaranteed purge of every
  component-local cache (same rationale as the scope switcher); the router
  guard then routes to `/login` or the single-user dashboard.
- In Settings → Plugins the plugin's row stays in the shared list but carries
  an iridescent tint and an aurora icon chip. The highlight is generic: any
  plugin that declares frontend lifecycle hooks is marked as mode-changing —
  `PluginsAdminView` knows no plugin ids.

## Model

- **Scope = user.** A scope id is the owning user's id (no separate table).
  Top-level aggregates carry a nullable `scopeId` column (`Project`,
  `Component`, `Order`, `Storage`, `StockMovement`, `AIChatSession`,
  `Attachment`); child rows (`Task`, junction tables, chat messages) are
  confined through their parent relations.
- **Chats are private.** `AIChatSession`/`AIChatMessage`/`Attachment` are
  **user-bound**: filtered and stamped by the caller's user id regardless of
  the active scope. Sharing a scope shares the data, never the conversations —
  each user talks to the assistant in their own sessions, including inside a
  read-only shared scope (the `chat` manifest declares `readOnlyScopeExempt`;
  scope-bound writes stay blocked by the DB policy, and only READ tools reach
  the LLM there).
- **Admin** is scoped like everyone else — no access to other users' data.
  Extra privileges: user administration (`/settings/users`, summary counts
  only) and instance-wide settings (plugin toggles, AI providers, capture
  tunnel, agent tool policy).
- **Per-user plugins:** every user can switch off plugins for their own
  account (Settings → Plugins → "My plugins", `UserPluginConfig`), on top of
  the admin's instance-level toggles.
- **Admin-only plugin settings:** a plugin whose settings are instance
  administration (OS interaction, shared credentials) declares
  `settingsAdminOnly: true` in its manifest — the Settings host hides its panel
  from regular users while the mode is on, and its settings routes carry
  `@AdminOnly()`. Declared by: `capture` (cloudflared tunnel), `multiuser`
  (its own panel); the agent-tool policy view (`/settings/agent`) is
  admin-gated via nav/route `adminOnly`. The chat panel is deliberately NOT
  flagged — it is mode-aware instead (see AI connections below). Users may
  still toggle such plugins per-account — only their administration is
  restricted.
- **Mode settings** (Settings → the multiuser panel, admin-only), stored in
  the `MultiuserSettings` singleton: `allowRegistration` — open
  self-registration; when off, no new accounts can be created (the very first
  admin account is always allowed) and the login page hides the register tab.
- **AI connections** (`AIProviderConfig.ownerUserId`): the chat settings
  panel is mode-aware — admins manage the INSTANCE connections (root
  `/api/chat/providers` routes), every other user their PERSONAL ones
  (`/api/chat/providers/personal[...]`), same UI. **Credentials are property**:
  each connection carries an owner-controlled `sharedWith` level —
  `workspace-guests` (guests of the owner's workspace; on instance rows it
  means guests of an ADMIN's workspace — the admin is a workspace owner too)
  or, for instance rows only, `everyone`. Resolution per request: the
  caller's EXPLICITLY selected own connection → the workspace owner's
  guest-shared one (in a foreign scope) → the instance default shared with
  everyone (admins reach it regardless). The first created connection is
  auto-selected; deselecting (picking the pinned inherited row) returns the
  user to the shared one. Raw keys never leave the server; a connection
  outside the caller's namespace 404s.
- **Project-less chat:** `AIChatSession.projectId` is optional; the assistant
  falls back to global session routes (`GET/POST /api/chat/session[s]`) when
  the scope has no projects, so a fresh account can chat immediately. The chat
  header checks connectivity via `GET /api/chat/providers/active-status`
  (name + reachability only — config listing is admin-only).
- **Sharing:** a user grants another user access to their scope
  (Settings → Sharing, `ScopeGrant`): access level `READ`/`WRITE`, a subset of
  plugins, and optional **plugin-announced resource restrictions** (see below).
  The grantee switches into the shared scope from the header user menu; the
  active scope travels as the `x-scope-id` request header.

## Enforcement (the "proxy")

Neutral seams live in `backend-core`; the plugin registers implementations at
bootstrap. No registration (or plugin disabled) ⇒ structural pass-through.

1. **`MultiuserGuard`** (global `APP_GUARD` provided by the plugin module):
   verifies the Bearer JWT, resolves the active scope/grant, computes the
   effective plugin set (instance ∧ per-user ∧ grant), stamps everything into
   the AsyncLocalStorage request context (`RequestContextService`), enforces
   `@Public()` / `@AdminOnly()` / per-user plugin 404s / read-only-scope 403s.
2. **`ScopePolicyService`** (a `DbAccessPolicy` consulted by PrismaService's
   `$extends` query hook): injects scope + grant-restriction WHERE filters on
   reads, stamps `scopeId` and verifies parent ownership on writes, rejects
   mutations under `READ` grants, rewrites `findUnique` to a filtered
   `findFirst`, fails loud on scoped-model `upsert`.
3. **Tool access policy** (`AgentRegistryService`): the AI agent only sees
   tools of plugins in the effective set; in read-only scopes WRITE/DESTRUCTIVE
   tools are hidden (including the confirm-tool path).
4. **`apiFetch`** (`frontend-core`): the single frontend HTTP client — injects
   `Authorization`, `x-scope-id`, `x-locale`; funnels 401 into logout+/login.
   Raw `fetch('/api/...')` is no longer used anywhere.

A session travels by **two** credentials, both verified by the guard (1):

- the **bearer token** — everything the SPA fetches itself, through `apiFetch`;
- the **`mk_session` cookie** — issued alongside the token by `/auth/login`,
  `/auth/register` and refreshed on `/auth/status`, cleared by `/auth/logout`
  ([`session-cookie.ts`](../libs/plugin-multiuser/src/backend/session-cookie.ts)).
  It exists for the requests the *browser* makes on its own, which cannot carry
  a header: `<img :src>` and the `DownloadURL` drag-out payload (#109). Scoped
  `Path=/api/uploads`, `HttpOnly`, `SameSite=Lax`, `Secure` only on an https
  request; the guard honours it on **safe methods only**, so it can never
  authenticate a mutation (#123).

Marked public surfaces (reachable without a login while the mode is on): the
auth endpoints themselves, phone-capture token routes, the root ping and
`GET /api/plugins`. `GET /api/uploads/:id` is **not** among them — see below.

## Known limitations (v1)

- No token revocation list — logout is client-side; rotate `JWT_SECRET` to
  invalidate all tokens.
- A file uploaded in a chat while a project is open is a **project file**, and
  therefore visible to everyone that project is shared with — while the chat
  session and the message carrying it stay private. That is the ownership rule
  working as intended (#125), not a leak of the conversation; if it surprises
  people, the fix is showing the active context in the chat, not re-privatising
  the file.
- The surfaces that hand out a denormalized attachment URL
  (`Component.imageUrl`) still drop the ones the caller cannot read, so no
  broken `<img>` reaches the page. Since #125 that guards against a
  client-supplied URL naming a foreign attachment, not against unshared photos.
- Signed, expiring URLs for `/api/uploads/:id` were considered and rejected
  (#123): with the cookie in place their only remaining job would be sharing an
  attachment outward, which this product does not do.
- The grantee picker lists all registered users by display name.

---

## Writing a multiuser-aware plugin (author's guide)

Everything the overlay needs from a plugin is **declarative**: manifest flags,
route decorators, one entry in the scope-model map, and (optionally) a
restriction descriptor. A plugin that declares nothing still works — its
routes require a login, its data is scoped per user, its tools follow the
caller's effective plugin set. The declarations below refine that default.

### 1. Manifest flags (`libs/plugin-<id>/src/manifest.ts`)

| Flag | Meaning | Declare when… |
|---|---|---|
| `defaultEnabled: false` | Seeded disabled on first registration. | The plugin is an opt-in overlay whose mere enablement changes app behavior (like `multiuser` itself). |
| `settingsAdminOnly: true` | The plugin's settings panel is instance administration: hidden from regular users, its routes should also carry `@AdminOnly()`. | Settings touch the OS, shared credentials or instance-wide policy (`capture` tunnel, agent tool policy). |
| `readOnlyScopeExempt: true` | The guard admits the plugin's mutating routes inside a READ-shared scope. | Every mutation of the plugin writes **user-bound** (private) data, never scope data (`chat`: sessions/messages belong to the caller). The DB policy still blocks scope-bound writes independently — this flag never weakens data protection. |
| nav item `adminOnly: true` | Sidebar entry (and the route via `meta.adminOnly`) visible to admins only while the mode is on; unaffected in single-user mode. | The page is instance administration (`/settings/plugins`, `/settings/agent`, `/settings/users`). |

### 2. Route protection (`@makekeeper/backend-core` decorators)

- `@PluginOwner('<id>')` on every controller — required for plugin gating
  (instance + per-user 404s) regardless of multiuser.
- `@Public()` — reachable **without a login** while the mode is on. Use only
  for surfaces that authenticate by other means: tokenized phone routes
  (`capture/sessions/:token/*`), the auth endpoints themselves. Everything not
  marked public answers 401 to anonymous callers. An "unguessable id" is **not**
  an authentication mechanism — `GET /uploads/:id` was public on that reasoning
  and stopped being so in #123; a route the browser fetches by itself should
  take the session cookie instead.
- `@AdminOnly()` — instance administration (plugin toggles, provider CRUD,
  capture settings/tunnel, agent-tool policy). A no-op in single-user mode.

### 3. Data scoping (new models)

1. Top-level aggregates get a **nullable `scopeId` column** with
   `@@index([scopeId])` and **no FK** to `User` (rows must survive the plugin
   being disabled). Child rows reachable through a parent need no column.
2. Register the model in **`SCOPE_MODEL_MAP`**
   ([`libs/plugin-multiuser/src/backend/scope-model-map.ts`](../libs/plugin-multiuser/src/backend/scope-model-map.ts)):
   - `{ kind: 'direct' }` — has its own `scopeId`;
   - `{ kind: 'child', scopeWhere, parents }` — confined via a relation
     filter; `parents` lists the flat FK fields creates must prove ownership
     for (the policy re-queries each parent through itself, so grant
     restrictions apply to the check too);
   - `binding: 'user'` — the row belongs to its **creator**, not the browsed
     scope (private data: chat sessions and messages). User-bound rows stay
     writable in READ-shared scopes and are never narrowed by grant
     restrictions;
   - `binding: 'conditional'` — the row belongs to whatever its **parent**
     belongs to, and falls back to its creator only when it has **no parent at
     all**. The parents are the ones already listed in `parents`, so the
     ownership rule cannot drift from the in-scope check performed on the same
     FKs. Declared by `Attachment` (#125): a file dropped into a project is the
     project's, a photo is its component's, a file with nothing to belong to is
     its uploader's. Note what does **not** confer ownership — a chat or
     phone-bridge session is a conversation and a transport, not a thing a file
     becomes part of, so those columns are not `parents`.
     The policy owns the split, so plugin code stays simple: re-parenting a row
     restamps `scopeId` automatically (state **every** parent in the update or
     it fails loud), a READ grant confines mutations to the parentless half
     instead of refusing them, and a restriction descriptor narrows the shared
     half only — a descriptor can never reach a private row, which is why the
     "no user-bound models in the constraint map" rule below still holds.
     A model that carries both roles also needs a column for the second one:
     `scopeId` answers *who owns it*, and something like
     `Attachment.uploadedByUserId` answers *who added it*. Never consult the
     latter for visibility.
   A scoped model **not** in the map is invisible to the policy — adding the
   Prisma model without the map entry leaks data across users.
3. Constraints the policy enforces on scoped models: services use **flat FKs**
   (no nested `connect`/`create` writes) and **no `upsert`** — both fail loud
   by design. Existing services keep calling Prisma normally; the policy
   injects WHERE filters, stamps `scopeId` on creates and pre-checks
   update/delete targets.
4. Add the model's `updateMany` claim to
   [`BackfillService.claimOrphans`](../libs/plugin-multiuser/src/backend/backfill.service.ts)
   if rows can be created in single-user mode (they start with `scopeId NULL`
   and must be claimable by the first admin).

### 4. Announcing scope restrictions (optional)

A plugin whose data can meaningfully narrow a shared scope registers a
`ScopeRestrictionDescriptor` (contract in `@makekeeper/plugin-contract`)
with `ScopeRestrictionRegistryService` in its module's `onModuleInit`:

```ts
this.scopeRestrictions.register({
  pluginId: 'projects',
  resourceKey: 'project',
  labelKey: 'projects.restrictions.byProject', // sharing-UI section title
  listOptions: (ownerScopeId) => /* pick list of {id, label} in that scope */,
  buildModelConstraints: (ownerScopeId, selectedIds) =>
    /* Prisma model name → where-fragment confining it to the selection */,
});
```

The sharing UI renders the pick list generically; the guard translates a
grant's selections into per-model constraints ANDed into every query.
Reference implementations: `projects.restrictions.ts` (by project),
`storages.restrictions.ts` (by storage subtree). Do **not** include
user-bound models in the constraint map — private data is never shared.

### 5. Lifecycle hooks (optional)

```ts
this.pluginConfig.registerLifecycleHooks('<id>', {
  onEnabled: async () => { /* one-time setup on the off→on transition */ },
  onDisabled: async () => { /* cache cleanup on on→off */ },
});
```

Invoked only on real transitions, awaited, best-effort (a failing hook is
logged, the toggle is not rolled back).

### 6. Frontend rules

- All HTTP through **`apiFetch`/`apiJson`** (`@makekeeper/frontend-core`) —
  never raw `fetch`. Tokenless surfaces (phone capture page, login) pass
  `public: true`.
- Route `meta`: `public: true` (reachable when anonymous), `fullscreen: true`
  (bare page without the shell), `adminOnly: true` (redirects non-admins).
- Role/mode state comes from `useSessionStore()` (`multiuserEnabled`,
  `isAuthenticated`, `isAdmin`, `activeScopeAccess`); effective plugin states
  from `usePluginsStore()` (`isEnabled` — per-user; `instanceEnabled` — raw
  admin toggle).
- Shell-level fetches must not fire pre-login: gate on
  `!session.multiuserEnabled || session.isAuthenticated` (see the chat init
  in `App.vue`).

### 7. Agent tools

Nothing extra to declare: the runtime already filters tools by the caller's
effective plugin set and hides WRITE/DESTRUCTIVE tools inside READ-shared
scopes. The usual capability rules (§5.7: permission levels, `confirmSummary`,
`descriptionKey`) apply unchanged; tool handlers run inside the request
context, so their Prisma calls are scoped automatically.
