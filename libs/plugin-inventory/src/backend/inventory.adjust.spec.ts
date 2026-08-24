import { InventoryService } from './inventory.service';

// Idempotent, delta-based stock writes (#202). These are the properties that
// decide whether an offline queue is safe to have at all: a replayed operation
// must not deduct twice, a stale delta must not roll back somebody else's edit,
// and a delta that cannot apply must say so rather than quietly clamping.

interface ComponentRow {
  id: string;
  name: string;
  quantity: number;
  scopeId: string | null;
}

interface MovementRow {
  id: string;
  componentId: string;
  delta: number;
  clientOpId: string | null;
}

function harness(initialQuantity: number) {
  const component: ComponentRow = {
    id: 'c1',
    name: 'Resistor 10k',
    quantity: initialQuantity,
    scopeId: null,
  };
  const movements: MovementRow[] = [];
  // Fires once, between the read and the compare-and-set of the next adjust —
  // the interleaving that a read-modify-write would lose.
  let interleave: (() => void) | null = null;

  const prisma = {
    component: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const found = where.id === component.id ? { ...component } : null;
        if (found && interleave) {
          const run = interleave;
          interleave = null;
          run();
        }
        return Promise.resolve(found);
      },
      // The real compare-and-set: the update only matches while the stored
      // quantity is still the one the caller read.
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; quantity?: number };
        data: { quantity: { increment: number } };
      }) => {
        if (where.id !== component.id) return Promise.resolve({ count: 0 });
        if (
          where.quantity !== undefined &&
          where.quantity !== component.quantity
        ) {
          return Promise.resolve({ count: 0 });
        }
        component.quantity += data.quantity.increment;
        return Promise.resolve({ count: 1 });
      },
    },
    stockMovement: {
      findUnique: ({ where }: { where: { clientOpId: string } }) =>
        Promise.resolve(
          movements.find((m) => m.clientOpId === where.clientOpId) ?? null,
        ),
      create: ({ data }: { data: MovementRow }) => {
        // The real unique index: claiming a key that is taken must fail, which
        // is the whole arbitration mechanism for a replayed operation.
        if (
          data.clientOpId &&
          movements.some((m) => m.clientOpId === data.clientOpId)
        ) {
          return Promise.reject(new Error('unique violation on clientOpId'));
        }
        movements.push({ ...data, clientOpId: data.clientOpId ?? null });
        return Promise.resolve(data);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { delta: number };
      }) => {
        const row = movements.find((m) => m.id === where.id);
        if (row) row.delta = data.delta;
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const i = movements.findIndex((m) => m.id === where.id);
        if (i >= 0) movements.splice(i, 1);
        return Promise.resolve({});
      },
    },
  };

  const service = new InventoryService(
    prisma as never,
    { t: (key: string) => key } as never,
    { getCapability: () => null } as never,
    { saveDataUrl: () => Promise.resolve(null) } as never,
    { itemChanged: () => Promise.resolve() } as never,
    {
      setValues: () => Promise.resolve(),
      valuesFor: () => Promise.resolve([]),
      effectivePropertiesFor: () => Promise.resolve([]),
      spillForCategoryChange: () => Promise.resolve(),
      filledValuesFor: () => Promise.resolve([]),
    } as never,
    { emit: async () => undefined } as never,
  );

  // getOne is the "already applied" answer path; the fake prisma has no
  // includes, so short-circuit it to the row itself.
  jest
    .spyOn(service, 'getOne')
    .mockImplementation(() => Promise.resolve({ ...component } as never));

  return {
    service,
    component,
    movements,
    setInterleave: (fn: () => void) => {
      interleave = fn;
    },
  };
}

describe('InventoryService.adjustQty', () => {
  it('applies a queued delta once, however many times it is replayed', async () => {
    const { service, component, movements } = harness(10);

    await service.adjustQty('c1', 5, 'PURCHASE', undefined, 'op-1');
    await service.adjustQty('c1', 5, 'PURCHASE', undefined, 'op-1');

    expect(component.quantity).toBe(15);
    expect(movements).toHaveLength(1);
  });

  it('keeps a concurrent edit instead of overwriting it', async () => {
    const { service, component, setInterleave } = harness(10);

    // Somebody adjusts from the desktop in the window between our read and our
    // write. A read-modify-write would compute 10 + 5, store 15, and erase it;
    // the compare-and-set misses, re-reads and adds on top.
    setInterleave(() => {
      component.quantity += 3;
    });

    await service.adjustQty('c1', 5, 'PURCHASE', undefined, 'op-2');

    // 10 + 3 (theirs) + 5 (ours) — both survive.
    expect(component.quantity).toBe(18);
  });

  it('claims the key before moving stock, so a racing replay cannot double-count', async () => {
    const { service, component, movements } = harness(10);

    // Both replays start before either has finished — the check-then-act shape
    // this replaced would let both apply the delta and only fail the loser
    // afterwards, with the stock already moved twice.
    await Promise.all([
      service.adjustQty('c1', 5, 'PURCHASE', undefined, 'op-race'),
      service.adjustQty('c1', 5, 'PURCHASE', undefined, 'op-race'),
    ]);

    expect(component.quantity).toBe(15);
    expect(movements.filter((m) => m.clientOpId === 'op-race')).toHaveLength(1);
  });

  it('leaves no movement behind when the queued delta is refused', async () => {
    const { service, movements } = harness(2);

    await expect(
      service.adjustQty('c1', -5, 'USED', undefined, 'op-doomed'),
    ).rejects.toThrow('inventory.errors.adjustWouldGoNegative');

    // A claim that never became a real movement must not linger as a zero — it
    // would both lie in the history and block an honest retry of the same key.
    expect(movements).toHaveLength(0);
  });

  it('refuses a queued delta that would go negative, rather than clamping it', async () => {
    const { service, component } = harness(2);

    await expect(
      service.adjustQty('c1', -5, 'USED', undefined, 'op-3'),
    ).rejects.toThrow('inventory.errors.adjustWouldGoNegative');
    expect(component.quantity).toBe(2);
  });

  it('still clamps an ONLINE adjustment, where the person is looking at the shelf', async () => {
    const { service, component, movements } = harness(2);

    await service.adjustQty('c1', -5, 'USED');

    expect(component.quantity).toBe(0);
    // The movement records what actually happened, not what was asked for.
    expect(movements[0].delta).toBe(-2);
  });

  it('records the idempotency key on the movement it created', async () => {
    const { service, movements } = harness(1);
    await service.adjustQty('c1', 4, 'PURCHASE', undefined, 'op-4');
    expect(movements[0].clientOpId).toBe('op-4');
  });
});
