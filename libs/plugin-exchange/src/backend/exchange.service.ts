import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { promises as fsp } from 'fs';
import { join } from 'path';
import {
  AppConfigService,
  CapabilityRegistryService,
  DeclaredExchangeSection,
  ExchangeDeclarationError,
  ExchangeExportContext,
  ExchangeFileSource,
  ExchangeIdMap,
  ExchangeImportContext,
  ExchangeRegistryService,
  ExchangeRootRef,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
  RequestContextService,
  generateUuid,
  getErrorMessage,
  orderExchangeSections,
  validateExchangeDeclarations,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_DEFERRED_EXCHANGE_CAPABILITY,
  type ExternalDeferredExchangeCapability,
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  ExchangeOptionValues,
  SCOPE_DIRECTORY_CAPABILITY,
  ScopeDirectoryCapability,
} from '@makekeeper/plugin-contract';
import {
  MK_ARCHIVE_EXTENSION,
  MK_FORMAT_VERSION,
  MkArchiveError,
  MkSectionMeta,
  MkWriter,
  extractMk,
  readExtractedSection,
  readExtractedSectionFile,
} from './archive';
import { ExchangeImportStore } from './import-store';
import type {
  ExchangeCatalog,
  ExchangeCatalogSection,
  ExchangeImportPreview,
  ExchangeImportPreviewSection,
  ExchangeImportResult,
} from '../exchange-types';

// Orchestrates export/import runs over the declarations and providers other
// plugins registered (#62). Deliberately entity-blind: this service only ever
// speaks root entity types and section keys — the concrete data logic lives in
// each owning plugin's `ExchangeSectionProvider`.

// How long one import transaction may run. Instance restores move whole
// tables, so this is generous; entity imports finish far earlier.
const IMPORT_TX_TIMEOUT_MS = 10 * 60 * 1000;
const IMPORT_TX_MAX_WAIT_MS = 30 * 1000;

const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_SECTION_JSON_BYTES = 256 * 1024 * 1024;

