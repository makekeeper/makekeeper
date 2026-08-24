import { BadRequestException } from '@nestjs/common';
import { ExchangeIdMap, PluginI18nService } from '@makekeeper/backend-core';
import type {
  ExchangeExportContext,
  ExchangeImportContext,
  PrismaService,
  PrismaTransactionClient,
} from '@makekeeper/backend-core';
import type { ExchangeOptionValues } from '@makekeeper/plugin-contract';
import { createStoragesExchangeProviders } from './storages.exchange';

// storages.structure provider: breadth-first subtree export (parents before
// children, root linkage nulled), import under a new root vs an existing
// target cell, name de-collision suffix, orphan-child skip.

type MockCall = { data: Record<string, unknown> };

interface FakeStorage {
  id: string;
  parentId: string | null;
  parentRow: number | null;
  parentCol: number | null;
  name: string;
  location: string | null;
  gridRows: number | null;
  gridCols: number | null;
  gridSpans: string | null;
}

const rootStorage: FakeStorage = {
  id: 's-root',
  parentId: 's-grandparent',
  parentRow: 1,
  parentCol: 1,
  name: 'Cabinet',
  location: 'Garage',
  gridRows: 4,
  gridCols: 6,
  gridSpans: '[{"r":0,"c":0,"rs":2}]',
};
const childStorage: FakeStorage = {
  id: 's-child',
  parentId: 's-root',
  parentRow: 2,
  parentCol: 3,
  name: 'Drawer A',
  location: null,
  gridRows: 2,
  gridCols: 2,
  gridSpans: null,
};

function makeExportCtx(): { ctx: ExchangeExportContext; refs: string[] } {
  const refs: string[] = [];
  const ctx: ExchangeExportContext = {
    root: { entityType: 'storage', entityId: 's-root' },
    locale: 'en',
    selectedSections: new Set(['storages.structure']),
    includeSecrets: false,
    addExportedRef: (ref) => {
      refs.push(ref);
    },
    getExportedRefs: () => refs,
    files: {
      putFile: () => Promise.resolve(),
      putFileFromPath: () => Promise.resolve(),
    },
  };
  return { ctx, refs };
}

// findFirst serves two probes: the target lookup (where.id) and the sibling
// name-collision check (where.name) — dispatch on the where shape.
function makeTx(config: {
  target?: { id: string } | null;
  sibling?: { id: string } | null;
}): { tx: unknown; creates: MockCall[] } {
  const creates: MockCall[] = [];
  const tx = {
    storage: {
      findFirst: ({
        where,
      }: {
        where: { id?: string; name?: { equals: string } };
      }) => {
        if (where.id) return Promise.resolve(config.target ?? null);
        return Promise.resolve(config.sibling ?? null);
      },
      create: jest.fn((call: MockCall) => {
        creates.push(call);
        return Promise.resolve(call.data);
      }),
    },
  };
  return { tx, creates };
}

function makeCtx(
  tx: unknown,
  idMap: ExchangeIdMap,
  options: ExchangeOptionValues = {},
): ExchangeImportContext {
  return {
    root: { entityType: 'storage', entityId: 's-root' },
    tx: tx as PrismaTransactionClient,
    scopeId: null,
    locale: 'en',
    selectedSections: new Set(['storages.structure']),
    idMap,
    options,
    preserveIds: false,
    files: {
      readFile: () => Promise.resolve(null),
      filePath: () => Promise.resolve(null),
      listFiles: () => Promise.resolve([]),
    },
  };
}

const importRecords = [
  {
    t: 'storage',
    id: 's-root',
    parentId: null,
    parentRow: null,
    parentCol: null,
    name: 'Cabinet',
    gridRows: 4,
    gridCols: 6,
    gridSpans: '[{"r":0,"c":0,"rs":2}]',
  },
  {
    t: 'storage',
    id: 's-child',
    parentId: 's-root',
    parentRow: 2,
    parentCol: 3,
    name: 'Drawer A',
    gridRows: 2,
    gridCols: 2,
    gridSpans: null,
  },
];

