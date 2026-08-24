# External domain events — the normative contract

This document is the contract between the MakeKeeper core and **external
plugins** for domain events: what a plugin may hear, what an event promises,
and what a handler is required to do. It is the written form of the #189
design decisions; the machine-readable half (name constants, envelope types)
lives in `libs/plugin-contract/src/lib/external/external-events.ts`. Wire
mechanics shared with lifecycle events (signing, outbox, backoff, dead
letters) are in [`external-plugins.md`](external-plugins.md) §8.

## 1. Two vocabularies, deliberately

The core has two event mechanisms, and they are **not** the same feature:

- **Internal:** `PluginEventBusService` (backend-core) — a private,
  synchronous, awaited seam that lets one internal plugin write to another's
  models _through its owner_. Its names (`logistics.stock.adjust`, …) are
  commands inside one process, they change with the plugins that share them,
  and they are **never bridged outward**.
- **Public:** the domain-event catalogue in `external-events.ts`, delivered to
  external plugins over the signed outbox. Every name here is a **fact in the
  past tense** and a public interface: once shipped it is a promise to every
  third-party container that subscribed.

Nothing flows from the first vocabulary to the second automatically.
Publishing outward is always an explicit act by the plugin that owns the data,
at the exact point where the fact became final.

## 2. Names and ownership

- Grammar: `<ownerPluginId>.<entity>.<verb>`, past tense
  (`inventory.item.changed`, `logistics.order.received`).
- The **owning internal plugin** decides when the fact has happened and is the
  only publisher of its names. Idiom: prefer the domain fact
  (`order.received`); the `created`/`changed`/`deleted` triad is the fallback
  for plain data entities.
- **Growth rule:** a name enters the catalogue only for a concrete consumer
  scenario (an example plugin or a real third-party need) — never
  speculatively. Candidates without a consumer are recorded in §8 as _known,
  not promised_.
- `core.*` names (lifecycle: `core.scope-deleted`, `core.plugin-enabled`,
  `core.plugin-disabled`) are not domain events; they have no owning plugin
  and are exempt from the permission rule below.

## 3. Hearing is reading: the permission rule

Subscribing to an owner's event requires the owner's **read grant**:

> To hear `inventory.item.changed`, the plugin must hold `inventory:read`
> (or a grant that covers it).

`events: [...]` in the manifest is a declaration of intent only. The grant is
enforced twice:

- **At fan-out** — no outbox row is written for a subscriber whose current
  grants do not cover the owner's read permission.
- **At delivery** — the grant is re-checked before the POST, so revoking a
  permission also stops events already sitting in the queue.

An event body is metadata about the owner's data; hearing it without the
right to read the data would be a leak with a nicer name. That is the whole
rationale, and it is also why there is no separate `events:*` permission
grammar — the read grant _is_ the event grant.

## 4. Scope rule

- A **per-scope** plugin receives only events whose `scopeId` equals its
  bound scope.
- An **instance** plugin receives events of all scopes.
- An event with no scope goes to instance subscribers only.

The filter runs at the same fan-out point as the permission rule and is
derived from the registry's binding — there is nothing to declare in the
manifest, and nothing that can drift.

## 5. Delivery guarantees — and the usage model that makes them enough

The core promises exactly two things, and says two more out loud:

- **At-least-once, from publication.** Once an event is published (outbox
  rows written), it is retried with exponential backoff until acknowledged,
  dead-lettered visibly after the attempts run out, within the retention
  window. Duplicates are therefore normal.
- **No ordering.** A failed delivery backs off while later events go through;
  nothing promises that event N arrives before N+1.
- **Publication is best-effort after commit.** The domain write commits
  first; a crash in the window before the outbox rows are written loses the
  event. On a single-node deployment the window is milliseconds, and under
  the usage model below a lost event is a delay of synchronization, not data
  loss. (Upgrade path, should it ever be needed: writing the outbox rows
  inside the domain transaction — strictly strengthens this promise, breaks
  nothing.)
- **The envelope carries no data** (see §6) — deliberately.

The usage model that turns these weak promises into a safe system:

> **An event is an invitation to re-read, never a state transfer.** The
> handler takes `ref`, fetches the current state through the API surfaces
> with its own token, and acts on what it read — not on what the event said.

Under that model a duplicate is a harmless second re-read and reordering is
invisible. A handler that mutates its own state directly from an event (the
classic "decrement stock on event" bug) is wrong _by contract_: it will
decrement twice. Handlers must be **idempotent by `eventId`**; the SDK
provides in-process dedup and a check hook for persistent dedup.

## 6. The envelope

```jsonc
{
  "eventId": "…", // unique per fact; dedup key
  "type": "inventory.item.changed",
  "schemaVersion": 1, // EXTERNAL_EVENT_SCHEMA_VERSION
  "scopeId": "…", // '' when scopeless
  "ref": "mk://inventory/component/…", // canonical ORef, when one exists
  "changed": ["quantity"], // names of changed fields — never values
  "occurredAt": "2026-07-31T12:00:00.000Z",
}
```

