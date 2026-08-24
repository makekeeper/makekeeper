import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AppConfigService,
  CapabilityRegistryService,
  ExchangeRegistryService,
  ExchangeSectionProvider,
  PluginConfigService,
  PluginI18nService,
  PluginRegistryService,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type {
  PluginManifest,
  ScopeDirectoryCapability,
} from '@makekeeper/plugin-contract';
import {
  EXCHANGE_INSTANCE_ROOT,
  EXCHANGE_SCOPE_ROOT,
  SCOPE_DIRECTORY_CAPABILITY,
} from '@makekeeper/plugin-contract';
import { ExchangeService } from './exchange.service';
import { ExchangeImportStore } from './import-store';

// Framework round-trip with a purely synthetic plugin — proves export →
// inspect → execute works end-to-end with no real data plugin involved.

interface SynthRecord {
  id: string;
  name: string;
}

const synthManifest: PluginManifest = {
  id: 'synth',
  nameKey: 'plugins.synth.name',
  descriptionKey: 'plugins.synth.description',
  version: '9.9.9',
  icon: 'Box',
  navigation: [],
  exchange: {
    roots: [
      {
        kind: 'entity',
        entityType: 'thing',
        labelKey: 'synth.root',
        icon: 'Box',
      },
    ],
    sections: [
      {
        key: 'synth.thing',
        labelKey: 'synth.thing',
        roots: ['thing'],
        isRoot: true,
      },
      {
        key: 'synth.notes',
        labelKey: 'synth.notes',
        roots: ['thing'],
        dependsOn: ['synth.thing'],
        hasFiles: true,
        importOptions: [
          { key: 'mode', labelKey: 'synth.mode', type: 'select' },
        ],
      },
    ],
  },
};

