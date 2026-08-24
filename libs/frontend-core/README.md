# `@makekeeper/frontend-core`

Shared **Vue infrastructure** every plugin frontend builds on: the plugin
registry, the i18n merge helper, and the shared UI components. Plugin frontends
depend on this library so they never reach into the `apps/frontend` application
code (which NX module boundaries forbid).

- **Path:** `libs/frontend-core`
- **Import:** `@makekeeper/frontend-core`
- **Depends on:** `@makekeeper/plugin-contract`, `vue`, `vue-router`,
  `vue-i18n` (peer), `@lucide/vue`
- **Depended on by:** `apps/frontend`, every `plugin-<id>` frontend

Everything is re-exported from `src/index.ts`; import only from
`@makekeeper/frontend-core`.

---

## Contents

| Symbol | File | Purpose |
|---|---|---|
| `registerPlugin` | `lib/registry.ts` | Register a plugin's routes + nav + i18n (import side-effect). |
| `getActivePlugins` | `lib/registry.ts` | All registered `FrontendPlugin`s. |
| `getPluginRoutes` | `lib/registry.ts` | Flattened `RouteRecordRaw[]` for the router. |
| `getPluginNavigation` | `lib/registry.ts` | Flattened sidebar entries (`RegisteredNavItem[]`). |
| `getPluginSettingsPanels` | `lib/registry.ts` | Settings panels of plugins that declare one (`RegisteredSettingsPanel[]`). |
| `FrontendPlugin`, `RegisteredNavItem`, `PluginSettingsPanel`, `RegisteredSettingsPanel` | `lib/registry.ts` | Registration types. |
| `buildMessages` | `lib/i18n.ts` | Deep-merge every plugin's locale bundle onto core messages. |
| `Select` | `lib/components/Select.vue` | Shared styled selectbox (**use instead of native `<select>`**). |
| `RichEditor` | `lib/components/RichEditor.vue` | Shared rich-text editor. |

---

## The plugin registry (`registry.ts`)

A plugin's frontend entry calls `registerPlugin(...)` once, as an import
side-effect. The app shell then reads the registry — it never hardcodes routes,
nav, or strings.

### `FrontendPlugin`

```ts
interface FrontendPlugin {
  id: string;
  nameKey: string;                 // i18n key for the display name
  navigation: PluginNavItem[];     // from @makekeeper/plugin-contract
  routes: RouteRecordRaw[];
  messages: PluginLocaleMessages;  // { en: {...}, ru: {...} }
}
```

### API

```ts
registerPlugin(plugin: FrontendPlugin): void;
getActivePlugins(): FrontendPlugin[];
getPluginRoutes(): RouteRecordRaw[];
getPluginNavigation(): RegisteredNavItem[]; // PluginNavItem + { pluginId }
```

Consumed by the shell:

- `router/index.ts` → `getPluginRoutes()` in `initializeRouter()`.
- `App.vue` → `getPluginNavigation()` to render the sidebar (`main` vs `system`
  sections), mapping each `icon` name to a Lucide component.

---

## i18n merge (`i18n.ts`)

### `buildMessages(coreMessages)`

Folds every registered plugin's `messages` onto the app's core messages with a
recursive deep-merge, so multiple plugins can each contribute keys to shared
sections (`nav`, `routeTitles`) as well as their own namespace. **Call it after
the plugin loader has run** so all plugins are registered.

```ts
import { buildMessages } from '@makekeeper/frontend-core';
import '../plugins/loader';        // side-effect: registers all plugins first
import en from './locales/en.json';
import ru from './locales/ru.json';

const messages = buildMessages({ en, ru });
export const i18n = createI18n({ legacy: false, /* … */, messages });
```

Deep-merge semantics: nested objects merge; leaf values from later sources win.

---

## Shared components

- **`Select`** — the styled selectbox. Native `<select>` is forbidden across the
  app; always use this (see the project memory note). Import as a named export:
  ```ts
  import { Select } from '@makekeeper/frontend-core';
  ```
- **`RichEditor`** — shared rich-text editor for descriptions.

---

## Conventions

- Source-only (no build target); `apps/frontend` bundles it via Vite
  (`nxViteTsPaths`) through tsconfig `paths`.
- Composition API + `<script setup>` only. Navigation state stays route-driven
  (vue-router) — no `history.pushState`.
- `vue-i18n` is expected to be provided by the host app's i18n instance; this
  library only builds the message tree, it does not create the i18n plugin.
