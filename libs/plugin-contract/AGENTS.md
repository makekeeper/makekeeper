# AGENTS — `@makekeeper/plugin-contract`

Instructions for AI agents editing this library. Human overview: [`README.md`](README.md).

## What this is
The framework-agnostic contract shared by the backend, the frontend, and every
plugin. Types + one pure helper (`withPlugin`). No runtime code.

## Hard rules
- **Zero framework imports.** Never import `@nestjs/*`, `vue`, `vue-router`, or
  any runtime package here. If a type needs a framework, it belongs in
  `backend-core` (Nest) or `frontend-core` (Vue), not here.
- **No user-facing literals in types.** Descriptor fields carry i18n *keys*
  (`nameKey`, `titleKey`, `labelKey`, `pluginLabelKey`), never display strings.
- **This is a published contract.** A change here ripples to both apps and all
  six plugins. Before changing a shape, grep every consumer and update them in
  the same change; run `nx build backend frontend` + `nx run-many -t lint`.
- Follow CLAUDE.md §5.1: no `any`, no naked `as`, explicit return types,
  discriminated unions over optional-field soups.

## Changing a type — checklist
- [ ] Update the type in `manifest.ts` or `agent-types.ts` and re-export from `src/index.ts`.
- [ ] Grep usages across `libs/*` and `apps/*`; update every call site.
- [ ] If it affects the tool wire shape, update `AgentToolGroup` /
      `AgentToolPublic` and the backend `AgentRegistryService.getGroupedTools`
      + `SettingsService.getAgentTools` together.
- [ ] `nx build backend`, `nx build frontend`, `nx run-many -t lint` all pass.

## Do not
- Add dependencies to this library.
- Introduce a build target — it is intentionally source-only.
- Put helpers with side effects here; only pure functions (like `withPlugin`).