describe('storages.structure provider', () => {
  const provider = createStoragesExchangeProviders(
    {} as unknown as PrismaService,
    // Empty registry resolves keys to themselves — suffix assertions match keys.
    new PluginI18nService(),
  )[0];

  it('exports the subtree breadth-first with the root linkage dropped and grids intact', async () => {
    const findMany = jest.fn(
      ({ where }: { where: { parentId: { in: string[] } } }) =>
        Promise.resolve(
          where.parentId.in.includes('s-root') ? [childStorage] : [],
        ),
    );
    const prisma = {
      storage: {
        findUnique: () => Promise.resolve(rootStorage),
        findMany,
      },
    } as unknown as PrismaService;
    const exportProvider = createStoragesExchangeProviders(
      prisma,
      new PluginI18nService(),
    )[0];
    const { ctx, refs } = makeExportCtx();
    const { records } = await exportProvider.exportSection(ctx);
    expect(records.map((r) => (r as Record<string, unknown>)['id'])).toEqual([
      's-root',
      's-child',
    ]);
    // The exported root re-anchors at import time: its parent linkage is nulled.
    expect(records[0]).toMatchObject({
      t: 'storage',
      parentId: null,
      parentRow: null,
      parentCol: null,
      name: 'Cabinet',
      gridRows: 4,
      gridCols: 6,
      gridSpans: '[{"r":0,"c":0,"rs":2}]',
    });
    expect(records[1]).toMatchObject({
      parentId: 's-root',
      parentRow: 2,
      parentCol: 3,
    });
    expect(refs).toEqual([
      'mk://storages/storage/s-root',
      'mk://storages/storage/s-child',
    ]);
  });

  it('imports as a new root and re-parents children onto fresh ids', async () => {
    const { tx, creates } = makeTx({});
    const idMap = new ExchangeIdMap();
    const result = await provider.importSection(
      importRecords,
      makeCtx(tx, idMap),
    );
    expect(result.created).toBe(2);
    const newRootId = idMap.get('storage', 's-root');
    expect(newRootId).not.toBeNull();
    expect(newRootId).not.toBe('s-root');
    expect(creates[0].data).toMatchObject({
      id: newRootId,
      name: 'Cabinet',
      parentId: null,
      parentRow: null,
      parentCol: null,
      gridRows: 4,
      gridCols: 6,
      gridSpans: '[{"r":0,"c":0,"rs":2}]',
    });
    expect(creates[1].data).toMatchObject({
      id: idMap.get('storage', 's-child'),
      parentId: newRootId,
      parentRow: 2,
      parentCol: 3,
    });
    expect(result.rootRef).toBe(`mk://storages/storage/${newRootId ?? ''}`);
  });

  it('anchors the subtree root at the target storage and cell', async () => {
    const { tx, creates } = makeTx({ target: { id: 't-1' } });
    const idMap = new ExchangeIdMap();
    await provider.importSection(
      importRecords,
      makeCtx(tx, idMap, {
        targetStorageId: 't-1',
        targetRow: 1,
        targetCol: 2,
      }),
    );
    expect(creates[0].data).toMatchObject({
      parentId: 't-1',
      parentRow: 1,
      parentCol: 2,
    });
    // Children keep their archived placement inside the subtree.
    expect(creates[1].data).toMatchObject({
      parentId: idMap.get('storage', 's-root'),
      parentRow: 2,
      parentCol: 3,
    });
  });

  it('rejects a target storage the caller cannot see', async () => {
    const { tx } = makeTx({ target: null });
    await expect(
      provider.importSection(
        importRecords,
        makeCtx(tx, new ExchangeIdMap(), { targetStorageId: 'ghost' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('suffixes the imported root name on a sibling collision (children untouched)', async () => {
    const { tx, creates } = makeTx({ sibling: { id: 'existing' } });
    await provider.importSection(
      importRecords,
      makeCtx(tx, new ExchangeIdMap()),
    );
    expect(creates[0].data['name']).toBe(
      'Cabinet storages.exchange.importedSuffix',
    );
    expect(creates[1].data['name']).toBe('Drawer A');
  });

  it('skips a child whose parent vanished from the stream', async () => {
    const { tx, creates } = makeTx({});
    const result = await provider.importSection(
      [importRecords[1]],
      makeCtx(tx, new ExchangeIdMap()),
    );
    expect(creates).toHaveLength(0);
    expect(result.created).toBe(0);
    expect(result.rootRef).toBeUndefined();
  });
});
