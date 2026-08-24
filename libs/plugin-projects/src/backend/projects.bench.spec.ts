import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  CapabilityRegistryService,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  COMPONENT_ORDER_INFO_CAPABILITY,
  INVENTORY_STOCK_FACTS_CAPABILITY,
  LOGISTICS_INCOMING_CAPABILITY,
} from '@makekeeper/plugin-contract';
import type { ComponentOrderInfoCapability } from '@makekeeper/plugin-contract';
import { ProjectsService } from './projects.service';

// getBench (#90): the readiness/task-queue aggregation. Exercises the four line
// states, the three task states, the isDone override, percent sorting, and the
// logistics-disabled degrade.

interface RawComponentLink {
  componentId: string;
  neededQty: number;
  reservedQty: number;
  component: { name: string; quantity: number };
}

interface RawTaskDep {
  isDone: boolean;
  order: {
    id: string;
    storeName: string;
    status: string;
    estimatedDelivery: Date | null;
  };
}

interface RawTaskLink {
  isDone: boolean;
  quantity: number;
  component: { name: string; quantity: number };
}

interface RawTask {
  id: string;
  title: string;
  priority: string;
  dueDate: Date | null;
  isCompleted: boolean;
  components: RawTaskLink[];
  orders: RawTaskDep[];
}

interface RawProject {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  components: RawComponentLink[];
  tasks: RawTask[];
}

function makeService(
  projects: RawProject[],
  // Incoming quantity keyed projectId → componentId → qty (#90): only a
  // project's own orders count toward its readiness. `null` mirrors logistics
  // being disabled (capability absent).
  onOrder: Map<string, Map<string, number>> | null,
  extras: { incoming?: number; unplaced?: number } = {},
): ProjectsService {
  const prisma = {
    project: { findMany: vi.fn(() => Promise.resolve(projects)) },
  } as unknown as PrismaService;

  const orderInfo: ComponentOrderInfoCapability | undefined =
    onOrder === null
      ? undefined
      : {
          onOrderByComponent: () => Promise.resolve(new Map()),
          onOrderByProjectComponent: () => Promise.resolve(onOrder),
          lastPriceByComponent: () => Promise.resolve(new Map()),
          componentOrders: () => Promise.resolve([]),
        };

  // The registry hands back a different capability per id; a `null`/absent one
  // mirrors the owning plugin being disabled.
  const capabilities = {
    getCapability: vi.fn((id: string) => {
      if (id === COMPONENT_ORDER_INFO_CAPABILITY) return orderInfo;
      if (id === LOGISTICS_INCOMING_CAPABILITY)
        return extras.incoming === undefined
          ? undefined
          : { incomingOrderCount: () => Promise.resolve(extras.incoming) };
      if (id === INVENTORY_STOCK_FACTS_CAPABILITY)
        return extras.unplaced === undefined
          ? undefined
          : { unplacedCount: () => Promise.resolve(extras.unplaced) };
      return undefined;
    }),
  } as unknown as CapabilityRegistryService;

  // Only prisma + capabilities are touched by getBench; the rest are unused.
  return new ProjectsService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    capabilities,
  );
}

const link = (
  componentId: string,
  neededQty: number,
  reservedQty: number,
  quantity: number,
  name = componentId,
): RawComponentLink => ({
  componentId,
  neededQty,
  reservedQty,
  component: { name, quantity },
});