describe('ExchangeService (synthetic round-trip)', () => {
  let dir: string;
  let service: ExchangeService;
  let store: ExchangeImportStore;
  let imported: {
    thing: SynthRecord[];
    notes: SynthRecord[];
    options: unknown;
  };
  let importedFiles: Record<string, Uint8Array | null>;
  let disabledPlugins: Set<string>;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'exchange-spec-'));
    process.env.UPLOADS_DIR = dir;
    imported = { thing: [], notes: [], options: null };
    importedFiles = {};
    disabledPlugins = new Set();

    const pluginRegistry = new PluginRegistryService();
    pluginRegistry.register(synthManifest);
    const pluginConfig = {
      isEnabled: (id: string) => !disabledPlugins.has(id),
    } as unknown as PluginConfigService;
    const registry = new ExchangeRegistryService(pluginConfig, pluginRegistry);

    const thingProvider: ExchangeSectionProvider = {
      sectionKey: 'synth.thing',
      exportSection: async (ctx) => {
        ctx.addExportedRef('mk://synth/thing/t1');
        return { records: [{ id: 't1', name: 'root thing' }] };
      },
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records) => {
        for (const r of records as SynthRecord[]) {
          imported.thing.push(r);
        }
        return { created: records.length, rootRef: 'mk://synth/thing/new-t1' };
      },
    };
    const notesProvider: ExchangeSectionProvider = {
      sectionKey: 'synth.notes',
      exportSection: async (ctx) => {
        // Sees the root's refs because dependsOn orders it after synth.thing.
        expect(ctx.getExportedRefs()).toContain('mk://synth/thing/t1');
        await ctx.files.putFile('note-1.bin', new Uint8Array([1, 2, 3]));
        return { records: [{ id: 'n1', name: 'note' }] };
      },
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records, ctx) => {
        imported.options = ctx.options;
        importedFiles['note-1.bin'] = await ctx.files.readFile('note-1.bin');
        for (const r of records as SynthRecord[]) {
          imported.notes.push(r);
        }
        return { created: records.length };
      },
    };
    registry.registerSectionProvider('synth', thingProvider);
    registry.registerSectionProvider('synth', notesProvider);

    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<void>) => fn({}),
    } as unknown as PrismaService;
    const config = new AppConfigService();
    store = new ExchangeImportStore(config);
    // An empty i18n registry resolves every key to itself, so error-message
    // assertions below keep matching on the key.
    service = new ExchangeService(
      registry,
      pluginRegistry,
      prisma,
      config,
      store,
      new RequestContextService(),
      new PluginI18nService(),
      new CapabilityRegistryService(pluginConfig),
    );
  });

  afterEach(async () => {
    store.onModuleDestroy();
    delete process.env.UPLOADS_DIR;
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('exposes the synthetic root and sections in the catalog', () => {
    const catalog = service.getCatalog();
    expect(catalog.roots.map((r) => r.entityType)).toContain('thing');
    expect(catalog.sectionsByRoot['thing'].map((s) => s.key)).toEqual([
      'synth.thing',
      'synth.notes',
    ]);
  });

  it('round-trips export → inspect → execute', async () => {
    const exported = await service.exportArchive(
      'thing',
      't1',
      undefined,
      false,
      'en',
    );
    const preview = await service.inspectImport(exported.path, 'en');
    expect(preview.rootType).toBe('thing');
    expect(preview.sections).toHaveLength(2);
    expect(preview.sections.every((s) => s.available)).toBe(true);

    const result = await service.executeImport(
      preview.token,
      ['synth.thing', 'synth.notes'],
      { 'synth.notes': { mode: 'merge' } },
      'en',
    );
    expect(result.rootRef).toBe('mk://synth/thing/new-t1');
    expect(imported.thing).toEqual([{ id: 't1', name: 'root thing' }]);
    expect(imported.notes).toEqual([{ id: 'n1', name: 'note' }]);
    expect(imported.options).toEqual({ mode: 'merge' });
    expect(importedFiles['note-1.bin']).toEqual(Buffer.from([1, 2, 3]));
    // Token is single-use.
    await expect(
      service.executeImport(preview.token, ['synth.thing'], {}, 'en'),
    ).rejects.toThrow();
    await exported.cleanup();
  });

  it('drops an unselected dependent section but keeps the forced root', async () => {
    const exported = await service.exportArchive(
      'thing',
      't1',
      ['synth.thing'],
      false,
      'en',
    );
    const preview = await service.inspectImport(exported.path, 'en');
    expect(preview.sections.map((s) => s.key)).toEqual(['synth.thing']);
    const result = await service.executeImport(preview.token, [], {}, 'en');
    expect(result.sections).toEqual([{ key: 'synth.thing', created: 1 }]);
    expect(imported.notes).toEqual([]);
    await exported.cleanup();
  });

  it('marks sections of a disabled plugin unavailable in the preview', async () => {
    const exported = await service.exportArchive(
      'thing',
      't1',
      undefined,
      false,
      'en',
    );
    // Simulate the archive arriving at an instance where a SECOND plugin owns
    // one section and is disabled: disable synth entirely → root unavailable.
    disabledPlugins.add('synth');
    await expect(service.inspectImport(exported.path, 'en')).rejects.toThrow(
      /rootUnavailable/,
    );
    await exported.cleanup();
  });

  it('rejects a malformed archive', async () => {
    const bogus = join(dir, 'bogus.mkx');
    await fsp.writeFile(bogus, Buffer.from('not a zip at all'));
    await expect(service.inspectImport(bogus, 'en')).rejects.toThrow(
      /archiveMalformed/,
    );
  });

  it('rejects an unknown selected section on export', async () => {
    await expect(
      service.exportArchive('thing', 't1', ['synth.ghost'], false, 'en'),
    ).rejects.toThrow(/unknownSection/);
  });
});

// Hardening: multiuser-scope stamping, instance-root admin gating and the
// fresh-instance precondition — a second synthetic plugin declares the
// built-in instance dataset root so the gates are reachable without any real
// data plugin.