@Injectable()
export class ExchangeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private readonly registry: ExchangeRegistryService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly store: ExchangeImportStore,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  // The external-plugin parking capability, or null when no external host is
  // installed — in which case an unrecognized section behaves exactly as it
  // always did (skipped), which is what keeps this plugin independent (§5.10).
  private deferredExchange(): ExternalDeferredExchangeCapability | null {
    return this.capabilities.getCapability<ExternalDeferredExchangeCapability>(
      EXTERNAL_DEFERRED_EXCHANGE_CAPABILITY,
    );
  }

  // Fail-loud consistency check between every manifest's `exchange` block and
  // the providers actually registered — after ALL plugin modules initialized.
  // Declaration errors carry an i18n key + params; resolve them here so the
  // startup log names the offending section.
  onApplicationBootstrap(): void {
    try {
      validateExchangeDeclarations({
        declarations: this.registry.getDeclarations(),
        providerKeys: this.registry.getProviderKeys(),
      });
    } catch (err) {
      if (err instanceof ExchangeDeclarationError) {
        throw new Error(this.i18n.t(err.key, err.params));
      }
      throw err;
    }
  }

  // ── Catalog ───────────────────────────────────────────────────────────────

  getCatalog(): ExchangeCatalog {
    // The scope root is admin-internal (driven by the users admin view, not the
    // export wizard) and needs a target scope id the wizard can't supply — so
    // it never appears in the public catalog.
    const roots = this.registry
      .getEnabledRoots()
      .filter(({ root }) => root.entityType !== EXCHANGE_SCOPE_ROOT);
    const sectionsByRoot: Record<string, ExchangeCatalogSection[]> = {};
    for (const { root } of roots) {
      sectionsByRoot[root.entityType] = this.registry
        .getEnabledSections(root.entityType)
        .map(({ pluginId, section }) => ({
          key: section.key,
          pluginId,
          labelKey: section.labelKey,
          descriptionKey: section.descriptionKey,
          dependsOn: section.dependsOn ?? [],
          isRoot: section.isRoot ?? false,
          hasFiles: section.hasFiles ?? false,
          sensitive: section.sensitive ?? false,
          defaultSelected: section.defaultSelected ?? true,
          importOptions: section.importOptions,
        }));
    }
    return {
      roots: roots.map(({ pluginId, root }) => ({
        entityType: root.entityType,
        kind: root.kind,
        labelKey: root.labelKey,
        icon: root.icon,
        pluginId,
      })),
      sectionsByRoot,
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async exportArchive(
    rootType: string,
    rootId: string | null,
    selectedKeys: string[] | undefined,
    includeSecrets: boolean,
    locale: string,
  ): Promise<{ path: string; filename: string; cleanup: () => Promise<void> }> {
    const rootDecl = this.registry
      .getEnabledRoots()
      .find((r) => r.root.entityType === rootType);
    if (!rootDecl) {
      throw new NotFoundException(
        this.msg('exchange.errors.rootUnavailable', locale),
      );
    }
    if (rootDecl.root.kind === 'entity' && !rootId) {
      throw new BadRequestException(
        this.msg('exchange.errors.rootNotFound', locale),
      );
    }
    // The scope root carries the target scope id in `rootId`; it is admin-only
    // (guards the public /export endpoint too) and never carries secrets.
    if (rootType === EXCHANGE_SCOPE_ROOT && !rootId) {
      throw new BadRequestException(
        this.msg('exchange.errors.rootNotFound', locale),
      );
    }
    if (
      rootType === EXCHANGE_INSTANCE_ROOT ||
      rootType === EXCHANGE_SCOPE_ROOT
    ) {
      this.assertAdmin(locale);
    }
    // The target scope must name a real account — otherwise the export would
    // silently produce an empty archive. Validated through the multiuser
    // capability; unresolvable (overlay absent/disabled) means there is no
    // scope directory to check against.
    if (rootType === EXCHANGE_SCOPE_ROOT && rootId) {
      const scopes = this.capabilities.getCapability<ScopeDirectoryCapability>(
        SCOPE_DIRECTORY_CAPABILITY,
      );
      if (scopes && !(await scopes.scopeExists(rootId))) {
        throw new NotFoundException(
          this.msg('exchange.errors.unknownScope', locale),
        );
      }
    }
    // Secrets only ever leave through the instance root's explicit toggle.
    const allowSecrets = includeSecrets && rootType === EXCHANGE_INSTANCE_ROOT;

    const available = this.registry.getEnabledSections(rootType);
    const availableKeys = new Set(available.map((s) => s.section.key));
    for (const key of selectedKeys ?? []) {
      if (!availableKeys.has(key)) {
        throw new BadRequestException(
          this.msg('exchange.errors.unknownSection', locale, { key }),
        );
      }
    }
    const chosen = available.filter(
      ({ section }) =>
        (section.isRoot ||
          !selectedKeys ||
          selectedKeys.includes(section.key)) &&
        (allowSecrets || !section.sensitive),
    );
    this.assertDependencies(chosen, locale);
    const ordered = orderExchangeSections(chosen);

    await fsp.mkdir(this.store.tmpRoot(), { recursive: true });
    const outPath = join(
      this.store.tmpRoot(),
      `exp_${generateUuid()}${MK_ARCHIVE_EXTENSION}`,
    );
    const writer = new MkWriter(outPath);
    const cleanup = async (): Promise<void> => {
      await fsp.rm(outPath, { force: true }).catch((err) => {
        this.logger.warn(`Export cleanup failed: ${getErrorMessage(err)}`);
      });
    };
    try {
      const root: ExchangeRootRef = { entityType: rootType, entityId: rootId };
      const selectedSet = new Set(chosen.map((s) => s.section.key));
      const exportedRefs: string[] = [];
      const sectionsMeta: MkSectionMeta[] = [];
      // Instance export dumps EVERY scope's data — the admin-gated full
      // backup must not be narrowed to the admin's own scope.
      const runExport = async (): Promise<void> => {
        for (const { pluginId, section } of ordered) {
          const provider = this.registry.getProvider(section.key);
          if (!provider) {
            throw new NotFoundException(
              this.msg('exchange.errors.unknownSection', locale, {
                key: section.key,
              }),
            );
          }
          const ctx: ExchangeExportContext = {
            root,
            locale,
            selectedSections: selectedSet,
            includeSecrets: allowSecrets,
            addExportedRef: (ref) => {
              exportedRefs.push(ref);
            },
            getExportedRefs: () => exportedRefs,
            files: {
              putFile: (fileId, data) => {
                writer.addFile(section.key, fileId, data);
                return Promise.resolve();
              },
              putFileFromPath: (fileId, absPath) => {
                writer.addFileFromPath(section.key, fileId, absPath);
                return Promise.resolve();
              },
            },
          };
          const payload = await provider.exportSection(ctx);
          writer.addSection(section.key, payload.records);
          sectionsMeta.push({
            key: section.key,
            pluginId,
            pluginVersion:
              this.pluginRegistry.getPlugin(pluginId)?.version ?? '0.0.0',
            count: payload.records.length,
            hasFiles: section.hasFiles ?? false,
          });
        }
      };
      await this.localizeErrors(locale, () => {
        if (rootType === EXCHANGE_INSTANCE_ROOT) {
          // Whole-database dump: scope enforcement suspended.
          return this.requestContext.runWithoutScope('exchange', runExport);
        }
        if (rootType === EXCHANGE_SCOPE_ROOT && rootId) {
          // One user's workspace: run AS that scope so the policy narrows every
          // section's queries to it (secrets already forced off above).
          return this.requestContext.runWithScope(rootId, runExport);
        }
        return runExport();
      });
      await writer.finalize({
        formatVersion: MK_FORMAT_VERSION,
        rootType,
        rootId,
        exportedAt: new Date().toISOString(),
        exportId: generateUuid(),
        sections: sectionsMeta,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      return {
        path: outPath,
        filename: `${rootType}-${stamp}${MK_ARCHIVE_EXTENSION}`,
        cleanup,
      };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  // ── Import: inspect ───────────────────────────────────────────────────────

  async inspectImport(
    zipPath: string,
    locale: string,
  ): Promise<ExchangeImportPreview> {
    const { token, dir } = await this.store.createDir();
    try {
      const { manifest, sectionKeys } = await extractMk(zipPath, dir, {
        maxEntries: MAX_ARCHIVE_ENTRIES,
        maxJsonBytes: MAX_SECTION_JSON_BYTES,
        maxTotalBytes: this.config.getExchangeUploadLimitBytes() * 4,
      });
      const rootEnabled = this.registry
        .getEnabledRoots()
        .some((r) => r.root.entityType === manifest.rootType);
      if (!rootEnabled) {
        throw new BadRequestException(
          this.msg('exchange.errors.rootUnavailable', locale),
        );
      }
      if (manifest.rootType === EXCHANGE_INSTANCE_ROOT)
        this.assertAdmin(locale);
      const declared = new Map(
        this.registry
          .getAllSections(manifest.rootType)
          .map((s) => [s.section.key, s]),
      );
      const enabled = new Set(
        this.registry
          .getEnabledSections(manifest.rootType)
          .map((s) => s.section.key),
      );
      const root: ExchangeRootRef = {
        entityType: manifest.rootType,
        entityId: manifest.rootId,
      };
      const sections: ExchangeImportPreviewSection[] = [];
      const importable: string[] = [];
      for (const key of sectionKeys) {
        const meta = manifest.sections.find((s) => s.key === key);
        const decl = declared.get(key);
        if (!decl) {
          // A section owned by an EXTERNAL plugin that is not installed is not
          // "unknown" — it is known to belong to someone, and its data will be
          // kept rather than skipped (#138). Telling the admin which plugin is
          // missing is the whole point; silently dropping it is not an option.
          const externalOwner =
            this.deferredExchange()?.ownerOfSection(key) ?? null;
          sections.push({
            key,
            count: meta?.count ?? 0,
            available: false,
            pluginId: externalOwner ?? undefined,
            warningKeys: [
              externalOwner
                ? 'exchange.warnings.externalPluginMissing'
                : 'exchange.warnings.unknownSection',
            ],
          });
          continue;
        }
        if (!enabled.has(key)) {
          sections.push({
            key,
            count: meta?.count ?? 0,
            available: false,
            warningKeys: ['exchange.warnings.pluginDisabled'],
            labelKey: decl.section.labelKey,
            pluginId: decl.pluginId,
          });
          continue;
        }
        const provider = this.registry.getProvider(key);
        const records = (await readExtractedSection(dir, key)) ?? [];
        const preview = provider
          ? await provider.inspectSection(records, { root, locale })
          : { count: records.length };
        importable.push(key);
        sections.push({
          key,
          count: preview.count,
          available: true,
          warningKeys: preview.warningKeys ?? [],
          labelKey: decl.section.labelKey,
          pluginId: decl.pluginId,
          isRoot: decl.section.isRoot ?? false,
          dependsOn: decl.section.dependsOn ?? [],
          importOptions: decl.section.importOptions,
        });
      }
      this.store.put({ token, dir, manifest, importableSections: importable });
      return {
        token,
        rootType: manifest.rootType,
        rootId: manifest.rootId,
        exportedAt: manifest.exportedAt,
        sections,
      };
    } catch (err) {
      await fsp
        .rm(dir, { recursive: true, force: true })
        .catch(() => undefined);
      if (err instanceof MkArchiveError) {
        throw new BadRequestException(this.msg(err.errorKey, locale));
      }
      throw err;
    }
  }

  // ── Import: execute ───────────────────────────────────────────────────────

  async executeImport(
    token: string,
    selectedKeys: string[],
    optionsBySection: Record<string, ExchangeOptionValues>,
    locale: string,
  ): Promise<ExchangeImportResult> {
    const entry = this.store.get(token);
    if (!entry) {
      throw new NotFoundException(
        this.msg('exchange.errors.importNotFound', locale),
      );
    }
    const rootType = entry.manifest.rootType;
    if (rootType === EXCHANGE_INSTANCE_ROOT) this.assertAdmin(locale);
    const importable = new Set(entry.importableSections);
    for (const key of selectedKeys) {
      if (!importable.has(key)) {
        throw new BadRequestException(
          this.msg('exchange.errors.unknownSection', locale, { key }),
        );
      }
    }
    const chosen = this.registry
      .getEnabledSections(rootType)
      .filter(
        ({ section }) =>
          importable.has(section.key) &&
          (section.isRoot || selectedKeys.includes(section.key)),
      );
    this.assertDependencies(chosen, locale, importable);
    const ordered = orderExchangeSections(chosen);

    const root: ExchangeRootRef = {
      entityType: rootType,
      entityId: entry.manifest.rootId,
    };
    const idMap = new ExchangeIdMap();
    const scopeId = this.requestContext.get()?.scopeId ?? null;
    const selectedSet = new Set(chosen.map((s) => s.section.key));
    const preserveIds = rootType === EXCHANGE_INSTANCE_ROOT;
    const results: { key: string; created: number }[] = [];
    let rootRef: string | null = null;

    const runImport = (): Promise<void> =>
      this.prisma.$transaction(
        async (tx) => {
          // Fresh-instance precondition over EVERY enabled instance section —
          // selected or not — so deselecting a section cannot smuggle a
          // restore into a non-empty instance ("no rows in any exchanged
          // model"; sanctioned day-one state is excluded by each provider).
          if (preserveIds) {
            for (const { section } of this.registry.getEnabledSections(
              EXCHANGE_INSTANCE_ROOT,
            )) {
              const provider = this.registry.getProvider(section.key);
              const existing = (await provider?.countExistingRows?.(tx)) ?? 0;
              if (existing > 0) {
                throw new BadRequestException(
                  this.msg('exchange.errors.instanceNotEmpty', locale),
                );
              }
            }
          }
          // Sections in the archive that no installed plugin owns: if an
          // external plugin owns the key, its bytes are parked for when that
          // plugin arrives (#138) — "import first, install later" is the
          // normal restore order, so losing the data here would be a real bug.
          const deferred = this.deferredExchange();
          if (deferred) {
            for (const key of entry.manifest.sections.map((s) => s.key)) {
              if (this.registry.getProvider(key)) continue;
              const owner = deferred.ownerOfSection(key);
              if (!owner) continue;
              const blob = await readExtractedSectionFile(
                entry.dir,
                key,
                'blob.bin',
              );
              if (blob) await deferred.deferBlock(owner, blob, scopeId);
            }
          }
          for (const { section } of ordered) {
            const provider = this.registry.getProvider(section.key);
            if (!provider) continue;
            const records =
              (await readExtractedSection(entry.dir, section.key)) ?? [];
            const ctx: ExchangeImportContext = {
              root,
              tx,
              scopeId,
              locale,
              selectedSections: selectedSet,
              idMap,
              options: this.sanitizeOptions(
                section.importOptions,
                optionsBySection[section.key],
              ),
              preserveIds,
              files: this.fileSource(entry.dir, section.key),
            };
            const result = await provider.importSection(records, ctx);
            results.push({ key: section.key, created: result.created });
            if (section.isRoot && result.rootRef) rootRef = result.rootRef;
          }
        },
        { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS },
      );
    // Every import runs with scope enforcement suspended: the policy's
    // parent-FK checks re-query through the MAIN client and cannot see rows
    // created inside this transaction. Providers compensate explicitly —
    // they stamp `scopeId: ctx.scopeId` on scoped models and filter their
    // match/target lookups by it. (Instance restores additionally write the
    // archive's scopeIds verbatim.)
    await this.localizeErrors(locale, () =>
      this.requestContext.runWithoutScope('exchange', runImport),
    );
    await this.store.remove(token);
    return { rootRef, sections: results };
  }

  // Whole-database (instance) and per-scope surfaces are admin-only while the
  // multiuser overlay is active (no request user ⇒ single-user mode ⇒ allowed).
  private assertAdmin(locale: string): void {
    const ctx = this.requestContext.get();
    if (ctx?.userId && !ctx.isAdmin) {
      throw new ForbiddenException(
        this.msg('exchange.errors.adminOnly', locale),
      );
    }
  }

  async discardImport(token: string): Promise<void> {
    await this.store.remove(token);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Resolve a user-facing error key to the caller's locale at throw time —
  // `apiErrorMessage` on the frontend surfaces backend messages verbatim.
  private msg(
    key: string,
    locale: string,
    params?: Record<string, string | number>,
  ): string {
    return this.i18n.t(key, params, locale);
  }

  // Providers throw raw `exchange.errors.*` keys (they have no i18n service of
  // their own); resolve those on the way out so the toast shows prose, not a
  // key. Non-key messages and non-HTTP errors pass through untouched.
  private async localizeErrors<T>(
    locale: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof HttpException &&
        /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(err.message)
      ) {
        const resolved = this.msg(err.message, locale);
        if (resolved !== err.message) {
          throw new HttpException(resolved, err.getStatus());
        }
      }
      throw err;
    }
  }

  // Selecting a section requires its declared dependencies — unless the
  // dependency is simply absent from the run's universe (not in the archive /
  // not enabled), in which case providers drop the cross-links themselves.
  private assertDependencies(
    chosen: DeclaredExchangeSection[],
    locale: string,
    universe?: ReadonlySet<string>,
  ): void {
    const chosenKeys = new Set(chosen.map((s) => s.section.key));
    for (const { section } of chosen) {
      for (const dep of section.dependsOn ?? []) {
        const exists = universe ? universe.has(dep) : true;
        const enabled = this.registry.getProvider(dep) !== null;
        if (exists && enabled && !chosenKeys.has(dep)) {
          throw new BadRequestException(
            this.msg('exchange.errors.dependencyMissing', locale, {
              key: section.key,
              dep,
            }),
          );
        }
      }
    }
  }

  // Only declared option fields pass through, coerced to the declared type and
  // length-capped — the wire value is user input.
  private sanitizeOptions(
    declared: { key: string; type: string }[] | undefined,
    raw: ExchangeOptionValues | undefined,
  ): ExchangeOptionValues {
    const out: ExchangeOptionValues = {};
    if (!declared || !raw) return out;
    for (const field of declared) {
      const value = raw[field.key];
      if (value === undefined) continue;
      if (field.type === 'boolean' && typeof value === 'boolean') {
        out[field.key] = value;
      } else if (field.type === 'number' && typeof value === 'number') {
        out[field.key] = value;
      } else if (
        (field.type === 'string' ||
          field.type === 'select' ||
          field.type === 'secret') &&
        typeof value === 'string'
      ) {
        out[field.key] = value.slice(0, 500);
      }
    }
    return out;
  }

  private fileSource(dir: string, sectionKey: string): ExchangeFileSource {
    const base = join(dir, 'files', sectionKey);
    // fileId came out of entry-name validation on extraction, but the
    // provider echoes it back — re-guard against separators.
    const safePath = async (fileId: string): Promise<string | null> => {
      if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(fileId)) return null;
      const abs = join(base, fileId);
      try {
        await fsp.access(abs);
        return abs;
      } catch {
        return null;
      }
    };
    return {
      readFile: async (fileId: string): Promise<Uint8Array | null> => {
        const abs = await safePath(fileId);
        if (!abs) return null;
        try {
          return await fsp.readFile(abs);
        } catch {
          return null;
        }
      },
      filePath: safePath,
      listFiles: async (): Promise<string[]> => {
        try {
          return await fsp.readdir(base);
        } catch {
          return [];
        }
      },
    };
  }
}
