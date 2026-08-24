# External (third-party) plugins — contract specification

Decision record: epic #131. This document is the normative companion to the
code contract in `libs/plugin-contract/src/lib/external/` (Apache-2.0 — plugin
authors depend only on that lib and this spec, never on FSL code).

An **external plugin** is a separate container running next to the MakeKeeper
core. It has its own database and its own scheduler; it talks to the core over
HTTP and never executes code inside the core process or inside the SPA. Its UI
is **declarative**: the plugin returns component trees from a fixed vocabulary
and the core renders them with its own primitives.

## 1. Contract versioning

- The contract version (`EXTERNAL_CONTRACT_VERSION`) is **independent of the
  product version**. The core may release weekly; the contract moves slowly.
- **Additive** changes (new node type, new optional manifest field, new
  endpoint) bump the **minor**. **Breaking** changes bump the **major**.
- The core supports the current major and, during a deprecation window, the
  previous one (`SUPPORTED_CONTRACT_MAJORS`).
- A manifest declaring an unsupported major is **rejected at registration**.
- An unknown UI node type or unknown optional field from an installed plugin is
  **skipped at render** (collected into a plugin-card notice) — never an error.

### Published spec artifacts (the language-agnostic path)

A plugin does not have to be written in TypeScript. The contract is published
in language-neutral form:

- **JSON-Schema** (draft 2020-12) for the manifest and the UI vocabulary:
  [`libs/plugin-contract/schemas/external-manifest.schema.json`](../libs/plugin-contract/schemas/external-manifest.schema.json)
  and
  [`libs/plugin-contract/schemas/external-ui.schema.json`](../libs/plugin-contract/schemas/external-ui.schema.json)
  (the latter also defines `$defs/actionResult` for action responses). The
  schemas are structural; the core's TypeScript validator additionally checks
  cross-references (screen keys, en-bundle completeness, capability prefixes)
  and stays authoritative. A drift-guard spec
  (`external-schemas.spec.ts`) keeps schema and validator agreeing.
- **OpenAPI** for both API surfaces (scoped + instance) and the registration/
  discovery endpoints: served by every running core at `/api/docs` (UI) and
  `/api/docs-json` (the document), under the `external` tag.

## 2. Manifest

Presented at registration; validated by `validateExternalManifest`. Cached by
the core so the app shell (sidebar, routes, widgets, tool list) renders even
while the plugin container is down.

Key rules:

- `pluginId` — `^[a-z][a-z0-9-]{1,31}$`, globally unique on the instance
  (collision with an internal or another external plugin is rejected).
