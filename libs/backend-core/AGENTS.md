# AGENTS — `@makekeeper/backend-core`

Instructions for AI agents editing this library. Human overview: [`README.md`](README.md).

## What this is
Shared NestJS infrastructure for all backend plugins: `PrismaService`/`PrismaModule`,
`PluginRegistryService`/`PluginRegistryModule`, `AgentRegistryService`/`AgentRegistryModule`,
`getErrorMessage`, `generateUuid`. Depends only on `@makekeeper/plugin-contract`.

## Hard rules
- **Never import a plugin or the app.** This library sits *below* plugins;
  `libs/plugin-*` and `apps/backend` depend on it, not the reverse. No
  `@makekeeper/plugin-*` imports here.
- **No Vue / frontend imports.** Backend only.
- Decorators + DI only — never `new Service()`. Keep the `@Global` modules global
  so plugins inject without re-importing.
- One `private readonly logger = new Logger(ClassName.name)` per class. **No
  `console.log`.** Extract errors with `getErrorMessage`.
- Shared types come from `@makekeeper/plugin-contract`; do not redeclare
  `AgentTool`, `PermissionLevel`, `PluginManifest` here.
- Config/secrets via the settings/config service, not `process.env` (§5.2).

## When you change the registries
- `AgentRegistryService.getGroupedTools()` returns `pluginLabelKey` (i18n key).
  If you change its shape, update `SettingsService.getAgentTools`, the
  `AgentToolGroup` type in `plugin-contract`, and `AgentCapabilitiesView.vue`
  together.
- `PluginRegistryService.register` takes a `PluginManifest` — keep it in lockstep
  with the contract type.
- Adding a new shared service/module: add the file under `src/lib/`, export it
  from `src/index.ts`, and (if it must be injectable everywhere) make its module
  `@Global`.

## Verify
- `nx build backend`, `nx test backend`, `nx lint backend-core` all pass.

## Do not
- Add a build target (source-only by design).
- Move plugin-specific logic here — it belongs in the owning `plugin-<id>`.
