import { ExchangeIdMap } from '@makekeeper/backend-core';
import type {
  ExchangeImportContext,
  PrismaService,
  PrismaTransactionClient,
} from '@makekeeper/backend-core';
import { createLogisticsExchangeProviders } from './logistics.exchange';

// Import-side behavior of the logistics.orders section: supplier match-by-name
// vocabulary, order id remap with the destination storage stripped, and line
// rows dropped when their component did not travel (BOM section unselected).

type MockCall = { data: Record<string, unknown> };

interface FakeSupplier {
  id: string;
  name: string;
}

function makeTx(existingSuppliers: FakeSupplier[]): {
  tx: unknown;
  supplierCreates: MockCall[];
  orderCreates: MockCall[];
  itemCreates: MockCall[];
  eventCreates: MockCall[];
  returnCreates: MockCall[];
} {
  const supplierCreates: MockCall[] = [];
  const orderCreates: MockCall[] = [];
  const itemCreates: MockCall[] = [];
  const eventCreates: MockCall[] = [];
  const returnCreates: MockCall[] = [];
  const tx = {
    supplier: {
      findFirst: ({ where }: { where: { name: { equals: string } } }) =>
        Promise.resolve(
          existingSuppliers.find(
            (s) => s.name.toLowerCase() === where.name.equals.toLowerCase(),
          ) ?? null,
        ),
      create: jest.fn((call: MockCall) => {
        supplierCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
    order: {
      create: jest.fn((call: MockCall) => {
        orderCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
    orderComponent: {
      create: jest.fn((call: MockCall) => {
        itemCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
    trackingEvent: {
      create: jest.fn((call: MockCall) => {
        eventCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
    returnRequest: {
      create: jest.fn((call: MockCall) => {
        returnCreates.push(call);
        return Promise.resolve(call.data);
      }),
    },
  };
  return {
    tx,
    supplierCreates,
    orderCreates,
    itemCreates,
    eventCreates,
    returnCreates,
  };
}

function makeCtx(tx: unknown, idMap: ExchangeIdMap): ExchangeImportContext {
  return {
    root: { entityType: 'project', entityId: 'p-old' },
    tx: tx as PrismaTransactionClient,
    scopeId: null,
    locale: 'en',
    selectedSections: new Set(['logistics.orders']),
    idMap,
    options: {},
    preserveIds: false,
    files: {
      readFile: () => Promise.resolve(null),
      filePath: () => Promise.resolve(null),
      listFiles: () => Promise.resolve([]),
    },
  };
}

const provider = createLogisticsExchangeProviders(
  {} as unknown as PrismaService,
)[0];

const records = [
  { t: 'supplier', id: 'sup-old', name: 'AliParts', country: 'CN' },
  {
    t: 'order',
    id: 'o-old',
    projectId: 'p-old',
    supplierId: 'sup-old',
    storeName: 'AliParts Store',
    orderDate: '2026-02-01T00:00:00.000Z',
    status: 'SHIPPED',
    storageId: 's-should-not-travel',
    totalCost: 25,
    currency: 'EUR',
  },
  {
    t: 'orderComponent',
    orderId: 'o-old',
    componentId: 'c-old',
    quantity: 10,
    receivedQty: 2,
    unitPrice: 1.5,
  },
  {
    t: 'trackingEvent',
    orderId: 'o-old',
    status: 'In transit',
    location: 'Shenzhen',
    eventTime: '2026-02-03T00:00:00.000Z',
  },
  {
    t: 'returnRequest',
    orderId: 'o-old',
    componentId: 'c-old',
    quantity: 1,
    status: 'INITIATED',
    createdAt: '2026-02-05T00:00:00.000Z',
  },
];

describe('logistics.orders import', () => {
  it('reuses an existing supplier matched case-insensitively by name', async () => {
    const { tx, supplierCreates, orderCreates } = makeTx([
      { id: 'local-sup', name: 'aliparts' },
    ]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('component', 'c-old', 'c-new');
    await provider.importSection(records, makeCtx(tx, idMap));
    expect(supplierCreates).toHaveLength(0);
    expect(idMap.get('supplier', 'sup-old')).toBe('local-sup');
    expect(orderCreates[0].data).toMatchObject({ supplierId: 'local-sup' });
  });

  it('creates a missing supplier under a fresh id', async () => {
    const { tx, supplierCreates } = makeTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    await provider.importSection(records, makeCtx(tx, idMap));
    expect(supplierCreates).toHaveLength(1);
    const newId = idMap.get('supplier', 'sup-old');
    expect(newId).not.toBeNull();
    expect(newId).not.toBe('sup-old');
    expect(supplierCreates[0].data).toMatchObject({
      id: newId,
      name: 'AliParts',
      country: 'CN',
      scopeId: null,
    });
  });

  it('remaps the order id and strips the destination storage', async () => {
    const { tx, orderCreates } = makeTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    await provider.importSection(records, makeCtx(tx, idMap));
    const newOrderId = idMap.get('order', 'o-old');
    expect(newOrderId).not.toBeNull();
    expect(newOrderId).not.toBe('o-old');
    expect(orderCreates[0].data).toMatchObject({
      id: newOrderId,
      projectId: 'p-new',
      storeName: 'AliParts Store',
      status: 'SHIPPED',
      currency: 'EUR',
      storageId: null,
    });
  });

  it('drops component lines and return components when the BOM did not travel', async () => {
    const { tx, itemCreates, returnCreates } = makeTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    // No 'component' mapping — inventory.components was not selected.
    await provider.importSection(records, makeCtx(tx, idMap));
    expect(itemCreates).toHaveLength(0);
    // The return itself travels (componentId is optional there → null).
    expect(returnCreates).toHaveLength(1);
    expect(returnCreates[0].data).toMatchObject({
      orderId: idMap.get('order', 'o-old'),
      componentId: null,
    });
  });

  it('keeps lines, tracking events and returns remapped once components are mapped', async () => {
    const { tx, itemCreates, eventCreates, returnCreates } = makeTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('component', 'c-old', 'c-new');
    const result = await provider.importSection(records, makeCtx(tx, idMap));
    const newOrderId = idMap.get('order', 'o-old');
    expect(itemCreates[0].data).toMatchObject({
      orderId: newOrderId,
      componentId: 'c-new',
      quantity: 10,
      receivedQty: 2,
      unitPrice: 1.5,
    });
    expect(eventCreates[0].data).toMatchObject({
      orderId: newOrderId,
      status: 'In transit',
      location: 'Shenzhen',
    });
    expect(returnCreates[0].data).toMatchObject({
      orderId: newOrderId,
      componentId: 'c-new',
      quantity: 1,
    });
    // supplier + order + line + event + return
    expect(result.created).toBe(5);
  });

  it('drops an order whose store name is missing along with its dependents', async () => {
    const { tx, orderCreates, itemCreates } = makeTx([]);
    const idMap = new ExchangeIdMap();
    idMap.set('project', 'p-old', 'p-new');
    idMap.set('component', 'c-old', 'c-new');
    const broken = records.map((r) =>
      r.t === 'order' ? { ...r, storeName: undefined } : r,
    );
    await provider.importSection(broken, makeCtx(tx, idMap));
    expect(orderCreates).toHaveLength(0);
    expect(itemCreates).toHaveLength(0);
  });
});
