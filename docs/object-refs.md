# Object References (ORef) — one way to name any object

An **ORef** is a single URI-shaped string that identifies any object in the system
by its owning plugin, its type, its id, and (optionally) a sub-locator. It exists so
the same object is referenced **one** way across every layer — page context → AI
chat, agent-tool inputs/outputs, and in-app links — instead of the ad-hoc encodings
that let ids leak untyped between plugins (issue #16, generalizing the grid-address
fix of #15).

```
mk://<pluginId>/<entityType>/<entityId>[#<fragment>]
```

| Part | Rule |
|---|---|
| `mk://` | Fixed scheme — self-delimiting, linkifiable, URL-encodable. The legacy `diy://` scheme (pre-MakeKeeper rename, #80) is still accepted by `parseObjectRef`/`resolveEntityId`/`extractObjectRefs` for refs persisted or exported before the rename; `formatObjectRef` only ever emits `mk://`. |
| `pluginId` | Lowercase kebab; MUST equal a registered `PluginManifest.id`. Encodes ownership. |
| `entityType` | Lowercase kebab type owned by that plugin. |
| `entityId` | The Prisma `@id` **verbatim** (percent-encoded when it contains a delimiter). Never a name, never composite. |
| `#fragment` | Optional, entity-type-owned sub-locator. Today only `storages/storage` defines one: a grid-cell address per [`grid-address.ts`](../libs/plugin-contract/src/lib/grid-address.ts). |

### Entity-type registry

| ORef | Prisma model | Page context (B) | Clickable link (C) | Backend resolver (D) |
|---|---|:--:|:--:|:--:|
| `mk://projects/project/<id>` | `Project` | ✅ | ✅ | ✅ |
| `mk://projects/task/<id>` | `Task` | ✅ | —¹ | ✅ |
| `mk://projects/project-group/<id>` | `ProjectGroup` | ✅ | ✅ | ✅ |
| `mk://inventory/component/<id>` | `Component` | ✅ | ✅ | ✅ |
| `mk://storages/storage/<id>[#B1]` | `Storage` (+ cell) | ✅ | ✅ | ✅ |
| `mk://logistics/order/<id>` | `Order` | —² | —² | ✅ |
| `mk://tags/tag/<id>` | `Tag` | ✅³ | ✅ | ✅ |
| `mk://chat/session/<id>` | `AIChatSession` | — | — | — |

¹ A task route needs its project id too, which a task ORef doesn't carry, so a task
ref resolves (name + project breadcrumb) but is not a link. ² Logistics has no
single-order detail screen, so no page-context ref and no route — only a resolver.
³ The `/tags` page publishes the selected tag as its page-context ref; its
`refToRoute` links to `/tags?tag=<id>` (#60). `chat/session` is grammar-only (no
screen references a session as an object).

## The single implementation

`format` / `parse` / guards live **only** in
[`libs/plugin-contract/src/lib/object-ref.ts`](../libs/plugin-contract/src/lib/object-ref.ts)
(spec alongside). No layer regexes an ORef by hand.

```ts
import {
  formatObjectRef, parseObjectRef, isObjectRef, resolveEntityId,
} from '@makekeeper/plugin-contract';

formatObjectRef({ pluginId: 'storages', entityType: 'storage', entityId: 's1', fragment: 'B1' });
// → "mk://storages/storage/s1#B1"
parseObjectRef('mk://storages/storage/s1#B1');
// → { pluginId: 'storages', entityType: 'storage', entityId: 's1', fragment: 'B1' }
```

- **Canonical bijection.** `parse(format(x))` round-trips; any non-minimal spelling
  (redundant `%41` for `A`, empty parts, a trailing bare `#`) is rejected with `null`.
- **`resolveEntityId(input, { pluginId, entityType })`** — accept a raw id **or** an
  ORef where a tool expects an object: a bare (non-`mk://`) string passes through as
  a raw id; a `mk://` string must be a valid ORef of exactly the expected
  plugin/type, else `null` (→ the tool raises an ownership error instead of a silent
  wrong lookup). Raw ids keep working everywhere.

## Where ORefs flow

- **Page context (frontend → agent).** A view publishes its precise selection as
  canonical ORef(s) via `setPageContextRefs([...])` (cleared on unmount); the shell
  reads them into `PageContext.refs`, and the chat backend renders them in the system
  prompt. The human `summary` stays; refs are its machine-parseable counterpart.
- **Agent tool I/O.** Tool inputs accept an ORef wherever a raw id is accepted
  (`resolveEntityId` → ownership check → id). Tool outputs carry a canonical `ref`
  field so the agent can pass a result straight back into another tool.
- **`resolve_object_ref` tool.** A generic READ tool: hand it any ORef and get
  `{ ref, exists, displayName, breadcrumb? }`, resolved server-side by the owning
  plugin.
- **Clickable replies.** The markdown renderer turns a `mk://…` in an assistant
  reply (bare or as a markdown-link target) into a vue-router link via
  `resolveObjectRefRoute`, falling back to plain text when unresolvable.

## Resolver recipe — for a plugin that owns referenceable entities

**Frontend — make its refs navigable** (in the plugin's `frontend/index.ts`
`registerPlugin({ … })`):

```ts
refToRoute: (ref) =>
  ref.entityType === 'project' ? { path: `/projects/${ref.entityId}` } : null,
```

**Backend — resolve its refs to a name + breadcrumb** (in the plugin module's
`onModuleInit`, using the plugin's own service):

```ts
this.agentRegistry.registerObjectRefResolver('projects', 'project', async (ref) => {
  const project = await this.projectsService.findOne(ref.entityId);
  return project ? { displayName: project.title } : null; // null ⇒ id unknown
});
```

**Frontend — publish the current selection** (in the detail/form view):

```ts
const pageContextRefs = computed<string[] | null>(() => {
  const ref = formatObjectRef({ pluginId: 'projects', entityType: 'project', entityId: projectId });
  return ref ? [ref] : null;
});
watch(pageContextRefs, (refs) => setPageContextRefs(refs), { immediate: true });
onUnmounted(() => setPageContextRefs(null));
```

## Rules

- One implementation of `format`/`parse` — never hand-roll an ORef regex.
- The `entityId` is the Prisma id **verbatim**; never a name, never composite.
- A fragment's grammar is owned by its entity type; reuse the type's existing parser
  (the cell fragment reuses `formatCellAddress`/`parseCellAddress`).
- Stored data holds only the ORef; the **route is derived** (frontend `refToRoute`),
  never stored — routes can change without breaking references.
