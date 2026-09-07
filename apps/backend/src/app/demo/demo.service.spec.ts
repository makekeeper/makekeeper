import { DemoService } from './demo.service';

// The dataset writer and the group helper are exercised by their own code paths
// (and by the live first-boot check); what this spec guards is the DECISION
// around them — the one that must never seed over somebody's real data.
jest.mock('./demo-dataset', () => ({
  ...jest.requireActual('./demo-dataset'),
  seedDemoData: jest.fn().mockResolvedValue({
    categories: 9,
    properties: 7,
    items: 30,
    storages: 4,
    projects: 5,
    tasks: 16,
    orders: 5,
    orderLines: 14,
    movements: 30,
    tags: 4,
    tagLinks: 9,
    activity: 20,
  }),
}));
jest.mock('@makekeeper/plugin-projects/backend', () => ({
  ensureDefaultProjectGroup: jest.fn().mockResolvedValue('group_default'),
}));

import { seedDemoData } from './demo-dataset';

type Counts = { projects: number; items: number; orders: number };

const makeService = (options: {
  enabled?: boolean;
  settings?: { seededAt: Date | null; clearedAt: Date | null } | null;
  counts?: Counts;
}) => {
  const upsert = jest.fn().mockResolvedValue({});
  const deleteManyDynamic = jest.fn().mockResolvedValue({ count: 3 });
  const counts = options.counts ?? {
    projects: 0,
    items: 0,
    orders: 0,
  };
  const prisma = {
    demoDataSettings: {
      findUnique: jest.fn().mockResolvedValue(options.settings ?? null),
      upsert,
    },
    project: { count: jest.fn().mockResolvedValue(counts.projects) },
    component: { count: jest.fn().mockResolvedValue(counts.items) },
    order: { count: jest.fn().mockResolvedValue(counts.orders) },
    storage: { count: jest.fn().mockResolvedValue(0) },
    itemCategory: { count: jest.fn().mockResolvedValue(0) },
    deleteManyDynamic,
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const realtime = { emitDataChangedForScope: jest.fn() };
  // The real RequestContextService runs the callback with scope enforcement
  // suspended; the double records the reason so the test can assert the bypass
  // was actually taken.
  const bypassReasons: string[] = [];
  const requestContext = {
    get: () => undefined,
    runWithoutScope: <T>(reason: string, fn: () => Promise<T>): Promise<T> => {
      bypassReasons.push(reason);
      return fn();
    },
  };
  const service = new DemoService(
    prisma as never,
    { isDemoSeedEnabled: () => options.enabled ?? true } as never,
    { t: (key: string) => key } as never,
    realtime as never,
    requestContext as never,
  );
  return {
    service,
    prisma,
    realtime,
    upsert,
    deleteManyDynamic,
    bypassReasons,
  };
};

describe('DemoService first-install seed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('seeds an empty instance and stamps that it did', async () => {
    const { service, upsert } = makeService({});
    await service.onApplicationBootstrap();
    expect(seedDemoData).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'default' } }),
    );
  });

  // The upgrade case, and the one that would be unforgivable: an instance in
  // real use must never have demo rows appear in it.
  it('never seeds an instance that already holds data', async () => {
    const { service } = makeService({
      counts: { projects: 0, items: 4, orders: 0 },
    });
    await service.onApplicationBootstrap();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  // Clearing empties the instance again — without this, the next boot would
  // find "no data" and put the demo workshop straight back.
  it('never re-seeds after the data was cleared', async () => {
    const { service } = makeService({
      settings: { seededAt: new Date(), clearedAt: new Date() },
    });
    await service.onApplicationBootstrap();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it('respects DEMO_SEED=0', async () => {
    const { service } = makeService({ enabled: false });
    await service.onApplicationBootstrap();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  // A seed that throws is a cosmetic failure, never a failed boot.
  it('survives a failing seed', async () => {
    const { service, prisma } = makeService({});
    prisma.$transaction.mockRejectedValueOnce(new Error('db is on fire'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('DemoService.clear', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes by the demo prefix only, over every table, and stamps the removal', async () => {
    const { service, deleteManyDynamic, upsert, realtime } = makeService({
      settings: { seededAt: new Date(), clearedAt: null },
    });
    const { removed } = await service.clear();

    expect(removed).toBe(3 * deleteManyDynamic.mock.calls.length);
    for (const [, args] of deleteManyDynamic.mock.calls) {
      expect(args).toEqual({ where: { id: { startsWith: 'demo_' } } });
    }
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ clearedAt: expect.any(Date) }),
      }),
    );
    expect(realtime.emitDataChangedForScope).toHaveBeenCalled();
  });

  // The seed writes at NULL scope, from a bootstrap that has no request
  // context; an admin pressing the button is inside their own scope. Deleting
  // through the scoped client would match nothing, report zero and still stamp
  // the removal — the banner gone and every demo row still on the shelf.
  it('deletes with scope enforcement suspended', async () => {
    const { service, bypassReasons } = makeService({
      settings: { seededAt: new Date(), clearedAt: null },
    });
    await service.clear();
    expect(bypassReasons).toEqual(['demo-clear']);
  });
});
