// Declarative half of the export/import framework (#62). A data-owning plugin
// declares in its manifest WHAT it can exchange — the roots it owns and the
// sections it provides — while the HOW lives in an `ExchangeSectionProvider`
// the plugin registers in its backend module (see backend-core's
// `ExchangeRegistryService`). The `exchange` plugin consumes both and owns
// orchestration, the archive format and the UI; it never knows a concrete
// entity, only entity types and section keys.

import type { PluginSettingField } from './manifest';

// 'entity' exports ONE object picked by the user (addressed by its ORef);
// 'dataset' exports a whole data set with no root object. The built-in dataset
// root 'instance' (full backup / server migration) is declared by the exchange
// plugin itself; other plugins join it via `roots: ['instance']` sections.
export type ExchangeRootKind = 'entity' | 'dataset';

// The entity type of the built-in full-backup dataset root.
export const EXCHANGE_INSTANCE_ROOT = 'instance';

// The built-in dataset root that exports ONE scope's data (a single user's
// workspace) without secrets. Admin-gated and run under that scope, it is the
// backup an admin can take before force-deleting a user. Scope-bound `*.all`
// sections opt into it via `roots: ['instance', 'scope']`.
export const EXCHANGE_SCOPE_ROOT = 'scope';

// One exportable root a plugin OWNS. For `kind: 'entity'` the `entityType` is
// the plugin's ORef entity type (the plugin must own that type's ObjectRef
// resolver); for `kind: 'dataset'` it is a stable id of the data set.
export interface PluginExchangeRoot {
  kind: ExchangeRootKind;
  entityType: string;
  // i18n key for the root's human label (plugin's own bundle).
  labelKey: string;
  // Lucide icon shown in the exchange UI.
  icon: string;
}

// One data section a plugin PROVIDES to one or more roots. The section key is
// the stable archive id — `data/<key>.json` inside the `.mkx` file.
export interface PluginExchangeSection {
  // Stable id, namespaced by the owning plugin: `<pluginId>.<section>`.
  key: string;
  labelKey: string;
  descriptionKey?: string;
  // Root entity types this section can contribute to. Cross-plugin on purpose
  // (e.g. logistics contributes `logistics.orders` to the `project` root).
  roots: string[];
  // Section keys this one needs. Drives the orchestrator's topological order
  // and the UI dependency rules (selecting this section requires those).
  // Cross-plugin references are allowed.
  dependsOn?: string[];
  // Ordering-only hints: run after these sections WHEN they participate, but
  // do not require them (e.g. tags runs after everything it might reference,
  // task↔order links wait for orders — yet both survive their absence by
  // dropping the cross-links).
  runAfter?: string[];
  // The root's own core section (e.g. the Project row itself): always exported,
  // cannot be deselected on either side. Exactly one per root.
  isRoot?: boolean;
  // Section ships binary files alongside its records (`files/<key>/…`).
  hasFiles?: boolean;
  // Section carries credentials/secrets (API keys, password hashes). Only ever
  // exported when the instance export's include-secrets toggle is on; never
  // exportable from entity roots.
  sensitive?: boolean;
  // Pre-checked in the export/import selection UI. Defaults to true.
  defaultSelected?: boolean;
  // Declarative per-section import options, rendered generically by the import
  // wizard (reuses the settings-field shape — e.g. inventory's match strategy).
  importOptions?: PluginSettingField[];
}

// The manifest block: roots this plugin owns + sections it provides.
export interface PluginExchangeDeclaration {
  roots?: PluginExchangeRoot[];
  sections: PluginExchangeSection[];
}

// Values the user picked for a section's `importOptions`, keyed by field key.
export type ExchangeOptionValues = Record<string, string | number | boolean>;
