// Wire shapes shared by the exchange backend and frontend (both import from
// this file, mirroring `tags-types.ts`). All human-facing text travels as i18n
// KEYS — the frontend resolves them with $t().

import type {
  ExchangeRootKind,
  PluginSettingField,
} from '@makekeeper/plugin-contract';

export interface ExchangeCatalogRoot {
  entityType: string;
  kind: ExchangeRootKind;
  labelKey: string;
  icon: string;
  pluginId: string;
}

export interface ExchangeCatalogSection {
  key: string;
  pluginId: string;
  labelKey: string;
  descriptionKey?: string;
  dependsOn: string[];
  isRoot: boolean;
  hasFiles: boolean;
  sensitive: boolean;
  defaultSelected: boolean;
  importOptions?: PluginSettingField[];
}

// GET /api/exchange/catalog — what the export UI renders.
export interface ExchangeCatalog {
  roots: ExchangeCatalogRoot[];
  sectionsByRoot: Record<string, ExchangeCatalogSection[]>;
}

export interface ExchangeImportPreviewSection {
  key: string;
  count: number;
  // False when the section cannot be imported here (unknown, or its plugin is
  // disabled) — `warningKeys` says why.
  available: boolean;
  warningKeys: string[];
  // Present when the section is known to this instance.
  labelKey?: string;
  pluginId?: string;
  isRoot?: boolean;
  dependsOn?: string[];
  importOptions?: PluginSettingField[];
}

// POST /api/exchange/import/inspect — the wizard's step-2 payload.
export interface ExchangeImportPreview {
  token: string;
  rootType: string;
  rootId: string | null;
  exportedAt: string;
  sections: ExchangeImportPreviewSection[];
}

export interface ExchangeImportResultSection {
  key: string;
  created: number;
}

// POST /api/exchange/import/:token/execute — the wizard's result payload.
export interface ExchangeImportResult {
  // Canonical ORef of the newly created root entity (entity roots only).
  rootRef: string | null;
  sections: ExchangeImportResultSection[];
}
