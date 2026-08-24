import { LogisticsService } from './logistics.service';

// The `logistics.order.received` emitter policy (#192): an intake act — a
// line's received qty actually growing, or the DELIVERED transition —
// announces once; corrections and repeat saves stay silent.

const order = (
  overrides: Partial<{
    status: string;
    items: Array<{
      id: string;
      componentId: string;
      quantity: number;
      receivedQty: number;
    }>;
  }> = {},
) => ({
  id: 'ord_1',
  storeName: 'shop',
  storageId: null,
  scopeId: 's1',
  status: overrides.status ?? 'ORDERED',
  items: overrides.items ?? [
    { id: 'line_1', componentId: 'comp_1', quantity: 5, receivedQty: 0 },
  ],
});

const makeService = (opts: {
  order: ReturnType<typeof order>;
  publish?: jest.Mock;
}) => {
  const prisma = {
    order: {
      findUnique: jest.fn(async () => opts.order),
      update: jest.fn(async () => ({ ...opts.order, status: 'DELIVERED' })),
    },
    orderComponent: {
      findMany: jest.fn(async () => opts.order.items),
      update: jest.fn(async () => undefined),
    },
  };
  const capabilities = {
    getCapability: () =>
      opts.publish ? { publishDomainEvent: opts.publish } : null,
  };
  const service = new LogisticsService(
    prisma as never,
    { t: (k: string) => k } as never,
    { emit: jest.fn(async () => undefined) } as never,
    capabilities as never,
  );
  return { service, prisma };
};

describe('logistics.order.received emitter', () => {
  it('announces once when a line actually receives stock', async () => {
    const publish = jest.fn(async () => undefined);
    const { service } = makeService({ order: order(), publish });
    await service.receiveOrder('ord_1', [
      { orderComponentId: 'line_1', receivedQty: 3 },
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      type: 'logistics.order.received',
      scopeId: 's1',
      ref: 'mk://logistics/order/ord_1',
    });
  });

  it('stays silent on a downward correction', async () => {
    const publish = jest.fn(async () => undefined);
    const { service } = makeService({
      order: order({
        items: [
          { id: 'line_1', componentId: 'comp_1', quantity: 5, receivedQty: 4 },
        ],
      }),
      publish,
    });
    await service.receiveOrder('ord_1', [
      { orderComponentId: 'line_1', receivedQty: 2 },
    ]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('announces the transition into DELIVERED via updateStatus', async () => {
    const publish = jest.fn(async () => undefined);
    const { service } = makeService({ order: order(), publish });
    await service.updateStatus('ord_1', 'DELIVERED');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does not re-announce an already delivered order', async () => {
    const publish = jest.fn(async () => undefined);
    const { service } = makeService({
      order: order({
        status: 'DELIVERED',
        items: [
          { id: 'line_1', componentId: 'comp_1', quantity: 5, receivedQty: 5 },
        ],
      }),
      publish,
    });
    await service.updateStatus('ord_1', 'DELIVERED');
    expect(publish).not.toHaveBeenCalled();
  });

  it('without the external host receiving still succeeds', async () => {
    const { service } = makeService({ order: order() });
    // The fake rows never mutate, so fullyReceived stays false — what this
    // case guards is only that a missing host cannot fail the intake.
    await expect(
      service.receiveOrder('ord_1', [
        { orderComponentId: 'line_1', receivedQty: 5 },
      ]),
    ).resolves.toMatchObject({ ok: true });
  });
});
