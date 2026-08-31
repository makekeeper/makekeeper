# Example external plugins

Nine containers that talk to a MakeKeeper core over HTTP. None of them ships a
line of frontend code: each returns declarative screens from a fixed
vocabulary and the core renders them with its own components.

They exist to be **read and run**, not only read. Between them they exercise
every mechanism in [`docs/external-plugins.md`](../docs/external-plugins.md) —
so when you are about to write a plugin, the question is usually "which of
these already does the thing I need" rather than "how does this work".

```bash
./examples/run-plugin.sh examples/mk-plugin-shelf
```

The launcher builds the image, picks a port (a plugin that already runs keeps
its own), starts the container, and prints the pairing code only once the
container is confirmed up. Data lives in a named docker volume, not in `/tmp`.
See [`run-plugin.sh`](./run-plugin.sh) for the rest.

**Which network the container joins** (#250, #256): always `makekeeper_default`
— joined when the packaged app stack or the devcontainer stack has created it,
created by the launcher otherwise. What differs is where the core stands. When
the core is a container on that network (`app`), the plugin talks to
`http://app:3000` and the core and the `/plugins/…` public-path proxy reach the
plugin back by container name. When it isn't — the repo's dev stack, where the
core is `nx serve` in the devcontainer — the plugin talks to
`http://host.docker.internal:3000`, its port is published, and it registers a
loopback base URL, so public paths ride the core's byte pipe. Both ends are
overridable: `--network <net>` / `--core <url>`.

There is deliberately **no fallback to the host namespace**: `--network=host`
puts a third-party image beside the core and everything else on the machine,
the backend's node inspector on loopback included. It is still
accepted if you pass it explicitly; it is never chosen for you.

## What each one is for

| Plugin | What it does | What it shows |
|---|---|---|
| [**shelf**](./mk-plugin-shelf) | Shelf life of materials that expire — resin, glue, cells. Inventory knows *how much*; this knows *when it goes bad*. | The whole contract end to end in ~250 lines: own storage, a screen with a form, a dashboard widget, an agent tool, an event subscription, `.mkx` export/import, a purge hook. Start here. |
| [**loans**](./mk-plugin-loans) | Who borrowed what. | `scopeModel: 'per-scope'`: the core hands an opaque `scopeId` on every call and one background token per scope, and the plugin partitions its own storage by it. The core's scope policy stops at the core — it cannot reach into a third-party database, which is exactly what the declaration makes explicit. |
| [**digest**](./mk-plugin-digest) | A weekly summary across the whole instance. | The instance surface: `instance:inventory:read`, its own scheduler collecting cross-scope aggregates with a `background-instance` token, and screens that render the stored snapshot rather than running a cross-scope query while somebody waits. |
| [**rates**](./mk-plugin-rates) | Exchange rates, kept fresh, offered to everyone else. | Offering a **capability** (`rates.convert`) other plugins consume; a settings screen with a schedule (daily at a chosen time) and a base currency picked from what the API actually publishes; a table the core filters, sorts and pages. Also a worked lesson in reading an API version properly. |
| [**budget**](./mk-plugin-budget) | A project's spend, in one currency. | **Consuming** another third-party plugin's capability through the core relay (`capability:rates.convert`) — and degrading to plain amounts when the offerer is absent, because `null` means "the feature does not exist". |
| [**climate**](./mk-plugin-climate) | Temperature and humidity where materials are stored, against what those materials need. | Two ways for readings to arrive: pulled from Home Assistant, or **pushed** into the plugin's own unsigned route by anything at all (a sensor, a shell loop). Plus `storages:read` to know where things live, and a purge hook. |
| [**bambu**](./mk-plugin-bambu) | A Bambu Lab printer's live state and print log. | Two interchangeable sources (the printer's own MQTT, or Home Assistant) chosen in the UI; a settings screen with masked credentials and fields that appear according to the source; a widget; a `READ` tool. Asks for **no permissions at all**. |
| [**notes**](./mk-plugin-notes) | Private notes on any object — an item, a project, a shelf. | The opaque `userRef`: separating *my* notes from *everyone's* inside one shared workspace, without learning who anyone is. Also a slot contribution that receives the host's ORef, plugin-side paging and sorting, row actions with confirmation, and editing in place. |
| [**telegram**](./mk-plugin-telegram) | The core's notifications in your own chat. | A **delivery channel** (`deliveryChannel` in the manifest): the core decides who hears what and hands over a message already written in the reader's language; this plugin formats and sends it, throwing when it cannot. Also a public unsigned route a chat client calls (the unsubscribe link) and a `WRITE` tool the runtime gates. |

## Mechanism → plugin

| Mechanism | Where to look |
|---|---|
| Own storage, screens, widget, tool, events, exchange, purge | shelf |
| `scopeModel: 'per-scope'` and `core.scope-deleted` | loans, notes, telegram |
| Being a delivery channel for notifications | telegram |
| Instance-wide reads (`instance:*`) and a background scheduler | digest |
| Offering a capability | rates (`rates.convert`) |
| Consuming one, and surviving its absence | budget |
| Two plugins talking to each other | budget → rates |
| Settings screens, masked secrets, fields that follow an earlier answer | bambu, telegram, rates |
| Outbound integrations behind a `sources/` seam | bambu, climate, rates, telegram |
| A public, unsigned route | climate (a sensor pushes readings), telegram (an unsubscribe link a chat client opens) |
| `userRef` — telling people apart without learning who they are | notes, telegram |
| A slot contribution that knows the object it sits beside | notes (`inventory.form.aside`) |
| Core-side table filter, sort and pages | rates |
| Plugin-side paging and sorting (for data the browser must not hold) | notes |
| A `WRITE` tool and its confirmation gate | telegram |
| An ORef rendered as an in-app link | notes, shelf |

## What every one of them obeys

These are not style rules; the core enforces most of them at install or at
render time, and the rest are what the examples are trying to teach.

- **No text literals.** Every visible string is an i18n key present in the
  manifest's `en` bundle. The sanitizer drops a node whose text is not a key
  reference, so a literal renders as nothing.
- **The narrowest permissions.** Five of the nine ask for none at all. Every
  entry shows on the admin's consent screen, and `instance:*` is flagged as
  elevated.
- **Slow work off the render path.** A screen has ~5 seconds and a widget
  ~800 ms; three misses open a circuit breaker. Fetch on your own schedule,
  render from your own state.
- **Serve stale rather than nothing.** A rate a few hours old still converts;
  an exception takes out the whole card. Say how old it is instead of
  pretending.
- **Idempotent event handlers.** Delivery is at-least-once and the process
  restarts.
- **`core.scope-deleted` is handled** by anything storing per-scope data: the
  core cannot clean what it cannot see.
- **Secrets are never rendered back.** A password field shows empty, says
  whether one is stored, and a blank submit keeps it.
- **Tests cover the part that guesses.** Name matching, discovery, parsing,
  sorting, privacy rules: `npm test` runs them with `node --test` and no
  dependencies. Four plugins have them — bambu, notes, rates, telegram — and
  those are exactly the four that guess at something. The rest do not, yet.

## Writing your own

Copy [`mk-plugin-shelf`](./mk-plugin-shelf) and the `CLAUDE.md` / `AGENTS.md`
next to it — those are the operating manual for an AI agent working in a
third-party plugin repository, and they state the same rules in checkable
form. [`docs/external-plugins.md`](../docs/external-plugins.md) is the
normative contract; the examples are what it looks like when followed.
