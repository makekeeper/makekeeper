import type { AttachmentStorageService } from '@makekeeper/backend-core';
import {
  ExchangeIdMap,
  PluginI18nService,
  isRecordObject,
} from '@makekeeper/backend-core';
import type {
  ExchangeExportContext,
  ExchangeImportContext,
  PrismaService,
  PrismaTransactionClient,
} from '@makekeeper/backend-core';
import type { ExchangeOptionValues } from '@makekeeper/plugin-contract';
import { createInventoryExchangeProviders } from './inventory.exchange';

// Inventory exchange providers: the create-new vs match-existing BOM import
// strategies (SKU first, then case-insensitive name), placement stripping on
// project export, and the opening-balance ADJUSTMENT the stock import writes.

type MockCall = { data: Record<string, unknown> };

interface FakeComponent {
  id: string;
  name: string;
  sku: string | null;
}

function makeImportCtx(
  tx: unknown,
  idMap: ExchangeIdMap,
  options: ExchangeOptionValues = {},
): ExchangeImportContext {
  return {
    root: { entityType: 'project', entityId: 'p-old' },
    tx: tx as PrismaTransactionClient,
    scopeId: null,
    locale: 'en',
    selectedSections: new Set(['inventory.components']),
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

// Component delegate whose findFirst distinguishes the SKU probe from the
// case-insensitive name probe, the way the provider issues them.
function makeComponentsTx(existing: FakeComponent[]): {
  tx: unknown;
  componentCreates: MockCall[];
  linkCreates: MockCall[];
} {
  const componentCreates: MockCall[] = [];
  const linkCreates: MockCall[] = [];
  const tx = {
    component: {
      findFirst: ({
        where,
      }: {
        where: { sku?: string; name?: { equals: string } };
      }) => {
        if (where.sku) {
          return Promise.resolve(
            existing.find((c) => c.sku === where.sku) ?? null,
          );
        }
        const name = where.name?.equals ?? '';
        return Promise.resolve(
          existing.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
            null,
        );
      },
      create: jest.fn((call: MockCall) => {
        componentCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
    projectComponent: {
      create: jest.fn((call: MockCall) => {
        linkCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
  };
  return { tx, componentCreates, linkCreates };
}

// Items with no photographs (#218): the attachment query answers empty, so the
// service is never reached. The photo path has its own coverage below.
const NO_ATTACHMENTS = {
  resolveExistingFile: () => Promise.resolve(null),
  importFileFromPath: () =>
    Promise.reject(new Error('no attachment in this fixture')),
} as unknown as AttachmentStorageService;

const componentRecord = {
  t: 'component',
  id: 'c-old',
  name: 'Buck Converter',
  sku: 'BC-01',
  minQuantity: 5,
  unit: 'pcs',
};
const linkRecord = {
  t: 'projectComponent',
  projectId: 'p-old',
  componentId: 'c-old',
  neededQty: 4,
};

describe('inventory.components provider', () => {
  const provider = createInventoryExchangeProviders(
    {} as unknown as PrismaService,
    new PluginI18nService(),
    NO_ATTACHMENTS,
  )[0];

  it('strips placement and stock from the project export', async () => {
    const prisma = {
      attachment: { findMany: () => Promise.resolve([]) },
      projectComponent: {
        findMany: () =>
          Promise.resolve([
            {
              projectId: 'p-old',
              componentId: 'c-old',
              neededQty: 4,
              component: {
                id: 'c-old',
                name: 'Buck Converter',
                sku: 'BC-01',
                description: null,
                categoryRef: null,
                propertyValues: [],
                minQuantity: 5,
                unit: 'pcs',
                links: null,
                customFields: null,
                quantity: 12,
                storageId: 's1',
                storageRow: 1,
                storageCol: 2,
              },
            },
          ]),
      },
    } as unknown as PrismaService;
    const exportProvider = createInventoryExchangeProviders(
      prisma,
      new PluginI18nService(),
      NO_ATTACHMENTS,
    )[0];
    const refs: string[] = [];
    const ctx: ExchangeExportContext = {
      root: { entityType: 'project', entityId: 'p-old' },
      locale: 'en',
      selectedSections: new Set(['inventory.components']),
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
    const { records } = await exportProvider.exportSection(ctx);
    const component = records.find(
      (r) => (r as Record<string, unknown>)['t'] === 'component',
    ) as Record<string, unknown>;
    expect(component).toMatchObject({ id: 'c-old', name: 'Buck Converter' });
    expect(component['storageId']).toBeUndefined();
    expect(component['quantity']).toBeUndefined();
    expect(refs).toContain('mk://inventory/component/c-old');
  });

  it('create-new (default) mints a fresh zero-quantity item even when a match exists', async () => {
    const { tx, componentCreates, linkCreates } = makeComponentsTx([
      { id: 'local-1', name: 'buck converter', sku: 'BC-01' },
    ]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    const result = await provider.importSection(
      [componentRecord, linkRecord],
      makeImportCtx(tx, idMap),
    );
    expect(result.created).toBe(2);
    const newId = idMap.get('component', 'c-old');
    expect(newId).not.toBeNull();
    expect(newId).not.toBe('c-old');
    expect(componentCreates[0].data).toMatchObject({
      id: newId,
      name: 'Buck Converter',
      quantity: 0,
    });
    expect(linkCreates[0].data).toMatchObject({
      projectId: 'p-new',
      componentId: newId,
      neededQty: 4,
      reservedQty: 0,
    });
  });

  it('match-existing links by SKU without creating a duplicate', async () => {
    const { tx, componentCreates, linkCreates } = makeComponentsTx([
      { id: 'local-1', name: 'Totally different name', sku: 'BC-01' },
    ]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    const result = await provider.importSection(
      [componentRecord, linkRecord],
      makeImportCtx(tx, idMap, { strategy: 'match-existing' }),
    );
    expect(componentCreates).toHaveLength(0);
    expect(idMap.get('component', 'c-old')).toBe('local-1');
    expect(linkCreates[0].data).toMatchObject({ componentId: 'local-1' });
    // Only the link counts as created.
    expect(result.created).toBe(1);
  });

  it('match-existing falls back to a case-insensitive name match', async () => {
    const { tx, componentCreates } = makeComponentsTx([
      { id: 'local-2', name: 'BUCK CONVERTER', sku: 'OTHER-SKU' },
    ]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    await provider.importSection(
      [componentRecord, linkRecord],
      makeImportCtx(tx, idMap, { strategy: 'match-existing' }),
    );
    expect(componentCreates).toHaveLength(0);
    expect(idMap.get('component', 'c-old')).toBe('local-2');
  });

  it('folds a legacy datasheetUrl from an old archive into the links list', async () => {
    const { tx, componentCreates } = makeComponentsTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    await provider.importSection(
      [
        {
          ...componentRecord,
          links: JSON.stringify([{ label: 'Store', url: 'https://shop' }]),
          datasheetUrl: 'https://example.com/ds.pdf',
        },
        linkRecord,
      ],
      makeImportCtx(tx, idMap),
    );
    const links: unknown = JSON.parse(
      String(componentCreates[0].data['links']),
    );
    // The empty registry resolves the label key to itself.
    expect(links).toEqual([
      { label: 'Store', url: 'https://shop' },
      {
        label: 'inventory.exchange.datasheetLinkLabel',
        url: 'https://example.com/ds.pdf',
      },
    ]);
    expect(componentCreates[0].data['datasheetUrl']).toBeUndefined();
  });

  it('match-existing creates what it cannot match', async () => {
    const { tx, componentCreates } = makeComponentsTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    await provider.importSection(
      [componentRecord, linkRecord],
      makeImportCtx(tx, idMap, { strategy: 'match-existing' }),
    );
    expect(componentCreates).toHaveLength(1);
    expect(componentCreates[0].data).toMatchObject({
      name: 'Buck Converter',
      quantity: 0,
    });
  });
});

describe('inventory.stock provider', () => {
  const provider = createInventoryExchangeProviders(
    {} as unknown as PrismaService,
    // Empty registry: keys resolve to themselves, so note assertions match keys.
    new PluginI18nService(),
    NO_ATTACHMENTS,
  )[1];

  function makeStockTx(): {
    tx: unknown;
    componentCreates: MockCall[];
    movementCreates: MockCall[];
  } {
    const componentCreates: MockCall[] = [];
    const movementCreates: MockCall[] = [];
    const tx = {
      component: {
        create: jest.fn((call: MockCall) => {
          componentCreates.push(call);
          return Promise.resolve(call.data);
        }),
      },
      stockMovement: {
        create: jest.fn((call: MockCall) => {
          movementCreates.push(call);
          return Promise.resolve(call.data);
        }),
      },
    };
    return { tx, componentCreates, movementCreates };
  }

  const stockRecord = {
    t: 'stockComponent',
    id: 'c-old',
    name: 'M3 screw',
    quantity: 40,
    storageId: 's-old',
    storageRow: 2,
    storageCol: 3,
  };

  it('imports placement through the storage id-map and writes an opening-balance ADJUSTMENT', async () => {
    const { tx, componentCreates, movementCreates } = makeStockTx();
    const idMap = new ExchangeIdMap();
    idMap.set('storage', 's-old', 's-new');
    const result = await provider.importSection(
      [stockRecord],
      makeImportCtx(tx, idMap),
    );
    expect(result.created).toBe(1);
    const newId = idMap.get('component', 'c-old');
    expect(componentCreates[0].data).toMatchObject({
      id: newId,
      quantity: 40,
      storageId: 's-new',
      storageRow: 2,
      storageCol: 3,
    });
    expect(movementCreates).toHaveLength(1);
    expect(movementCreates[0].data).toMatchObject({
      componentId: newId,
      delta: 40,
      type: 'ADJUSTMENT',
      note: 'inventory.exchange.openingBalance',
    });
  });

  it('drops the placement when the storage did not travel and skips the zero-quantity movement', async () => {
    const { tx, componentCreates, movementCreates } = makeStockTx();
    const idMap = new ExchangeIdMap();
    await provider.importSection(
      [{ ...stockRecord, quantity: 0 }],
      makeImportCtx(tx, idMap),
    );
    expect(componentCreates[0].data).toMatchObject({
      quantity: 0,
      storageId: null,
      storageRow: null,
      storageCol: null,
    });
    expect(movementCreates).toHaveLength(0);
  });

  it('exports only components placed in the previously exported storage subtree', async () => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'c1',
          name: 'M3 screw',
          sku: null,
          description: null,
          categoryRef: null,
          propertyValues: [],
          minQuantity: 0,
          unit: 'pcs',
          links: null,
          customFields: null,
          quantity: 40,
          storageId: 's1',
          storageRow: 2,
          storageCol: 3,
        },
      ]),
    );
    const prisma = {
      attachment: { findMany: () => Promise.resolve([]) },
      component: { findMany },
    } as unknown as PrismaService;
    const exportProvider = createInventoryExchangeProviders(
      prisma,
      new PluginI18nService(),
      NO_ATTACHMENTS,
    )[1];
    const refs = ['mk://storages/storage/s1', 'mk://projects/project/p1'];
    const ctx: ExchangeExportContext = {
      root: { entityType: 'storage', entityId: 's1' },
      locale: 'en',
      selectedSections: new Set(['storages.structure', 'inventory.stock']),
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
    const { records } = await exportProvider.exportSection(ctx);
    // Only the storage ref feeds the subtree filter — the project ref does not.
    expect(findMany).toHaveBeenCalledWith({
      where: { storageId: { in: ['s1'] } },
      // The category travels by name and its property set travels with the
      // values that need it, so both relations are loaded (#205).
      include: {
        categoryRef: { include: { properties: true } },
        propertyValues: { include: { property: true } },
      },
    });
    expect(records[0]).toMatchObject({
      t: 'stockComponent',
      id: 'c1',
      quantity: 40,
      storageId: 's1',
      storageRow: 2,
      storageCol: 3,
    });
  });

  it('carries the category by name, its property definitions and the item values (#205)', async () => {
    const inherited = {
      id: 'p-maker',
      name: 'Manufacturer',
      type: 'text',
      unit: null,
      required: false,
      options: null,
      order: 0,
    };
    const own = {
      id: 'p-res',
      name: 'Resistance',
      type: 'number',
      unit: 'Ohm',
      required: true,
      options: null,
      order: 1,
    };
    const prisma = {
      attachment: { findMany: () => Promise.resolve([]) },
      component: {
        findMany: () =>
          Promise.resolve([
            {
              id: 'c1',
              name: '10k resistor',
              sku: null,
              description: null,
              categoryRef: { name: 'Resistors', properties: [own] },
              propertyValues: [
                { valueText: null, valueNumber: 10_000, property: own },
                // Inherited from an ancestor that does not travel — its
                // definition must ride along with the value all the same.
                { valueText: 'Yageo', valueNumber: null, property: inherited },
              ],
              minQuantity: 0,
              unit: 'pcs',
              links: null,
              customFields: null,
              quantity: 5,
              storageId: 's1',
              storageRow: null,
              storageCol: null,
            },
          ]),
      },
    } as unknown as PrismaService;
    const exportProvider = createInventoryExchangeProviders(
      prisma,
      new PluginI18nService(),
      NO_ATTACHMENTS,
    )[1];
    const refs = ['mk://storages/storage/s1'];
    const ctx: ExchangeExportContext = {
      root: { entityType: 'storage', entityId: 's1' },
      locale: 'en',
      selectedSections: new Set(['storages.structure', 'inventory.stock']),
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

    const { records } = await exportProvider.exportSection(ctx);

    expect(records[0]).toMatchObject({
      category: 'Resistors',
      propertyValues: [
        { name: 'Resistance', valueText: null, valueNumber: 10_000 },
        { name: 'Manufacturer', valueText: 'Yageo', valueNumber: null },
      ],
      categoryProperties: [
        {
          name: 'Resistance',
          type: 'number',
          unit: 'Ohm',
          required: true,
          options: null,
          order: 1,
        },
        {
          name: 'Manufacturer',
          type: 'text',
          unit: null,
          required: false,
          options: null,
          order: 0,
        },
      ],
    });
  });
});

// Every photograph rides in the archive (#218), deliberately wider than the
// project precedent (cover only): losing a photograph is a bigger problem than
// a heavy archive, because the pictures are how a part is identified again.
describe('component photographs in the archive', () => {
  const componentRow = {
    id: 'c-old',
    name: 'Buck Converter',
    sku: 'BC-01',
    description: null,
    categoryRef: null,
    propertyValues: [],
    minQuantity: 0,
    unit: 'pcs',
    links: null,
    customFields: null,
    quantity: 1,
    storageId: 's1',
    storageRow: null,
    storageCol: null,
    coverAttachmentId: 'att_2',
  };

  const photoRows = [
    {
      id: 'att_1',
      mimeType: 'image/jpeg',
      filename: 'front.jpg',
      sizeBytes: 11,
    },
    {
      id: 'att_2',
      mimeType: 'image/png',
      filename: null,
      sizeBytes: 22,
    },
    // Bytes gone (a restored dump, the #120 sweep) — skipped rather than
    // exported as a promise the import cannot keep.
    { id: 'att_gone', mimeType: 'image/png', filename: null, sizeBytes: 33 },
  ];

  const exportPhotos = async (): Promise<{
    photos: unknown;
    staged: string[];
  }> => {
    const staged: string[] = [];
    const prisma = {
      attachment: { findMany: () => Promise.resolve(photoRows) },
      component: { findMany: () => Promise.resolve([componentRow]) },
    } as unknown as PrismaService;
    const attachments = {
      resolveExistingFile: (id: string) =>
        Promise.resolve(id === 'att_gone' ? null : { path: `/tmp/${id}` }),
    } as unknown as AttachmentStorageService;
    const provider = createInventoryExchangeProviders(
      prisma,
      new PluginI18nService(),
      attachments,
    )[1];
    const ctx: ExchangeExportContext = {
      root: { entityType: 'storage', entityId: 's1' },
      locale: 'en',
      selectedSections: new Set(['inventory.stock']),
      includeSecrets: false,
      addExportedRef: () => undefined,
      getExportedRefs: () => ['mk://storages/storage/s1'],
      files: {
        putFile: () => Promise.resolve(),
        putFileFromPath: (id: string) => {
          staged.push(id);
          return Promise.resolve();
        },
      },
    };
    const { records } = await provider.exportSection(ctx);
    const first = records[0];
    // Guard rather than cast (§5.1): the section payload is `unknown[]`.
    return {
      photos: isRecordObject(first) ? first['photos'] : undefined,
      staged,
    };
  };

  it('exports every picture, marks the cover and stages the bytes', async () => {
    const { photos, staged } = await exportPhotos();
    expect(photos).toEqual([
      {
        id: 'att_1',
        mimeType: 'image/jpeg',
        filename: 'front.jpg',
        sizeBytes: 11,
        isCover: false,
      },
      {
        id: 'att_2',
        mimeType: 'image/png',
        filename: null,
        sizeBytes: 22,
        isCover: true,
      },
    ]);
    expect(staged).toEqual(['att_1', 'att_2']);
  });

  it('re-creates the rows and re-points the cover on import', async () => {
    const attachmentCreates: MockCall[] = [];
    const componentUpdates: MockCall[] = [];
    const tx = {
      component: {
        findFirst: () => Promise.resolve(null),
        create: (call: MockCall) => Promise.resolve(call.data),
        update: (call: MockCall) => {
          componentUpdates.push(call);
          return Promise.resolve(call.data);
        },
      },
      attachment: {
        create: (call: MockCall) => {
          attachmentCreates.push(call);
          return Promise.resolve(call.data);
        },
      },
      storage: { findFirst: () => Promise.resolve(null) },
      stockMovement: { create: () => Promise.resolve({}) },
    };
    const attachments = {
      importFileFromPath: (id: string) =>
        Promise.resolve({
          relPath: `2026/08/03/${id}.jpg`,
          sizeBytes: 11,
          isImage: true,
          previews: {},
        }),
    } as unknown as AttachmentStorageService;
    const provider = createInventoryExchangeProviders(
      {} as unknown as PrismaService,
      new PluginI18nService(),
      attachments,
    )[1];

    await provider.importSection(
      [
        {
          t: 'stockComponent',
          id: 'c-old',
          name: 'Buck Converter',
          minQuantity: 0,
          unit: 'pcs',
          quantity: 0,
          photos: [
            { id: 'att_1', mimeType: 'image/jpeg', filename: 'front.jpg' },
            { id: 'att_2', mimeType: 'image/png', isCover: true },
            // Bytes missing from the archive — skipped, never invented.
            { id: 'att_absent', mimeType: 'image/png' },
          ],
        },
      ],
      {
        ...makeImportCtx(tx, new ExchangeIdMap()),
        selectedSections: new Set(['inventory.stock']),
        files: {
          readFile: () => Promise.resolve(null),
          // `att_absent` names bytes the archive does not carry.
          filePath: (id: string) =>
            Promise.resolve(id === 'att_absent' ? null : `/tmp/${id}`),
          listFiles: () => Promise.resolve([]),
        },
      },
    );

    expect(attachmentCreates).toHaveLength(2);
    expect(attachmentCreates[0].data.ownerPluginId).toBe('inventory');
    // The pin cannot travel by id — it is restored explicitly from `isCover`.
    expect(componentUpdates).toHaveLength(1);
    expect(componentUpdates[0].data.coverAttachmentId).toBe(
      attachmentCreates[1].data.id,
    );
  });
});