- `changed` lists **field names only**. Values are absent by design: a value
  delivered without an ordering guarantee looks trustworthy and may already
  be stale — the envelope makes relying on one syntactically impossible.
- `ref` is a canonical ORef (`object-ref.ts` grammar). For `*.deleted` events
  it is already dangling by delivery time; the event is the only trace.

## 7. Evolution

- **Additive changes** (a new optional envelope field, a new name in the
  catalogue) bump nothing. Subscribers ignore what they do not know.
- **An incompatible change of an event's meaning is a new name**, plus a
  deprecation note on the old one in `external-events.ts`. The old name keeps
  firing until its removal is announced; manifests subscribe by name, so old
  containers simply keep hearing the old event.
- **`schemaVersion` is the emergency hatch for the envelope itself** — an
  incompatible change of the shared shape (all events at once, e.g. a
  security fix of the envelope). A bump goes through the same deprecation
  ritual as a name removal. It is never the cheap way to break one event.
- **Subscribers must reject an unknown `schemaVersion`** — refuse the
  delivery (non-2xx), so the core retries and eventually dead-letters it
  where the admin can see it. The SDK enforces this; a plugin that
  half-parses an unknown envelope is broken by contract. This check is what
  keeps the hatch honest: a break is loud, never a silent misparse. One
  stated tolerance: an envelope with **no** `schemaVersion` field comes from
  a pre-versioning core, which by definition still speaks version 1 — a
  future version can never omit the field, so absence is not "unknown".

## 8. Catalogue v1 — and the candidates deliberately left out

Shipped (see `external-events.ts` for the authoritative list):

| Name                       | Fact                              | `ref`                                      |
| -------------------------- | --------------------------------- | ------------------------------------------ |
| `inventory.item.created`   | an item came into existence       | `mk://inventory/component/<id>`            |
| `inventory.item.changed`   | item fields changed (`changed[]`) | `mk://inventory/component/<id>`            |
| `inventory.item.deleted`   | an item was deleted               | `mk://inventory/component/<id>` (dangling) |
| `logistics.order.received` | an order's arrival was recorded   | `mk://logistics/order/<id>`                |
| `projects.project.closed`  | a project was closed              | `mk://projects/project/<id>`               |

The inventory ref entity type is `component` — the historical ORef name the
resolvers answer to — while the event name speaks the product noun "item".
There are deliberately **no per-event payload interfaces**: every event is the
shared envelope (§6) and nothing more, so the catalogue exports names, not
shapes — one less thing to promise.

### Known, not promised

The full domain walk (#195): facts a subscriber could plausibly want, parked
until a concrete consumer exists (the growth rule, §2). Each row names the
consumer scenario that would justify shipping it — wanting one of these is an
issue against the core naming such a scenario, not a reason to poll. A
candidate deliberately absent even here was judged noise (per-keystroke
drafts, view/navigation activity, anything the owner treats as private
bookkeeping).

| Candidate                                 | Fact                                             | The consumer that would justify it                                                                                                           |
| ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory.stock.low`                     | an item crossed its min-stock threshold downward | a notifier or auto-purchasing agent; today it must hear every `item.changed` and compare — the threshold fact is the owner's to declare      |
| `logistics.order.placed`                  | a purchase was recorded as ordered               | a spend tracker / budget plugin reacting to commitments, not arrivals                                                                        |
| `logistics.order.cancelled`               | an in-flight order was cancelled or deleted      | the same budget scenario; today deletion is silent                                                                                           |
| `logistics.return.opened`                 | a return request was opened                      | a notifier tracking money coming back                                                                                                        |
| `projects.project.created`                | a project came into existence                    | a time-tracking or planning companion bootstrapping its own record                                                                           |
| `projects.project.reopened`               | a closed project left the terminal status        | the same companion un-archiving; the inverse of `closed`                                                                                     |
| `projects.task.completed`                 | a task flipped to done                           | a standup-digest bot; per-task noise for anything else                                                                                       |
| `projects.component.linked` / `.unlinked` | the BOM changed                                  | a costing plugin re-pricing a build (note: internally these exist as commands on the private bus — the public fact would be a separate name) |
| `storages.cell.changed`                   | a cell's content moved                           | a shelf-mapping companion (`mk-plugin-shelf`) reacting instead of re-rendering on demand                                                     |
| `tags.tag.applied` / `.removed`           | tagging changed                                  | no scenario named yet; parked as the weakest candidate                                                                                       |

Two structural notes from the walk. First, `storages` and `tags` would be new
OWNER plugins in the catalogue — nothing about the design limits it to the
first three domains; the permission rule extends verbatim (`storages:read`,
`tags:read`). Second, none of the candidates need a new envelope field —
`ref` + `changed[]` covered every scenario examined, which is a good sign the
envelope is the right size.