const instManifest: PluginManifest = {
  id: 'inst',
  nameKey: 'plugins.inst.name',
  descriptionKey: 'plugins.inst.description',
  version: '1.0.0',
  icon: 'Box',
  navigation: [],
  exchange: {
    roots: [
      {
        kind: 'dataset',
        entityType: EXCHANGE_INSTANCE_ROOT,
        labelKey: 'inst.root',
        icon: 'Box',
      },
      {
        kind: 'dataset',
        entityType: EXCHANGE_SCOPE_ROOT,
        labelKey: 'inst.scopeRoot',
        icon: 'Box',
      },
    ],
    sections: [
      {
        key: 'inst.data',
        labelKey: 'inst.data',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        isRoot: true,
      },
      {
        key: 'inst.extra',
        labelKey: 'inst.extra',
        roots: [EXCHANGE_INSTANCE_ROOT],
      },
      {
        key: 'inst.secrets',
        labelKey: 'inst.secrets',
        roots: [EXCHANGE_INSTANCE_ROOT, EXCHANGE_SCOPE_ROOT],
        sensitive: true,
      },
    ],
  },
};

describe('ExchangeService (hardening)', () => {
  let dir: string;
  let service: ExchangeService;
  let store: ExchangeImportStore;
  let requestContext: RequestContextService;
  let observedScopeIds: (string | null)[];
  let importedInst: string[];
  let extraExistingRows: number;
  let exportedSections: string[];
  let scopeExists: boolean;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'exchange-hard-spec-'));
    process.env.UPLOADS_DIR = dir;
    observedScopeIds = [];
    importedInst = [];
    extraExistingRows = 0;
    exportedSections = [];
    scopeExists = true;

    const pluginRegistry = new PluginRegistryService();
    pluginRegistry.register(synthManifest);
    pluginRegistry.register(instManifest);
    const pluginConfig = {
      isEnabled: () => true,
    } as unknown as PluginConfigService;
    const registry = new ExchangeRegistryService(pluginConfig, pluginRegistry);

    const thingProvider: ExchangeSectionProvider = {
      sectionKey: 'synth.thing',
      exportSection: async () => ({
        records: [{ id: 't1', name: 'root thing' }],
      }),
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records, ctx) => {
        observedScopeIds.push(ctx.scopeId);
        return { created: records.length };
      },
    };
    const notesProvider: ExchangeSectionProvider = {
      sectionKey: 'synth.notes',
      exportSection: async () => ({ records: [{ id: 'n1', name: 'note' }] }),
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records, ctx) => {
        observedScopeIds.push(ctx.scopeId);
        return { created: records.length };
      },
    };
    const instDataProvider: ExchangeSectionProvider = {
      sectionKey: 'inst.data',
      exportSection: async () => {
        // The scope-export tests assert the section provider ran under the
        // target scope's request context, not the admin caller's.
        exportedSections.push('inst.data');
        observedScopeIds.push(requestContext.get()?.scopeId ?? null);
        return { records: [{ id: 'd1' }] };
      },
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records) => {
        importedInst.push('inst.data');
        return { created: records.length };
      },
      countExistingRows: async () => 0,
    };
    const instExtraProvider: ExchangeSectionProvider = {
      sectionKey: 'inst.extra',
      exportSection: async () => ({ records: [] }),
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records) => {
        importedInst.push('inst.extra');
        return { created: records.length };
      },
      countExistingRows: async () => extraExistingRows,
    };
    const instSecretsProvider: ExchangeSectionProvider = {
      sectionKey: 'inst.secrets',
      exportSection: async () => {
        exportedSections.push('inst.secrets');
        return { records: [{ id: 's1' }] };
      },
      inspectSection: async (records) => ({ count: records.length }),
      importSection: async (records) => ({ created: records.length }),
      countExistingRows: async () => 0,
    };
    registry.registerSectionProvider('synth', thingProvider);
    registry.registerSectionProvider('synth', notesProvider);
    registry.registerSectionProvider('inst', instDataProvider);
    registry.registerSectionProvider('inst', instExtraProvider);
    registry.registerSectionProvider('inst', instSecretsProvider);

    const capabilityRegistry = new CapabilityRegistryService(pluginConfig);
    capabilityRegistry.registerCapability<ScopeDirectoryCapability>(
      'inst',
      SCOPE_DIRECTORY_CAPABILITY,
      { scopeExists: async () => scopeExists },
    );

    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<void>) => fn({}),
    } as unknown as PrismaService;
    const config = new AppConfigService();
    store = new ExchangeImportStore(config);
    requestContext = new RequestContextService();
    service = new ExchangeService(
      registry,
      pluginRegistry,
      prisma,
      config,
      store,
      requestContext,
      new PluginI18nService(),
      capabilityRegistry,
    );
  });

  afterEach(async () => {
    store.onModuleDestroy();
    delete process.env.UPLOADS_DIR;
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('stamps the request scope into the import context', async () => {
    const exported = await service.exportArchive(
      'thing',
      't1',
      undefined,
      false,
      'en',
    );
    const preview = await service.inspectImport(exported.path, 'en');
    await requestContext.run({ userId: 'u1', scopeId: 'scope-1' }, () =>
      service.executeImport(
        preview.token,
        ['synth.thing', 'synth.notes'],
        {},
        'en',
      ),
    );
    expect(observedScopeIds).toEqual(['scope-1', 'scope-1']);
    await exported.cleanup();
  });

  it('rejects instance export and import for a non-admin user', async () => {
    await expect(
      requestContext.run({ userId: 'u1', isAdmin: false }, () =>
        service.exportArchive(
          EXCHANGE_INSTANCE_ROOT,
          null,
          undefined,
          false,
          'en',
        ),
      ),
    ).rejects.toThrow(/adminOnly/);

    // Export as unauthenticated (single-user mode) to obtain a valid archive,
    // then inspect it as a non-admin: same gate on the import side.
    const exported = await service.exportArchive(
      EXCHANGE_INSTANCE_ROOT,
      null,
      undefined,
      false,
      'en',
    );
    await expect(
      requestContext.run({ userId: 'u1', isAdmin: false }, () =>
        service.inspectImport(exported.path, 'en'),
      ),
    ).rejects.toThrow(/adminOnly/);
    await exported.cleanup();
  });

  it('runs a scope export under the target scope with secrets forced off', async () => {
    const exported = await requestContext.run(
      { userId: 'admin-1', isAdmin: true, scopeId: 'admin-1' },
      () =>
        // `includeSecrets: true` on purpose — the scope root must force it off.
        service.exportArchive(
          EXCHANGE_SCOPE_ROOT,
          'user-1',
          undefined,
          true,
          'en',
        ),
    );
    expect(observedScopeIds).toEqual(['user-1']);
    expect(exportedSections).toContain('inst.data');
    expect(exportedSections).not.toContain('inst.secrets');
    await exported.cleanup();
  });

  it('rejects a scope export without a target scope id', async () => {
    await expect(
      service.exportArchive(EXCHANGE_SCOPE_ROOT, null, undefined, false, 'en'),
    ).rejects.toThrow(/rootNotFound/);
  });

  it('rejects a scope export when the scope directory does not know the id', async () => {
    scopeExists = false;
    await expect(
      service.exportArchive(
        EXCHANGE_SCOPE_ROOT,
        'ghost',
        undefined,
        false,
        'en',
      ),
    ).rejects.toThrow(/unknownScope/);
    expect(exportedSections).toEqual([]);
  });

  it('rejects an instance import into a non-empty instance even for an unselected section', async () => {
    const exported = await service.exportArchive(
      EXCHANGE_INSTANCE_ROOT,
      null,
      undefined,
      false,
      'en',
    );
    const preview = await service.inspectImport(exported.path, 'en');
    // Only the forced root section is selected; the non-selected extra section
    // reports pre-existing rows — the precondition must still trip.
    extraExistingRows = 5;
    await expect(
      service.executeImport(preview.token, [], {}, 'en'),
    ).rejects.toThrow(/instanceNotEmpty/);
    expect(importedInst).toEqual([]);
    await exported.cleanup();
  });
});
