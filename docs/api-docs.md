# API documentation (Swagger / OpenAPI)

The backend serves interactive OpenAPI docs (Swagger UI) at **`/api/docs`**, with the raw document
at **`/api/docs-json`**. Setup lives in [`apps/backend/src/app/swagger.ts`](../apps/backend/src/app/swagger.ts),
called from [`main.ts`](../apps/backend/src/main.ts) after the global `api` prefix is set.

## What is documented

- **Every controller** across the core app and all plugin backends carries `@ApiTags('<pluginId>')`,
  so endpoints are grouped in the UI exactly as the app groups plugins. Auth-required controllers
  also carry `@ApiBearerAuth()`; the doc exposes an **Authorize** button for the multiuser JWT.
- **Every DTO field** carries `@ApiProperty` / `@ApiPropertyOptional` with non-text metadata kept in
  sync with its `class-validator` decorators (`maxLength`, `minLength`, `minimum`, `maximum`,
  `enum`, `type`/`isArray`, `format`, `nullable`). No field descriptions — see the i18n rule below.

## Access

`SwaggerModule.setup()` mounts Swagger UI via express, so it sits **outside** the Nest guard chain
(`MultiuserGuard` / `PluginEnabledGuard`) and is reachable without authentication — the intended
"always open" behavior. There is no separate flag to gate it.

## i18n and the §5.5 exception

[CLAUDE.md §5.5](../CLAUDE.md) forbids text-string literals in code except i18n keys. Doc text is
handled as follows:

- **Tag descriptions** resolve from each plugin's own i18n (`plugins.<id>.description`) at a forced
  `en` locale via `PluginI18nService` — no literals.
- **Operation summaries / field descriptions** can opt into the same mechanism: give the decorator a
  value prefixed with `i18n:` (e.g. `@ApiOperation({ summary: 'i18n:plugins.projects.someKey' })`)
  and the post-processing pass in `swagger.ts` (`localizeDocument`) resolves it to English. Any
  value **without** the `i18n:` prefix is left verbatim.
- The DocumentBuilder **title/description** resolve from `core.apiDocs.*`
  (the core bundle, [`apps/backend/src/app/i18n/`](../apps/backend/src/app/i18n/)).

**Sanctioned exception.** Where no suitable i18n key exists, a plain **English** literal is permitted
in `@ApiOperation`/`@ApiProperty` doc text (a Swagger summary/description). This is the single
documented carve-out from §5.5: API docs are a developer-facing surface that never reaches an end
user through the app's `t()`/`$t()` pipeline. Prefer an `i18n:` key when one fits; reach for a plain
literal only as a fallback, and keep it English. Non-doc text (UI, toasts, errors, notes, LLM
prompts, tool `descriptionKey`s) is **not** covered by this exception.
