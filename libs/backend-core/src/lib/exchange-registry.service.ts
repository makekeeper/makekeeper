import { Injectable, Logger } from '@nestjs/common';
import type {
  PluginExchangeDeclaration,
  PluginExchangeRoot,
  PluginExchangeSection,
  ExchangeOptionValues,
} from '@makekeeper/plugin-contract';
import { PluginConfigService } from './plugin-config.service';
import { PluginRegistryService } from './plugin-registry.service';
import type { PrismaTransactionClient } from './prisma.service';

// Imperative half of the export/import framework (#62). Declarations live in
// each plugin's manifest (`PluginExchangeDeclaration`); the matching logic is
// an `ExchangeSectionProvider` the owning plugin registers here in its
// `onModuleInit()` — mirroring `StatsRegistryService`. The exchange plugin
// consumes the registry; this service never orchestrates anything itself.

// The root being exported/imported. `entityId` is the Prisma id of the picked
// object for entity roots, null for dataset roots (instance backup).
export interface ExchangeRootRef {
  entityType: string;
  entityId: string | null;
}

// Shared old-id → new-id mapping threaded through an import run, namespaced by
// entity type. Providers record every row they create and translate the
// cross-references they consume.
export class ExchangeIdMap {
  private readonly map = new Map<string, string>();

  set(entityType: string, oldId: string, newId: string): void {
    this.map.set(`${entityType}:${oldId}`, newId);
  }

  get(entityType: string, oldId: string): string | null {
    return this.map.get(`${entityType}:${oldId}`) ?? null;
  }

  // Translate an id that MAY be unmapped (target row not part of the archive)
  // to the mapped id, or null when the reference points outside the import.
  translate(
    entityType: string,
    oldId: string | null | undefined,
  ): string | null {
    if (!oldId) return null;
    return this.get(entityType, oldId);
  }
}

// File sink handed to a `hasFiles` section during export: the orchestrator
// owns the archive layout (`files/<sectionKey>/<fileId>`), the provider only
// names files. Import reads through the matching source. Attachments should
// travel via the path-based methods — those stream disk-to-archive and
// archive-to-disk without ever buffering a whole file; the byte methods stay
// for small generated payloads.
export interface ExchangeFileSink {
  putFile(fileId: string, data: Uint8Array): Promise<void>;
  putFileFromPath(fileId: string, absPath: string): Promise<void>;
}

export interface ExchangeFileSource {
  readFile(fileId: string): Promise<Uint8Array | null>;
  // Absolute path of an extracted file, or null when absent/invalid — lets a
  // provider hand the file to a copy/stream API instead of buffering it.
  filePath(fileId: string): Promise<string | null>;
  listFiles(): Promise<string[]>;
}

// Context for one section's export pass. `addExportedRef` accumulates the
// canonical ORefs of everything exported so far — sections ordered later via
// `dependsOn` (tags) select their records against this set.
export interface ExchangeExportContext {
  root: ExchangeRootRef;
  locale: string;
  // Section keys selected for this run (the provider may need to know whether
  // a sibling section travels, e.g. task↔order links).
  selectedSections: ReadonlySet<string>;
  // Instance export only: include `sensitive` sections. Always false for
  // entity roots.
  includeSecrets: boolean;
  addExportedRef(ref: string): void;
  getExportedRefs(): readonly string[];
  files: ExchangeFileSink;
}

export interface ExchangeSectionPayload {
  records: unknown[];
}

// Dry-run result for one section of an uploaded archive. `warningKeys` are
// i18n keys resolved by the frontend/preview endpoint.
export interface ExchangeSectionPreview {
  count: number;
  warningKeys?: string[];
}

export interface ExchangeInspectContext {
  root: ExchangeRootRef;
  locale: string;
}

// Context for one section's import pass. Runs inside the orchestrator's single
// interactive transaction — providers MUST write through `tx`, never their own
// PrismaService, so a failure anywhere rolls the whole import back.
export interface ExchangeImportContext {
  root: ExchangeRootRef;
  tx: PrismaTransactionClient;
  scopeId: string | null;
  locale: string;
  selectedSections: ReadonlySet<string>;
  idMap: ExchangeIdMap;
  // The user's values for this section's declared `importOptions`.
  options: ExchangeOptionValues;
  // Instance import: original ids are preserved verbatim (fresh target); the
  // idMap then maps every id to itself, so translating providers still work.
  preserveIds: boolean;
  files: ExchangeFileSource;
}

