# `@makekeeper/plugin-contract`

The **framework-agnostic contract** every plugin is built against. It contains
only types and one pure helper — no NestJS, no Vue, no runtime dependencies — so
it can be imported safely from the backend, the frontend, and the other core
libraries alike.

Think of it as the *interface* between a plugin and the two app shells: a plugin
declares its identity and its agent tools in terms of these types, and both
`@makekeeper/backend-core` and `@makekeeper/frontend-core` consume them.

- **Path:** `libs/plugin-contract`
- **Import:** `@makekeeper/plugin-contract`
- **Depends on:** nothing
- **Depended on by:** `backend-core`, `frontend-core`, every `plugin-<id>`

---

## What lives here

| File | Exports |
|---|---|
| `src/lib/manifest.ts` | Plugin descriptor types |
| `src/lib/agent-types.ts` | Agent capability (tool) types + `withPlugin` |

Everything is re-exported from `src/index.ts`, so consumers only ever import
from `@makekeeper/plugin-contract`.

---

## Plugin descriptor (`manifest.ts`)

The manifest is a plugin's single source of truth for identity. **All
user-facing text is referenced by i18n key, never as a literal.**

### `PluginManifest`

```ts
interface PluginManifest {
  id: string;              // stable machine id; also the i18n namespace
  nameKey: string;         // i18n key → display name  (e.g. 'plugins.inventory.name')
  descriptionKey: string;  // i18n key → description
  version: string;
  icon: string;            // Lucide icon name (resolved to a component in the shell)
  navigation: PluginNavItem[];
  settings?: PluginSettingsSchema; // only if the plugin has its OWN settings
}
```

### `PluginNavItem` & `PluginNavSection`

One sidebar entry. `section` decides where it renders in `App.vue`:

```ts
type PluginNavSection = 'main' | 'system';   // 'main' = primary stack, 'system' = pinned bottom

interface PluginNavItem {
  path: string;       // router path
  titleKey: string;   // i18n key → sidebar label
  icon: string;       // Lucide icon name
  section?: PluginNavSection; // defaults to 'main'
}
```

### `PluginSettingsSchema` & `PluginSettingField`

The declarative schema for a plugin's **own** settings (distinct from the agent
capability permissions). A plugin without settings simply omits `settings` from
its manifest.

```ts
type PluginSettingFieldType = 'string' | 'number' | 'boolean' | 'secret' | 'select';

interface PluginSettingField {
  key: string;
  labelKey: string;                 // i18n key
  type: PluginSettingFieldType;
  required?: boolean;
  descriptionKey?: string;          // i18n key for helper text
  options?: { value: string; labelKey: string }[]; // for 'select'
}

interface PluginSettingsSchema {
  route: string;      // e.g. '/settings/inventory'
  titleKey: string;   // i18n key
  fields: PluginSettingField[];
}
```

> Values behind `secret` fields are read/written through the settings/config
> service, never `process.env` directly (CLAUDE.md §5.2).

### `PluginLocaleMessages`

Shape of a plugin's locale bundle, e.g. `{ en: {...}, ru: {...} }`. Merged into
the app's i18n by [`frontend-core`](../frontend-core)'s `buildMessages`.

```ts
type PluginLocaleMessages = Record<string, Record<string, unknown>>;
```

---

## Agent capability types (`agent-types.ts`)

These describe the tools a plugin exposes to the product's AI agents. See
[`docs/agent-capabilities.md`](../../docs/agent-capabilities.md) for the runtime
model and [`docs/plugins.md`](../../docs/plugins.md) for authoring.

### `PermissionLevel`

The code-enforced risk classification. `DESTRUCTIVE` tools are blocked by the
runtime until the end user confirms (human-in-the-loop, CLAUDE.md §5.7).

```ts
enum PermissionLevel { READ = 'READ', WRITE = 'WRITE', DESTRUCTIVE = 'DESTRUCTIVE' }
```

### `AgentTool` and friends

```ts
interface AgentTool {
  name: string;
  description: string;                 // prompt text handed to the LLM
  parameters: { type: 'object'; properties: Record<string, ToolParameterSchema>; required?: string[] };
  permission: PermissionLevel;
  pluginId: string;                    // ownership — stamped by withPlugin
  pluginLabelKey: string;              // i18n key for the owning plugin's label
  handler: (args: ToolArgs) => Promise<unknown>;
}

type ToolArgs = Record<string, unknown>;
type ConfirmationPolicy = 'AUTO' | 'CONFIRM';
```

Projections and grouping used across the wire:

- `AgentToolDefinition` — `Omit<AgentTool, 'pluginId' | 'pluginLabelKey'>`. What
  a plugin author writes; the ownership fields are added at registration.
- `AgentToolPublic` — the public projection sent to the frontend (drops
  `handler`/plugin fields, adds `isEnabled` + `confirmationPolicy`).
- `AgentToolGroup` — `{ pluginId, pluginLabelKey, icon, tools: AgentToolPublic[] }`.
  Note `pluginLabelKey` is an **i18n key**; the frontend resolves it with `t()`,
  never a raw literal.

### `withPlugin(pluginId, pluginLabelKey, tools)`

Stamps a plugin's identity onto its tool definitions so each plugin declares its
`pluginId`/`pluginLabelKey` exactly once, at the registration site:

```ts
import { withPlugin, PermissionLevel } from '@makekeeper/plugin-contract';

export const getInventoryTools = (svc: InventoryService): AgentTool[] =>
  withPlugin('inventory', 'plugins.inventory.name', [
    {
      name: 'list_components',
      description: 'Returns the full component list…',
      permission: PermissionLevel.READ,
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => svc.findAll(),
    },
    // …
  ]);
```

---

## Conventions

- Keep this library **pure**: no imports from `@nestjs/*`, `vue`, or any runtime
  package. If a type needs a framework, it belongs in `backend-core` or
  `frontend-core`, not here.
- Source-only (no build target); consumers compile it through tsconfig `paths`.