describe('ProjectsService.getBench', () => {
  it('classifies each bill-of-materials line into the right supply state', async () => {
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Robot',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [
            link('c-res', 2, 2, 0), // fully reserved  → reserved
            link('c-stock', 2, 0, 5), // free stock covers → inStock
            link('c-order', 2, 0, 0), // short 2, on order 5 → onOrder
            link('c-miss', 2, 0, 0), // short 2, none on order → missing
          ],
          tasks: [],
        },
      ],
      new Map([['p1', new Map([['c-order', 5]])]]),
    );

    const { projects } = await service.getBench();
    const p = projects[0];

    expect(p.reserved).toBe(1);
    expect(p.inStock).toBe(1);
    expect(p.onOrder).toBe(1);
    expect(p.missing).toBe(1);
    expect(p.total).toBe(4);
    expect(p.percent).toBe(50); // (reserved + inStock) / total
    expect(p.buildable).toBe(false);
    expect(p.lines.find((l) => l.componentId === 'c-miss')?.deficit).toBe(2);
  });

  it('marks a project buildable only when nothing is short', async () => {
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Done-parts',
          status: 'TESTING',
          dueDate: null,
          components: [link('a', 1, 1, 0), link('b', 3, 0, 4)],
          tasks: [],
        },
      ],
      new Map(),
    );

    const p = (await service.getBench()).projects[0];
    expect(p.buildable).toBe(true);
    expect(p.percent).toBe(100);
  });

  it('derives task state and the unblock date from order dependencies', async () => {
    const eta = new Date('2026-08-01T00:00:00.000Z');
    const later = new Date('2026-08-10T00:00:00.000Z');
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Tasks',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [],
          tasks: [
            {
              id: 't-ready',
              title: 'Solder',
              priority: 'MEDIUM',
              dueDate: null,
              isCompleted: false,
              components: [
                {
                  isDone: false,
                  quantity: 1,
                  component: { name: 'R', quantity: 10 },
                },
              ],
              orders: [],
            },
            {
              id: 't-wait',
              title: 'Mount',
              priority: 'HIGH',
              dueDate: null,
              isCompleted: false,
              components: [],
              orders: [
                {
                  isDone: false,
                  order: {
                    id: 'o-late',
                    storeName: 'LCSC',
                    status: 'SHIPPED',
                    estimatedDelivery: later,
                  },
                },
                {
                  isDone: false,
                  order: {
                    id: 'o-soon',
                    storeName: 'Mouser',
                    status: 'ORDERED',
                    estimatedDelivery: eta,
                  },
                },
              ],
            },
            {
              id: 't-noparts',
              title: 'Wire',
              priority: 'LOW',
              dueDate: null,
              isCompleted: false,
              components: [
                {
                  isDone: false,
                  quantity: 5,
                  component: { name: 'Wire', quantity: 1 },
                },
              ],
              orders: [],
            },
          ],
        },
      ],
      new Map(),
    );

    const p = (await service.getBench()).projects[0];
    const byId = new Map(p.tasks.map((t) => [t.id, t]));

    expect(byId.get('t-ready')?.state).toBe('ready');
    expect(byId.get('t-wait')?.state).toBe('waitingOrder');
    expect(byId.get('t-wait')?.waitingFor?.storeName).toBe('LCSC');
    expect(byId.get('t-noparts')?.state).toBe('noParts');
    expect(byId.get('t-noparts')?.shortOf).toEqual(['Wire']);
    expect(p.openTasks).toBe(3);
    // Earliest delivery among waited-on orders.
    expect(p.unblockAt).toBe(eta.toISOString());
  });

  it('ignores an order dependency the maker already ticked off (isDone)', async () => {
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Ticked',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [],
          tasks: [
            {
              id: 't',
              title: 'Assemble',
              priority: 'MEDIUM',
              dueDate: null,
              isCompleted: false,
              components: [],
              orders: [
                {
                  isDone: true,
                  order: {
                    id: 'o',
                    storeName: 'LCSC',
                    status: 'SHIPPED',
                    estimatedDelivery: new Date('2026-08-01T00:00:00.000Z'),
                  },
                },
              ],
            },
          ],
        },
      ],
      new Map(),
    );

    const p = (await service.getBench()).projects[0];
    expect(p.tasks[0].state).toBe('ready');
    expect(p.unblockAt).toBeNull();
  });

  it('sorts projects by readiness percent, closest to buildable first', async () => {
    const service = makeService(
      [
        {
          id: 'low',
          title: 'Low',
          status: 'PLANNING',
          dueDate: null,
          components: [link('a', 1, 0, 0), link('b', 1, 0, 0)], // 0%
          tasks: [],
        },
        {
          id: 'high',
          title: 'High',
          status: 'PLANNING',
          dueDate: null,
          components: [link('c', 1, 1, 0)], // 100%
          tasks: [],
        },
      ],
      new Map(),
    );

    const { projects } = await service.getBench();
    expect(projects.map((p) => p.id)).toEqual(['high', 'low']);
  });

  it('builds the summary ribbon from projects plus the incoming/unplaced capabilities', async () => {
    const service = makeService(
      [
        {
          id: 'ready',
          title: 'Ready',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [link('a', 1, 1, 0)], // buildable
          tasks: [],
        },
        {
          id: 'short',
          title: 'Short',
          status: 'PLANNING',
          dueDate: null,
          components: [link('b', 2, 0, 0), link('c', 2, 0, 0)], // 2 not ordered
          tasks: [],
        },
      ],
      new Map(),
      { incoming: 3, unplaced: 7 },
    );

    const { summary } = await service.getBench();
    expect(summary).toEqual({
      buildable: 1,
      notOrdered: 2,
      incoming: 3,
      unplaced: 7,
    });
  });

  it('leaves incoming/unplaced null when those plugins are disabled', async () => {
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Solo',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [link('a', 1, 1, 0)],
          tasks: [],
        },
      ],
      new Map(),
      {},
    );

    const { summary } = await service.getBench();
    expect(summary.incoming).toBeNull();
    expect(summary.unplaced).toBeNull();
    expect(summary.buildable).toBe(1);
  });

  it('attributes an incoming part only to the project that ordered it (no cross-project double-count)', async () => {
    // Both projects are short of the SAME component; only p1 has an order for
    // it. A global per-component sum would mark both "onOrder" — per-project
    // attribution must leave p2 "missing".
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'Ordered it',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [link('shared', 2, 0, 0)],
          tasks: [],
        },
        {
          id: 'p2',
          title: 'Did not',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [link('shared', 2, 0, 0)],
          tasks: [],
        },
      ],
      new Map([['p1', new Map([['shared', 5]])]]),
    );

    const byId = new Map(
      (await service.getBench()).projects.map((p) => [p.id, p]),
    );
    expect(byId.get('p1')?.onOrder).toBe(1);
    expect(byId.get('p1')?.missing).toBe(0);
    expect(byId.get('p2')?.onOrder).toBe(0);
    expect(byId.get('p2')?.missing).toBe(1);
  });

  it('degrades a shortfall to "missing" when logistics is disabled', async () => {
    const service = makeService(
      [
        {
          id: 'p1',
          title: 'No logistics',
          status: 'IN_PROGRESS',
          dueDate: null,
          components: [link('c', 2, 0, 0)], // short 2, capability absent
          tasks: [],
        },
      ],
      null,
    );

    const p = (await service.getBench()).projects[0];
    expect(p.missing).toBe(1);
    expect(p.onOrder).toBe(0);
    expect(p.lines[0].state).toBe('missing');
  });
});