export interface ExchangeSectionResult {
  created: number;
  // Set by the ROOT section's provider: the canonical ORef of the newly
  // created root entity, so the result screen can link to it.
  rootRef?: string;
}

// The per-section logic a data-owning plugin registers. Arbitrary complexity
// lives here (match-by-name vocabularies, opening-balance movements, …).
export interface ExchangeSectionProvider {
  sectionKey: string;
  exportSection(ctx: ExchangeExportContext): Promise<ExchangeSectionPayload>;
  // MUST NOT write; validates records and returns counts/warnings.
  inspectSection(
    records: unknown[],
    ctx: ExchangeInspectContext,
  ): Promise<ExchangeSectionPreview>;
  importSection(
    records: unknown[],
    ctx: ExchangeImportContext,
  ): Promise<ExchangeSectionResult>;
  // Instance (dataset) sections only: how many rows already exist in the
  // section's tables, NOT counting sanctioned day-one state (the bootstrap
  // admin account, default config rows). The orchestrator sums this across
  // ALL enabled instance sections — selected or not — to enforce the
  // fresh-instance precondition before any restore work runs.
  countExistingRows?(tx: PrismaTransactionClient): Promise<number>;
}

interface RegisteredExchangeProvider {
  pluginId: string;
  provider: ExchangeSectionProvider;
}

// A section paired with the plugin that declared it — the orchestrator's
// working unit after collecting declarations across manifests.
export interface DeclaredExchangeSection {
  pluginId: string;
  section: PluginExchangeSection;
}

export interface DeclaredExchangeRoot {
  pluginId: string;
  root: PluginExchangeRoot;
}

// Declaration/registration consistency failure — always a programming error.
// Carries an i18n key (`core.errors.*`, registered by the app's core bundle)
// plus interpolation params; the message stays the raw key so an unresolved
// throw still follows the "errors are i18n keys" convention.
export class ExchangeDeclarationError extends Error {
  constructor(
    readonly key: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(key);
  }
}

// Topologically order sections by `dependsOn` + `runAfter` (Kahn). Edges to
// sections outside `sections` are ignored here — cross-selection pruning is
// the caller's job; a cycle throws (declaration bug, fail loud).
export function orderExchangeSections(
  sections: DeclaredExchangeSection[],
): DeclaredExchangeSection[] {
  const byKey = new Map(sections.map((s) => [s.section.key, s]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const { section } of sections) {
    const deps = [
      ...new Set([...(section.dependsOn ?? []), ...(section.runAfter ?? [])]),
    ].filter((d) => byKey.has(d));
    indegree.set(section.key, deps.length);
    for (const dep of deps) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), section.key]);
    }
  }
  const queue = sections
    .map((s) => s.section.key)
    .filter((key) => (indegree.get(key) ?? 0) === 0);
  const ordered: DeclaredExchangeSection[] = [];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) break;
    const entry = byKey.get(key);
    if (entry) ordered.push(entry);
    for (const next of dependents.get(key) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (ordered.length !== sections.length) {
    throw new ExchangeDeclarationError('core.errors.exchangeCycle');
  }
  return ordered;
}

// Startup-time consistency check between manifest declarations and registered
// providers. Called by the exchange plugin once all modules initialized
// (onApplicationBootstrap); any finding is a programming error → throw.
export interface ExchangeValidationInput {
  declarations: { pluginId: string; declaration: PluginExchangeDeclaration }[];
  providerKeys: ReadonlySet<string>;
}

