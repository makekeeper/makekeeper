# `@makekeeper/backend-core`

Shared **NestJS infrastructure** every backend plugin builds on: database access,
the two runtime registries, and small helpers. Plugin backends depend on this
library so they never reach into the `apps/backend` application code (which NX
module boundaries forbid).

- **Path:** `libs/backend-core`
- **Import:** `@makekeeper/backend-core`
- **Depends on:** `@makekeeper/plugin-contract`, `@nestjs/common`,
  `@prisma/client` (+ `@prisma/adapter-pg`, `pg`), `uuid`
- **Depended on by:** `apps/backend`, every `plugin-<id>` backend

Everything is re-exported from `src/index.ts`; import only from
`@makekeeper/backend-core`.

---

## Contents

| Symbol | File | Kind | Purpose |
|---|---|---|---|
| `PrismaService` | `lib/prisma.service.ts` | `@Injectable` | `PrismaClient` (pg adapter) with connect/disconnect lifecycle. |
| `PrismaModule` | `lib/prisma.module.ts` | `@Global @Module` | Provides + exports `PrismaService` app-wide. |
| `PluginRegistryService` | `lib/plugin-registry.service.ts` | `@Injectable` | In-memory registry of `PluginManifest`s. |
| `PluginRegistryModule` | `lib/plugin-registry.module.ts` | `@Global @Module` | Provides + exports `PluginRegistryService`. |
| `AgentRegistryService` | `lib/agent-registry.service.ts` | `@Injectable` | Registers agent tools, groups them, syncs config to DB. |
| `AgentRegistryModule` | `lib/agent-registry.module.ts` | `@Global @Module` | Provides + exports `AgentRegistryService`. |
| `getErrorMessage` | `lib/error.ts` | function | `unknown → string` error extraction (§5.2). |
| `generateUuid` | `lib/uuid.ts` | function | Chronologically sortable UUIDv7. |

---

## `PrismaService`

Extends `PrismaClient` using the `@prisma/adapter-pg` driver over a `pg` `Pool`.
Connects on `onModuleInit`, disconnects and ends the pool on `onModuleDestroy`.

```ts
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}
  findAll() { return this.prisma.component.findMany(); }
}
```

> The connection string currently falls back to a literal default when
> `DATABASE_URL` is unset. New app code must read config through the settings/
> config service, not `process.env` directly (CLAUDE.md §5.2).

## `PluginRegistryService`

Holds the manifest each plugin registers on `OnModuleInit`. Used for agent-tool
group icons and any plugin-metadata endpoint (`GET /api/plugins`).

```ts
register(manifest: PluginManifest): void;
getPlugins(): PluginManifest[];
getPlugin(id: string): PluginManifest | undefined;
```

## `AgentRegistryService`

The heart of the capabilities layer. Plugins push their tools in; the service
groups them by owning plugin and, on application bootstrap, seeds a DB config row
per tool (default `confirmationPolicy`: `CONFIRM` for `DESTRUCTIVE`, else `AUTO`).

```ts
registerTools(tools: AgentTool[]): void;
getTools(): AgentTool[];
getTool(name: string): AgentTool | undefined;
getGroupedTools(): { pluginId: string; pluginLabelKey: string; tools: AgentTool[] }[];
// onApplicationBootstrap → syncToolsWithDatabase() (creates missing AgentToolConfig rows)
```

`getGroupedTools()` returns `pluginLabelKey` (an **i18n key**), which the
frontend resolves with `t()` — see `SettingsService.getAgentTools` for the
public projection and `AgentCapabilitiesView.vue` for rendering.

---

## How a plugin wires it up

```ts
import { PluginRegistryService, AgentRegistryService } from '@makekeeper/backend-core';

@Module({ providers: [InventoryService], /* … */ })
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

The `PrismaModule`, `PluginRegistryModule`, and `AgentRegistryModule` are
imported once in `apps/backend/src/app/app.module.ts`; because they are
`@Global`, plugin modules can inject their services without re-importing.

---

## Conventions

- Source-only (no build target); `apps/backend` bundles it via webpack/tsc
  through tsconfig `paths`.
- One `private readonly logger = new Logger(ClassName.name)` per class; no
  `console.log`. Use `getErrorMessage` for error extraction.
