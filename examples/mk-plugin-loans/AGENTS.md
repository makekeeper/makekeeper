# Agent rules for building a MakeKeeper external plugin

This file is the operating manual for an AI agent (Claude Code, Antigravity,
Cursor, …) working in a **third-party plugin repository**. Copy it, with
`CLAUDE.md` symlinked or duplicated next to it, into your own plugin repo.

The rules below are not style preferences — most of them are enforced by the
core at install or at render time. A plugin that breaks them either fails to
register or renders nothing.

## 1. What you are building

A **separate container** that talks to a MakeKeeper core over HTTP. You own
your database and your scheduler. You never ship frontend code: you return
**declarative screens** from a fixed vocabulary and the core renders them with
its own components.

Read `docs/external-plugins.md` in the core repo for the normative contract.

## 2. Hard rules

1. **No text literals in UI output.** Every visible string is an i18n key that
   exists in your manifest's `en` bundle. The SDK builders (`paragraph`,
   `stat`, `table`, …) take key names, not strings — if you find yourself
   wanting to pass a sentence, add a key instead. The core's sanitizer drops
   nodes whose text is not a key reference, so a literal renders as *nothing*.
2. **`en` is mandatory and complete.** Registration is rejected if any key the
   manifest references is missing from `en`. Other locales are optional and
   fall back to `en`.
3. **Ask for the narrowest permissions.** Every entry in `permissions` shows on
   the admin's consent screen. `instance:*` (all scopes) is flagged as
   elevated — do not request it for convenience.
4. **Event handlers must be idempotent by `eventId`.** Delivery is at-least-once
   and unordered; an event is an invitation to re-read by `ref`, never a state
   transfer. The SDK dedupes within a process (plug `eventDedup` for a
   persistent store) and refuses an unknown envelope `schemaVersion` for you.
   Hearing an owner's domain event requires that owner's `:read` grant. See
   `docs/external-events.md` in the core repo.
5. **Never trust an unsigned request.** Use `startPlugin` (it verifies before
   any handler runs). If you write your own server, use `verifySignedRequest`.
6. **Exchange blobs are self-contained and self-versioned.** `importBlob` must
   refuse a version it does not understand rather than guess.
7. **Handle `core.scope-deleted`** if you store anything per scope. The core
   cannot clean data it cannot see.
8. **Adding a permission, a mutating tool, a capability or changing
   `scopeModel` requires admin re-consent.** Your plugin keeps running on its
   old grants until then, so ship such changes deliberately.

## 3. The screen vocabulary

`text` · `badge` · `stat` · `callout` · `divider` · `button` · `detail` ·
`table` · `list` · `form` · `section`.

That is the whole set. If a design needs something else, either express it with
these or open an issue against the core — do not try to smuggle markup through
a text field (it is escaped) and do not expect an unknown node type to render
(it is skipped, and your plugin card shows a notice).

Reference an entity with an **ORef** (`mk://<plugin>/<type>/<id>`) in a cell,
row or detail row and the core renders an in-app link. Never print a raw
`mk://` string as text.

## 4. Failure budgets you are held to

| Surface | Budget | On miss |
|---|---|---|
| your own screen | ~5 s | error card naming your plugin |
| dashboard widget / slot | ~800 ms | silently not rendered |
| ORef resolver | ~800 ms | link degrades to text |
| agent tool | ~10 s | tool-call error |

Three consecutive failures open a circuit breaker for 60 s. Keep renders fast;
do slow work in your own scheduler and render from your own state.

## 5. Working loop

```bash
# core (dev mode): accepts a fixed, reusable install token
MK_EXTERNAL_DEV=1 MK_EXTERNAL_DEV_TOKEN=dev-token nx serve backend

# plugin
MK_CORE_URL=http://localhost:3000 MK_INSTALL_TOKEN=dev-token npm start
```

Then approve the plugin once in **Settings → External plugins**. Restart the
plugin as often as you like: it re-announces with its stored secret, and a
manifest change that does not expand permissions applies silently.

## 6. Project layout

Keep the same skeleton every example uses. `main.ts` is WIRING ONLY — it should
read as a table of contents, not as the plugin.

```
src/
  main.ts        — startPlugin({ manifest, handlers }) and nothing else
  manifest.ts    — identity and declarations
  i18n/en.ts     — one file per locale
  i18n/ru.ts
  state.ts       — your storage: types, load/save, and the invariants that
                   protect it (scope partitioning above all)
  screens.ts     — render handlers, pure: state in, tree out
  actions.ts     — the only place anything is mutated
  <domain>.ts    — your actual logic (profiles, conversion, …)
  sources/*.ts   — outbound integrations, one file per external system
```

Two mechanical notes:

- Node's `--experimental-strip-types` does **no path rewriting**: relative
  imports must carry the `.ts` extension (`./state.ts`).
- Adding a second integration should mean adding a file under `sources/`, not
  editing the plugin's core. If it does not, the seam is in the wrong place.

## 7. Definition of done for a change

- [ ] Manifest still validates (the SDK checks at boot; a bad key fails loudly).
- [ ] Every new key present in `en`, and in every other locale you ship.
- [ ] No literal reached a UI text slot.
- [ ] New event handlers are idempotent.
- [ ] Slow work moved off the render path.
- [ ] If permissions changed, the README says so — the admin must re-consent.
- [ ] `main.ts` still reads as wiring — new logic went into a module.