export function validateExchangeDeclarations(
  input: ExchangeValidationInput,
): void {
  const sections = new Map<string, PluginExchangeSection>();
  const rootTypes = new Set<string>();
  for (const { pluginId, declaration } of input.declarations) {
    for (const root of declaration.roots ?? []) {
      if (rootTypes.has(root.entityType)) {
        throw new ExchangeDeclarationError(
          'core.errors.exchangeRootDuplicate',
          {
            rootType: root.entityType,
          },
        );
      }
      rootTypes.add(root.entityType);
    }
    for (const section of declaration.sections) {
      if (!section.key.startsWith(`${pluginId}.`)) {
        throw new ExchangeDeclarationError(
          'core.errors.exchangeSectionNamespace',
          { key: section.key, pluginId },
        );
      }
      if (sections.has(section.key)) {
        throw new ExchangeDeclarationError(
          'core.errors.exchangeSectionDuplicate',
          { key: section.key },
        );
      }
      sections.set(section.key, section);
    }
  }
  for (const section of sections.values()) {
    for (const rootType of section.roots) {
      if (!rootTypes.has(rootType)) {
        throw new ExchangeDeclarationError('core.errors.exchangeUnknownRoot', {
          key: section.key,
          rootType,
        });
      }
    }
    for (const dep of [
      ...(section.dependsOn ?? []),
      ...(section.runAfter ?? []),
    ]) {
      if (!sections.has(dep)) {
        throw new ExchangeDeclarationError(
          'core.errors.exchangeUnknownDependency',
          { key: section.key, dep },
        );
      }
    }
    if (!input.providerKeys.has(section.key)) {
      throw new ExchangeDeclarationError(
        'core.errors.exchangeProviderMissing',
        { key: section.key },
      );
    }
  }
  for (const key of input.providerKeys) {
    if (!sections.has(key)) {
      throw new ExchangeDeclarationError(
        'core.errors.exchangeDeclarationMissing',
        { key },
      );
    }
  }
  // Every root needs exactly one isRoot section; a cycle check runs per root
  // over its section subset.
  for (const rootType of rootTypes) {
    const rootSections = [...sections.values()].filter((s) =>
      s.roots.includes(rootType),
    );
    const core = rootSections.filter((s) => s.isRoot);
    if (core.length !== 1) {
      throw new ExchangeDeclarationError(
        'core.errors.exchangeRootSectionCount',
        { rootType, count: core.length },
      );
    }
    orderExchangeSections(
      rootSections.map((section) => ({
        pluginId: section.key.split('.')[0],
        section,
      })),
    );
  }
}

// In-memory registry of section providers. Plugins register in
// `onModuleInit()`; the exchange plugin reads the enabled set (a disabled
// plugin's sections vanish from export and are rejected in import preview).
@Injectable()
export class ExchangeRegistryService {
  private readonly logger = new Logger(ExchangeRegistryService.name);
  private readonly providers = new Map<string, RegisteredExchangeProvider>();

  constructor(
    private readonly pluginConfig: PluginConfigService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  registerSectionProvider(
    pluginId: string,
    provider: ExchangeSectionProvider,
  ): void {
    if (this.providers.has(provider.sectionKey)) {
      this.logger.warn(
        `Exchange section "${provider.sectionKey}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.providers.set(provider.sectionKey, { pluginId, provider });
  }

  getProvider(sectionKey: string): ExchangeSectionProvider | null {
    return this.providers.get(sectionKey)?.provider ?? null;
  }

  getProviderKeys(): ReadonlySet<string> {
    return new Set(this.providers.keys());
  }

  // All declarations across registered manifests, for validation and the
  // orchestrator's root/section catalogue.
  getDeclarations(): {
    pluginId: string;
    declaration: PluginExchangeDeclaration;
  }[] {
    return this.pluginRegistry
      .getPlugins()
      .filter(
        (m): m is typeof m & { exchange: PluginExchangeDeclaration } =>
          m.exchange !== undefined,
      )
      .map((m) => ({ pluginId: m.id, declaration: m.exchange }));
  }

  // Roots of currently-enabled plugins.
  getEnabledRoots(): DeclaredExchangeRoot[] {
    return this.getDeclarations()
      .filter(({ pluginId }) => this.pluginConfig.isEnabled(pluginId))
      .flatMap(({ pluginId, declaration }) =>
        (declaration.roots ?? []).map((root) => ({ pluginId, root })),
      );
  }

  // Sections of currently-enabled plugins contributing to the given root type.
  getEnabledSections(rootType: string): DeclaredExchangeSection[] {
    return this.getDeclarations()
      .filter(({ pluginId }) => this.pluginConfig.isEnabled(pluginId))
      .flatMap(({ pluginId, declaration }) =>
        declaration.sections
          .filter((section) => section.roots.includes(rootType))
          .map((section) => ({ pluginId, section })),
      );
  }

  // All declared sections for a root regardless of enable state — the import
  // preview uses this to tell "unknown section" apart from "plugin disabled".
  getAllSections(rootType: string): DeclaredExchangeSection[] {
    return this.getDeclarations().flatMap(({ pluginId, declaration }) =>
      declaration.sections
        .filter((section) => section.roots.includes(rootType))
        .map((section) => ({ pluginId, section })),
    );
  }
}
