# AGENTS — `@makekeeper/frontend-core`

Instructions for AI agents editing this library. Human overview: [`README.md`](README.md).

## What this is
Shared Vue infrastructure for all plugin frontends: the plugin registry
(`registerPlugin`, `getPluginRoutes`, `getPluginNavigation`), the i18n merge
helper (`buildMessages`), and shared UI (`Select`, `RichEditor`). Depends only on
`@makekeeper/plugin-contract` + Vue ecosystem.

## Hard rules
- **Never import a plugin or the app.** `libs/plugin-*` and `apps/frontend`
  depend on this library, not the reverse. No `@makekeeper/plugin-*` imports.
- **No backend / NestJS imports.** Frontend only.
- Composition API + `<script setup>` only. No Options API, no `history.pushState`
  — navigation is route-driven.
- Shared descriptor types come from `@makekeeper/plugin-contract`
  (`PluginNavItem`, `PluginLocaleMessages`); do not redeclare them.
- Every user-facing string is an i18n key resolved by the host app — this library
  ships no hardcoded copy.
- Use the shared `Select`; never introduce a native `<select>`.

## When you change things
- **Registry shape (`FrontendPlugin`/`RegisteredNavItem`)**: update every plugin
  `frontend/index.ts` and the shell consumers (`App.vue`, `router/index.ts`) in
  the same change.
- **`buildMessages`**: it must be called *after* the loader registers plugins —
  don't move plugin registration below it. Keep the deep-merge pure.
- **New shared component**: add it under `src/lib/components/`, re-export from
  `src/index.ts` as a named export, and make sure its Tailwind classes are
  covered by `apps/frontend/tailwind.config.js` `content` (it already globs
  `libs/**`).
- Adding a Lucide icon that plugins reference by name → also register it in the
  `iconMap` of `App.vue` (and `AgentCapabilitiesView.vue` for tool groups).

## Verify
- `nx build frontend`, `nx lint frontend-core`, and (if you touch the registry)
  `nx test frontend` + `nx test plugin-settings` all pass.

## Do not
- Add a build target (source-only by design).
- Create the `vue-i18n` instance here — the host app owns it; this lib only
  builds the message tree.
