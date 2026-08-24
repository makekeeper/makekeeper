# Exchange — plugin-extensible export/import (#62)

The `exchange` plugin gives the app portable `.mkx` archives: selective export/import of a
single **project** or **storage**, and an admin-only **full-instance backup/restore** for
server migration. The exchange plugin owns only orchestration, the archive format and the
UI — **it knows no concrete entity**. Every data-owning plugin declares WHAT it can
exchange in its manifest and registers HOW as a provider. This document is the author's
guide for adding exchange support to a plugin.

## Architecture in one paragraph

Declarative half: `PluginManifest.exchange` (`libs/plugin-contract/src/lib/exchange.ts`) —
the roots a plugin owns and the sections it provides. Imperative half: an
`ExchangeSectionProvider` per section, registered in the plugin's backend module
`onModuleInit()` into `ExchangeRegistryService` (backend-core — the same pattern as
`StatsRegistryService`). The exchange plugin consumes both: it topologically orders
sections, threads a shared id-map through the run, writes/reads the ZIP and exposes the
endpoints (`/api/exchange/catalog|export|import/*`) and the wizard UI. Declarations and
providers are cross-validated at startup (`onApplicationBootstrap`) — any mismatch throws.

## Archive format

`.mkx` = ZIP: `manifest.json` (formatVersion, root type/id, per-section counts + plugin
versions), `data/<sectionKey>.json` (one record array per section),
`files/<sectionKey>/<fileId>` (binaries of `hasFiles` sections). Original ids are internal
cross-references only — entity imports always mint fresh ids and remap through the id-map;
instance restores preserve ids verbatim into a verified-empty instance. Entity exports
never contain secrets; instance exports include `sensitive` sections only behind the
explicit include-secrets toggle.

## Declaring sections (manifest)

```ts
exchange: {
  roots: [ // only if the plugin OWNS an exportable root
    { kind: 'entity', entityType: 'project', labelKey: 'myplugin.exchange.root', icon: 'Box' },
  ],
  sections: [
    {
      key: 'myplugin.things',            // '<pluginId>.<section>' — the archive id
      labelKey: 'myplugin.exchange.sections.things',
      roots: ['project'],                // root types this section contributes to
      dependsOn: ['projects.project'],   // HARD deps: selecting this requires those
      runAfter: ['logistics.orders'],    // ordering-only: run later IF present
      hasFiles: true,                    // section ships binaries
      sensitive: true,                   // credentials — instance include-secrets only
      importOptions: [ /* PluginSettingField[] — rendered generically by the wizard */ ],
    },
  ],
}
```

Rules enforced at startup: keys namespaced by the declaring plugin; every declared section
has a provider and vice versa; `dependsOn`/`runAfter` reference declared sections; every
root has exactly one `isRoot` section; no dependency cycles.

## Writing a provider

```ts
const provider: ExchangeSectionProvider = {
  sectionKey: 'myplugin.things',
  async exportSection(ctx) { /* scoped reads; return { records } */ },
  async inspectSection(records, ctx) { /* dry-run: counts + warningKeys; NEVER writes */ },
  async importSection(records, ctx) { /* create rows through ctx.tx ONLY */ },
};
// module onModuleInit():
this.exchangeRegistry.registerSectionProvider('myplugin', provider);
```

Key contract points (`libs/backend-core/src/lib/exchange-registry.service.ts`):

- **Records are untrusted JSON.** Narrow every field with the `exchange-records` readers
  (`isExchangeRecord`, `readString`, `readDate`, …) — they clamp lengths and reject junk.
  The `{ t: '<kind>', ...fields }` discriminator convention keeps mixed record streams simple.
- **Id-map.** On import, register every created row: `ctx.idMap.set('<orefEntityType>',
  oldId, newId)` and translate every cross-reference with `ctx.idMap.translate(...)`. Use
  the ORef entity-type namespaces (`'project'`, `'task'`, `'component'`, `'order'`,
  `'supplier'`, `'storage'`, `'session'`, `'attachment'`, `'tag'`) so the tags section can
  remap `TagLink.ref`s. A reference that doesn't resolve is **dropped, never dangled**.
- **Scope.** Imports run with scope enforcement suspended (the policy's parent-FK checks
  cannot see rows created inside the transaction). Compensate explicitly: spread
  `...exchangeScopeStamp(ctx)` into every scoped-model create and
  `...exchangeScopeFilter(ctx)` into every match/target lookup.
- **Transaction.** `importSection` runs inside ONE interactive transaction — write through
  `ctx.tx` only, never an injected PrismaService; a throw rolls the whole import back.
- **Files.** `hasFiles` sections stream binaries via `ctx.files.putFile(fileId, bytes)` on
  export and `ctx.files.readFile(fileId)` on import; use
  `AttachmentStorageService.readBytesById` / `writeBytesForImport` for attachment payloads
  (row creation stays on `ctx.tx`).
- **Refs for dependents.** Export calls `ctx.addExportedRef(canonicalORef)` for every
  entity it exports; later sections (tags, storage stock) read `ctx.getExportedRefs()`.
  Always build refs with `formatObjectRef` — never string concatenation (§5.9).
- **Vocabulary matching.** Shared vocabularies match instead of duplicating: tags always
  match-by-name (unique constraint), suppliers match-by-name, components offer a
  user-facing `importOptions` strategy (`create-new` / `match-existing` by SKU → name).
- **Instance sections.** Whole-table dataset sections (`roots: ['instance']`) usually need
  no hand-written provider — `createTableDumpProvider({ sectionKey, models, prisma })`
  dumps/restores tables verbatim, checks the fresh-instance precondition
  (`assertTablesEmpty`), and orders self-referencing tables parent-first
  (`{ name: 'storage', parentKey: 'parentId' }`). Custom instance providers (files,
  account merging) call `assertTablesEmpty` themselves.
- **Errors are i18n keys** (`exchange.errors.*` or the plugin's own bundle), thrown inside
  Nest exceptions — never prose.

## Frontend

The exchange page (`/exchange`) hosts the import wizard and the admin backup card. Entity
exports are contributed actions: the exchange plugin injects an "Export…" button into the
`projects.detail.meta` / `storages.detail.meta` slots and derives the root from the ORef
in the slot ctx — a host never imports exchange code. `importOptions` render generically
in the wizard (string/number/boolean/select); nothing plugin-specific lives in the wizard.

## Security guarantees

Entry names in uploaded archives are structurally validated (fixed layout, safe charset,
no traversal); zip-bomb ceilings cap entry count and uncompressed sizes; the upload limit
comes from `AppConfigService.getExchangeUploadLimitBytes()` (`EXCHANGE_UPLOAD_LIMIT_MB`,
default 512). Instance export/import/inspect are admin-gated in multiuser mode; the
fresh-instance precondition is distributed — every dataset section verifies its own
tables are empty. Import previews write nothing; cancelled/expired uploads are swept from
`<uploads>/exchange-tmp` after one hour.

## Known gaps (v1)

- Restored `PluginConfig` rows take effect after the next backend restart (in-memory cache).
- Merging an instance archive into a non-empty instance is unsupported by design.
- Archive passphrase encryption is a follow-up; include-secrets archives rely on the
  operator storing the file securely.