- `scopeModel` — `instance` (default authoring model: single scope, no tenancy
  in the plugin) or `per-scope` (the plugin keys its own storage by the opaque
  `scopeId` it receives on every call; the core issues per-scope background
  tokens). The core refuses to enable an `instance` plugin in a second scope.
  The `scopeId` is opaque in the same way the `userRef` is: a stable,
  per-plugin, one-way reference (never the core's internal id), so two plugins
  cannot correlate scopes and a container never learns who a scope belongs to.
  Treat it as an identity to store, not a value to parse.
- `permissions` — see §3.
- `i18n` — locale → message tree. **`en` is mandatory and must contain every
  key the manifest references** (validated). Other locales are optional and
  fall back to `en`. Text in UI trees is always `{ key, params }` — a literal
  string where a `UiText` is expected is dropped by the sanitizer.
- `screens` — the screen keys the plugin can render; every nav item, widget,
  slot contribution and settings reference must point at a declared screen.
- `capabilities[].id` — must be prefixed `<pluginId>.`; foreign prefixes are
  rejected.

## 3. Permissions

Three grammar classes (`parseExternalPermission`):

| Grammar                                                           | Class      | Meaning                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<pluginId>:read` / `<pluginId>:write` / `<pluginId>:destructive` | scoped     | Data owned by internal plugin `<pluginId>`, within one scope, via the scoped surface. `destructive` (contract 1.11, #252) additionally reaches DESTRUCTIVE tools — a `write` grant never deletes — and each higher access implies the lower ones. Highlighted at consent like `instance:*`. |
| `instance:<pluginId>:read`                                        | instance   | Cross-scope **read-only aggregates** via the instance surface (elevated — highlighted at consent)                                                                                                                                                                                           |
| `capability:<id>`                                                 | capability | Invoke the registered capability `<id>`                                                                                                                                                                                                                                                     |

Granted at install on an explicit consent screen. **Any later expansion**
requested by an updated manifest is held in _pending_ state — the plugin keeps
running with its old grants until the admin confirms. Narrowing applies
immediately. (Decision #15.)

## 4. Identity and tokens

- **Interactive** calls (renders, actions, tools invoked from a user turn)
  receive a **short-lived delegated token** bound to the requesting user; calls
  back into the core with it pass the standard auth/scope stack — the plugin
  has no standing power of its own on this path.
- **Background** work authenticates with background tokens per the scope model:
  `background-scoped` (one scope) or `background-instance` (instance surface
  only). Issued after consent; revoked immediately at uninstall or narrowing.
- The plugin authenticates itself to the core with its **plugin secret**,
  issued once at first registration; re-registration after restart or update
  presents the same secret. A changed `pluginId` is a different plugin.
- **Connection tokens** (`mkt_…`, #249) are the odd one out: long-lived
  credentials issued to an OUTSIDE consumer (an MCP client, a script) in
  Settings → External plugins, not to a plugin. A connection token acts as its
  issuing user, clamped by an access **ceiling** chosen at issuance
  (`read-only` / `read-write` / `destructive`), and is accepted on the scoped
  data surface only — never on the instance, capability or realtime surfaces.
  See [`docs/mcp.md`](mcp.md).

## 5. Request signing (core → plugin)

Every core→plugin call is HMAC-SHA256-signed with the plugin secret over the
canonical string of `external-signing.ts` (method, path, unix-ms timestamp,
nonce, raw body), carried in `x-mk-signature` / `x-mk-timestamp` /
`x-mk-nonce`. Receivers must reject stale timestamps (±5 min) and replayed
nonces. The SDK webhook/render helpers do this by default.

## 6. API surfaces (plugin → core)

- **Scoped surface** — mirrors what the SPA can do: CRUD within one scope,
  accepted tokens: delegated, background-scoped. Every call passes the normal
  guard/scope stack; the permission matrix additionally requires the matching
  `<ownerPluginId>:read|write` grant.
- **Instance surface** — differently shaped: aggregates/series/breakdowns
  across scopes, read-only, requires `instance:<pluginId>:read`. Full
  cross-scope CRUD is deliberately absent; bulk data travels via exchange.

## 7. Server-driven UI

The core calls `POST <baseUrl>/mk/render` with `{ screen, params, context }`
and renders the returned `UiScreen`. User actions post to `/mk/action`; the
response is a new screen or commands (`toast`, `navigate`, `refresh`) executed
with the core's own surfaces. Budgets and degradation (decision #8): own screen
~5 s → error card; widgets/slots ~800 ms → silently dropped; circuit breaker
3 misses → 60 s pause → probe (`/mk/health`).

**Dependent form fields (contract 1.2).** A field marked `reloadOnChange: true`
makes the core re-render the screen as soon as its value changes, passing the
form's current values back as `form` on the render request. That is how a
screen shows different fields depending on an earlier answer — a source
selector whose credentials differ per source, for instance — without the
plugin shipping any client-side logic. The values are the user's _unsaved_
input: render from them, do not persist them.

**A form submits what it SHOWS**, not only what the user touched: the value bag
is seeded from the rendered tree on every render. So a value the plugin puts in
a field comes back on submit even if nobody touched it — which is what makes a
suggested default a default rather than a decoration. A typed `password`
survives a redraw, since a plugin cannot echo a secret back.

**Layout hint (contract 1.3).** A field may ask for `width: 'half'`; two of
them share a row on a wide screen and stack on a narrow one. It is a hint, not
a layout language — the core owns the design.

**Two ways to page, and the choice is about size (contract 1.7 / 1.8).**

- _The core pages it_ — `filterable` + `pageSize` on a table. Every row
  crosses the proxy once and the search is instant. Right for a set a browser
  can hold: a currency table, a device list.
- _The plugin pages it_ — `paging: { page, pageSize, total?, hasMore? }` on a
  table or a list. The plugin returns ONE page; the core draws Back/Next and
  asks for the next by re-rendering the screen with the page number as a
  render param. `total` is optional on purpose: counting ten million rows to
  render twenty is the cost this mode exists to avoid, so a plugin that cannot
  count cheaply sets `hasMore` instead.

**Sorting follows the same rule (contract 1.9).** A column marked `sortable`
becomes a header control. Whoever holds the rows sorts them: the core sorts
what it was given (numbers as numbers), and a plugin-paged table receives the
sort as render params — `sort` and `direction` — and returns the page ordered,
because sorting the twenty rows on screen would sort the wrong thing. Turning
a sort resets to the first page. A table row may carry its own action too,
with the same shape a list item has.

Handing a million rows to the core is not a slow version of the first mode, it
is the wrong mode. `mk-plugin-notes` shows the second, `mk-plugin-rates` the
first.

**A table can be handed over whole (contract 1.7).** `filterable` and
`pageSize` let the CORE search and page the rows a plugin returns: instant, no
round trip per keystroke, and one implementation instead of a hand-rolled
filter per plugin. Both are hints — an older core renders the plain table.

**`time` field (contract 1.7)** for a schedule a person sets rather than
computes. "Every N hours" from an unstated starting point is not something
anyone can plan around.

**A field explains itself (contract 1.6).** `hintKey` renders one line under
the control, tied to it with `aria-describedby`. A placeholder is not an
explanation — it vanishes the moment someone types — and an explanation put
beside the form reads as orphan text about nothing in particular.

**A row may carry its own action (contract 1.5).** A list item takes an
`action` — a label, an action, an optional `confirm` — rendered as a button on
the row. Without it a destructive action had to be the item's `onClick`, which
turns reading a list into a minefield. A declared `confirm` (on a button or a
row action) is honoured by the core's own dialog; it is not decorative.

**Buttons carry the form too.** A `button` node posts the screen's current form
values alongside its action, exactly as a submit does, so a plugin can offer
"test this connection" next to the fields being tested instead of demanding
they be saved first. Returning `{ screen }` from that action redraws with
whatever the plugin puts in the field values — which is how an unsaved
credential survives the round trip. `mk-plugin-bambu` uses both: its check
reads the Home Assistant entity list and turns six typed entity ids into six
dropdowns.

**A plugin's own invalidation reaches the open screen.** `POST
/api/external/notify-changed` relays into the caller's scope room and the
screen refetches — unless the user has typed something into it since it
rendered, in which case the change waits rather than wiping half-filled input.

## 7bis. Live plugin set

Approve, enable, disable and uninstall broadcast a `data:changed` naming the
`external` plugin. Clients re-read the shell projection and mount or unmount
the plugin's nav entries, routes, widgets and slot contributions **live** — a
newly connected plugin appears without a page reload, and a disabled one
disappears the same way, on every open tab.

### Who is calling (contract 1.4)

A call context carries `userRef`: an opaque, stable, per-plugin reference to
the calling user. Absent on background calls, which have no user.

- **present in a single-user instance too.** Without the multiuser overlay
  there are no user ids, but there is exactly one person; the core supplies a
  constant identity for them, so a per-person plugin works on the default
  deployment. Background work still gets nothing — a scheduled job is not a
  person, whatever context it runs in;
- **stable** — the same person is the same string forever, so a plugin may
  store data under it (the salt behind it is never rotated);
- **per-plugin** — two plugins holding references for the same person cannot
  tell that they do;
- **one-way** — a reference never yields a user id, a name or an address.

That is enough to separate "mine" from "everyone's" inside a shared scope —
my bookings, my hours — without a third-party container learning who anyone
is. It is **not** an authorization input: what a caller may do is decided by
the core from the delegated token, never by a plugin comparing references.

## 8. Events (core → plugin)

Signed webhooks to `/mk/events` from a persistent outbox: at-least-once within
the retention window, exponential backoff, dead-letter visible to the admin.
Payload is `ExternalWebhookEvent` — id, type, `schemaVersion`, `scopeId`,
ORef, changed field **names**, **never data**. Handlers must be idempotent by
`eventId`. Lifecycle events: `core.scope-deleted`, `core.plugin-enabled`,
`core.plugin-disabled`. **Domain events** (facts about core data an external
plugin may subscribe to, their permission and scope rules, and the delivery
guarantees) have their own normative contract:
[`external-events.md`](external-events.md).

`core.scope-deleted` is emitted **after** the deleting transaction commits, so a
rollback can never tell a subscriber to destroy data that still exists. The
announcement is therefore lost if the core dies in the window between the commit
and the outbox row; the fix for that is the outbox row written inside the
deleting transaction, which needs a transaction handle the inter-plugin bus does
not carry yet (#189). It is in either case the only way a third-party container
can ever be told: the core cannot reach into its storage.

## 9. Realtime (plugin → client)

Invalidation only: `POST /api/external/notify-changed { screen, scopeId? }`.
The core relays over its scoped `data-changed` socket; clients viewing that
screen refetch the render. The push channel never carries content.

## 10. Exchange (`.mkx`)

Streamed hooks `/mk/exchange/export` (returns an opaque blob) and
`/mk/exchange/import` (receives one). The blob must be **self-contained** and
**versioned by the plugin**; `import` must fail gracefully on an incompatible
version. Importing an `.mkx` containing data of an uninstalled plugin warns
the admin immediately; blocks are deferred (applied on install) or discarded.

## 11. Capabilities

Any plugin may offer capabilities (manifest-declared, id prefixed with its own
`pluginId.`). Consuming requires the `capability:<id>` grant. The core relays
opaque JSON between plugins and does **not** validate third-party↔third-party
contracts — that is the authors' responsibility. Calls into internal
capabilities pass the permission matrix.

## 12. Agent tools

Declared in the manifest (`descriptionKey`s, tiers); execution proxied to
`/mk/tool` (~10 s budget). External `WRITE`/`DESTRUCTIVE` tools always gate on
end-user confirmation — the auto-run relaxation available to internal tools
does not exist for external ones. Tool results are wrapped as untrusted data
for the model. A plugin's tools join the assistant only after a separate
per-plugin consent (default OFF); calls are audit-logged.

The plugin's own locale bundles are registered with the backend resolver under
`ext.<pluginId>`, so text the CORE assembles for the model — a tool's
description, its parameter descriptions, the plugin's label — is resolved to
the caller's language. The frontend merges the same bundles separately, which
is why a missing registration showed a correct settings screen and handed the
model the literal key.

A tool registered at runtime — which every external tool is — also gets its
`AgentToolConfig` row seeded on registration. The chat only offers tools that
have one, and the boot-time seed has long since run by the time an admin
approves a plugin: without this the plugin was installed, consented to,
registered and still invisible in the assistant.

## 13. Installation

The admin runs the container (compose fragment published by the plugin),
generates a one-time install token in the core UI, sets it in the plugin's env
(`MK_INSTALL_TOKEN` + `MK_CORE_URL` by convention); the plugin POSTs
`/api/external/register` on boot. The core validates the manifest, shows the
consent card, and on approval issues the plugin secret. Manual URL+secret
registration is the fallback. Uninstall revokes all tokens first; the optional
`purgeHook` adds an "also erase plugin data" choice. Disable deletes nothing.

---

## 14. Author's guide (SDK)

`@makekeeper/plugin-sdk` (Apache-2.0, `libs/plugin-sdk`) is the officially
supported way to write a plugin. It bakes the contract's _requirements_ in as
defaults rather than documenting them:

- `startPlugin({ manifest, handlers })` validates the manifest locally with the
  same validator the core runs (a bad key is a boot error with a path, not a
  remote rejection), serves the whole endpoint set, **verifies every signature
  before any handler runs**, and **dedupes webhook deliveries by `eventId`**.
- `CoreClient` picks the right token automatically: the short-lived delegated
  token that arrived with the current render/action/tool call — so the core
  sees the acting _user_ — falling back to the plugin's background token.
- The UI builders (`screen`, `paragraph`, `stat`, `table`, `form`, …) take i18n
  **key names**, not strings, so the natural way to write a screen is also the
  compliant one.

A language-agnostic path stays fully supported: the manifest schema, the
component vocabulary and the signing scheme are all in `plugin-contract`, and
`verifySignedRequest` is ~40 lines to reimplement.

### A container that lost its state

Pairing an id that is already installed is not refused: it hands that
installation to the container that proved the code — new secret, new address,
same permissions, same assistant consent, same data. That is how a plugin
comes home after its volume was dropped or its host moved, and the alternative
was uninstalling, which throws all three away.

It is a takeover, and the candidate card says so. A manifest that changed
still goes through the normal update diff on the next `register`, so nothing
widens its permissions by re-pairing.

Until it is re-paired, its screens report `unauthorized` — the container
answers and rejects the core's signature, which is a different thing from
being unreachable and has exactly one cure.

### Two ways in: pairing, or an install token

**Pairing (from the admin UI).** The admin clicks _Connect a plugin_, which
opens a **15-minute pairing window**. A container started with only
`MK_CORE_URL` — no token at all — announces itself, prints a four-digit
**pairing code** to its own log, and appears as a _candidate_ showing its
source IP, claimed identity and the permissions it will ask for. The admin
types the code; the candidate becomes an ordinary pending registration and the
usual permission-consent card follows.

Two separate questions, deliberately: **pairing** answers _"is this container
mine?"_, **consent** answers _"may it do this?"_.

Discovery is **convenience, not security**. Announcing is anonymous, so
everything a candidate says about itself is self-asserted — the UI labels it
so. What makes it credible is the code: being able to read that container's log
is what proves it is yours. Without that step an admin would be confirming a
row of text, and nothing would stop a rogue container calling itself `backup`,
asking for `instance:*:read` and hoping for a distracted click. Announces are
refused outside the window, the queue is bounded and rate-limited per source,
and a candidate claiming an already-installed id is shown as a conflict rather
than silently taking it over.

Order does not matter: a container started before the window is open keeps
announcing (every ~20 s), so opening the window later brings it up within
seconds and no restart is ever needed. While the window is shut the admin
surface says how many containers are knocking — a bare count, because an
announce is unauthenticated and nothing it supplied may reach an admin's
screen.

**Install token (headless).** Unchanged, and still the right path for Ansible
or prebuilt stacks where nobody is watching the UI: generate a one-time token,
put it in the container's env, and it registers on boot.

The SDK picks the path by itself — stored secret, else install token, else
discovery — and a container left unpaired keeps running instead of exiting, so
opening the window later needs no restart.

### Running an example in a container

The examples live inside this repository and import the SDK through its path
aliases, so their image is built from the repo root with a bundling stage —
[`examples/Dockerfile`](../examples/Dockerfile) serves all of them:

```bash
docker build -f examples/Dockerfile --build-arg PLUGIN=mk-plugin-bambu \
             -t mk-plugin-bambu .
```

A third-party plugin in its own repository needs none of that: it would
`npm i @makekeeper/plugin-sdk` and ship an ordinary Dockerfile.

Starting one is easiest through the launcher, which picks the pairing code
itself, passes it in via `MK_PAIRING_CODE`, and prints it **only after the
container is confirmed running** — on failure you get the error and the
container's log, and no code:

```bash
./examples/run-plugin.sh examples/mk-plugin-bambu
```

Leave `--core` off: the launcher resolves it from where the core actually
stands (#256). On a packaged stack the core is a container on
`makekeeper_default` and the URL is `http://app:3000`; in this repo's dev stack
it is `nx serve` outside every docker network, reached at
`http://host.docker.internal:3000`. `http://localhost:3000` is the container's
own loopback and is right in neither case.

The plugin's data lives in a named docker volume (`<name>-data`), not in a
host folder: it is the container's business, `/tmp` is swept on reboot on most
systems, and a bind mount drags host uid/gid into it for no benefit. Removing
that volume discards the plugin's pairing along with its data — it comes back
as a new candidate needing a fresh code.

The launcher picks the port: an existing container keeps the one it already
runs on — the core stored that address at pairing and a plugin that returns on
a different one is a plugin it cannot reach — and a new one gets a free port,
so starting a second and a third plugin needs no bookkeeping. `--port` still
wins when it matters.

By hand, run it in the foreground and every message including the code lands
in your terminal. `docker run -d` prints a container id instead — that is what
`-d` means — and the code goes to the log, where the banner repeats every
minute so the tail always holds the current one. Do not wrap that in a
`grep` loop: it hides the startup failures you most need to see.

### Development loop

Run the core with a fixed, reusable install token so a plugin under development
re-registers on every restart without a UI round-trip:

```bash
MK_EXTERNAL_DEV=1 MK_EXTERNAL_DEV_TOKEN=dev-token nx serve backend
MK_CORE_URL=http://localhost:3000 MK_INSTALL_TOKEN=dev-token npm start   # plugin
```

Dev mode is gated on the explicit `MK_EXTERNAL_DEV` flag, never on `NODE_ENV`:
a production image must not acquire a standing install credential because one
variable was forgotten.

### Reference plugins

An overview of all nine, with a mechanism-to-plugin index, lives in
[`examples/README.md`](../examples/README.md).

Each example is a real (small) feature rather than a hello-world, and each
demonstrates a different part of this document:

| Example                                                                                               | Illustrates                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`mk-plugin-notes`](../examples/mk-plugin-notes)                                                      | `userRef` (§ "Who is calling"): notes private to a person inside a shared workspace, and a slot contribution that receives the host's ORef as render params. Asks for no permissions at all.                                                                                                                             |
| [`mk-plugin-telegram`](../examples/mk-plugin-telegram)                                                | Notifications that belong to a person: a public unsigned route a chat client calls (the unsubscribe link), a capability other plugins call, and a `WRITE` tool the runtime gates.                                                                                                                                        |
| [`mk-plugin-shelf`](../examples/mk-plugin-shelf)                                                      | The whole shape end to end: own storage, a screen with a form, a dashboard widget, an agent tool (§12), an event subscription (§8), `.mkx` participation (§10), the purge hook (§13).                                                                                                                                    |
| [`mk-plugin-loans`](../examples/mk-plugin-loans)                                                      | `scopeModel: 'per-scope'` (§2/§5): partitioning the plugin's OWN storage by the opaque `scopeId`, one background token per scope, and cleaning up on `core.scope-deleted`.                                                                                                                                               |
| [`mk-plugin-digest`](../examples/mk-plugin-digest)                                                    | The instance surface (§6) driven by the plugin's own scheduler with a `background-instance` token — and rendering from a stored snapshot to stay inside the budgets (§7).                                                                                                                                                |
| [`mk-plugin-rates`](../examples/mk-plugin-rates) + [`mk-plugin-budget`](../examples/mk-plugin-budget) | The capability pair (§11): one plugin offers `rates.convert` under its own prefix, the other consumes it with a declared `capability:` grant and degrades cleanly when it is absent.                                                                                                                                     |
| [`mk-plugin-bambu`](../examples/mk-plugin-bambu)                                                      | Integration with a real machine: a Bambu Lab printer over its own LAN MQTT interface (a ~150-line hand-rolled client — a plugin owns its protocol problems) or through Home Assistant. Asks for **no permissions at all**: it brings data in and takes none out.                                                         |
| [`mk-plugin-climate`](../examples/mk-plugin-climate)                                                  | A plugin written to be **installed**: workshop temperature/humidity monitoring, integrating with whatever sensor stack the workshop has. Shows the scoped surface used for real (its storage picker comes from the core's own `list_storages`), ORef links back to storages, and **plugin-owned public routes** (below). |

Their `AGENTS.md`/`CLAUDE.md` are meant to be copied into a new plugin repo:
they state the rules an AI agent must follow, most of which the core enforces
at install or render time.

### Icons

A plugin names its icon in the manifest and the shell resolves it against the
whole lucide set, lazily. Any lucide name works; an unknown one falls back to a
neutral box rather than rendering nothing.

### Settings screens

A plugin declares `settingsScreen` in its manifest and the shell offers it
inside the plugin's card in **Settings → External plugins**, expanded on
demand. That is where the admin already installs, approves and disables the
plugin; configuring it is the same errand. It is deliberately not a tab of the
Settings hub: one guest tab per plugin reads fine with one installed and
shreds the hub with five.

The screen also keeps a route of its own (`/x/<pluginId>/<screen>`), so a
plugin can send its user there with a `navigate` command. It is collapsed by
default in the card, because rendering it is a round trip to the plugin's
container.

That is where connection details belong. Environment variables are right for a
headless install (Ansible, a prebuilt stack), but anything a user is expected
to change — a device's address, an access code, an API token — should be
editable without editing a stack file and restarting a container.

For credentials the vocabulary has a `password` field (contract **1.1**),
rendered masked. Two conventions a plugin should follow, both demonstrated by
[`mk-plugin-bambu`](../examples/mk-plugin-bambu):

- **never render a stored secret back** — leave the field empty, say in its
  placeholder whether one is stored, and treat a blank submit as "keep it";
- **reconfigure live** — a saved setting should reconnect the plugin, not
  require a restart, or the settings screen has only moved the problem.

Worth stating plainly: a credential typed into a plugin's settings screen
travels browser → core → plugin over the signed channel, so **the core sees it
in transit**. That is inherent to server-driven UI and is the same trust the
admin extends by installing the plugin at all — but it should be known, not
discovered.

### Plugin-owned public routes

Core→plugin calls are HMAC-signed, but a plugin often needs to receive traffic
the core did not send: a sensor pushing a reading, a payment provider's
webhook, a CI callback. That party cannot produce the core's signature — the
key is shared with the CORE — so the SDK lets a plugin declare its own
**unsigned** routes and authenticate them itself:

```ts
startPlugin({
  manifest,
  handlers,
  publicRoutes: {
    '/ingest': async (req) => (req.query.get('token') === MY_TOKEN ? { status: 200, body: { ok: true } } : { status: 401, body: { error: 'bad-token' } }),
  },
});
```

The `/mk/` prefix is reserved for the contract and rejected at boot, so a
public route can never shadow a signed endpoint. Everything else about these
routes — authentication, rate limiting, payload validation — belongs to the
plugin, and the runtime deliberately does not guess: it hands over the method,
path, query, headers and raw body untouched.

For surfaces the buffered JSON shape cannot express — SSE streams, custom
response headers, non-JSON bodies — the SDK offers **raw routes**: the node
request/response pair handed over untouched, before any body buffering,
matched by path _prefix_ (`'/'` claims the whole non-`/mk` surface):

```ts
startPlugin({
  manifest,
  handlers,
  rawRoutes: { '/events': (req, res) => streamEvents(req, res) },
});
```

### Public paths (`publicPaths`, contract 1.10)

Public/raw routes are reachable on the plugin's own port — which a deployed
stack does not publish. To be reachable **through the instance's web origin**,
the manifest declares which path prefixes may be exposed:

```ts
manifest: {
  // '' = the whole (non-/mk) surface; entries are relative, no leading slash.
  publicPaths: ['webhook'],
}
```

The instance then proxies `https://<instance>/plugins/<pluginId>/<subpath>` to
the plugin for declared subpaths only; everything else — including the signed
`mk/*` surface, whatever is declared — answers 404. The `/plugins/` URL prefix
is reserved for this proxy. Adding a public path in an update is a
consent-requiring expansion, like a new permission. Requests arrive unsigned
and unauthenticated (the proxy strips nothing and adds nothing): the plugin
authenticates them itself, exactly as on its own port. Streaming responses
should carry `X-Accel-Buffering: no` and periodic SSE keepalive comments —
intermediary proxies buffer or reap quiet streams otherwise. The first-party
MCP plugin ([`plugins/mk-plugin-mcp`](../plugins/mk-plugin-mcp/README.md)) is
the reference consumer of both `rawRoutes` and `publicPaths`.

**Telling the admin what the address is for (`publicHintKey`, contract 1.12).**
An active plugin with any `publicPaths` gets its connection address —
`<instance-origin>/plugins/<pluginId>` — on its card in Settings → External
plugins, as a one-line copy-to-clipboard row. `publicHintKey` names an i18n key
in the plugin's **own** bundles rendered under it, which is how a plugin whose
whole product is an endpoint documents itself without shipping a settings
screen:

```ts
manifest: {
  publicPaths: [''],
  publicHintKey: 'mcp.setup', // resolved from manifest.i18n[locale]
}
```

How the proxy routes (#250): the production nginx asks the core's routing
oracle per plugin id (an `auth_request` sub-request, cached ~30 s) and then
streams directly to the plugin container; plugins the web container cannot
reach by container name (a published-port loopback base URL — the dev stack,
where the core is a process in the devcontainer rather than a container on the
plugin's network) are answered as `pipe` and travel
through the core's raw byte pipe at `/api/external/pub/…` instead. **Plan B,
documented but deliberately not built:** should `auth_request` prove limiting
(per-route auth semantics, streaming quirks), the fallback design is a
config-push wrapper — the core renders an nginx include listing the active
public-path upstreams and signals nginx to reload gracefully. It trades the
oracle's zero-reload dynamism for plain static configs, and nothing in the
manifest contract would change.

### Background credentials

A plugin holds its registration **secret** (identity) but needs **tokens**
(capabilities) to call the core outside a user request. It exchanges one for
the other at `POST /api/external/tokens`, which always returns a freshly minted
set — so a token can never outlive the grant state it was minted under. Which
tokens it gets follows the declared scope model: `instance` → one scoped token
for its bound scope; `per-scope` → one per scope; plus a single
`background-instance` token whenever an `instance:*` grant exists. The SDK does
this for you (`plugin.core.forScope(id)` / `.forInstance()`).

### Publishing checklist

- [ ] `en` bundle covers every key the manifest references (registration fails otherwise).
- [ ] Permissions are the narrowest set that works; any `instance:*` grant is justified in the README.
- [ ] Event handlers idempotent by `eventId`; `core.scope-deleted` handled if you store per-scope data.
- [ ] Exchange blob self-contained and self-versioned; `importBlob` refuses newer versions.
- [ ] Renders stay inside the budgets (§7); slow work runs in your own scheduler.
- [ ] A `compose.fragment.yml` is published for admins to paste.
