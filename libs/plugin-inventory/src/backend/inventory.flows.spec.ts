import {
  aggregateProjectFlows,
  type FlowMovementRow,
} from './inventory.service';

const mv = (
  type: string,
  delta: number,
  extra: Partial<FlowMovementRow> = {},
): FlowMovementRow => ({
  type,
  delta,
  projectId: null,
  orderId: null,
  ...extra,
});

const run = (
  movements: FlowMovementRow[],
  opts: {
    supplierByOrder?: Map<string, { id: string; name: string } | null>;
    projectTitles?: Map<string, string>;
    currentStock?: number;
  } = {},
) =>
  aggregateProjectFlows({
    movements,
    supplierByOrder: opts.supplierByOrder ?? new Map(),
    projectTitles: opts.projectTitles ?? new Map(),
    currentStock: opts.currentStock ?? 0,
  });

describe('aggregateProjectFlows', () => {
  it('counts reserve→consume once: drawn from RESERVED−, used from USED−', () => {
    const flows = run(
      [
        mv('RESERVED', -5, { projectId: 'p1' }),
        mv('USED', -5, { projectId: 'p1' }),
      ],
      { projectTitles: new Map([['p1', 'Robot']]) },
    );
    expect(flows.projects).toEqual([
      {
        id: 'p1',
        title: 'Robot',
        drawn: 5,
        used: 5,
        returned: 0,
        stillReserved: 0,
      },
    ]);
  });

  it('splits a project outcome into used / returned / still reserved', () => {
    const flows = run([
      mv('RESERVED', -10, { projectId: 'p1' }),
      mv('USED', -4, { projectId: 'p1' }),
      mv('RETURN', 2, { projectId: 'p1' }),
      mv('RESERVED', 1, { projectId: 'p1' }), // reservation release
    ]);
    expect(flows.projects[0]).toMatchObject({
      drawn: 10,
      used: 4,
      returned: 3,
      stillReserved: 3,
    });
  });

  it('clamps stillReserved at zero when returns exceed the window drawn', () => {
    const flows = run([
      mv('RESERVED', -1, { projectId: 'p1' }),
      mv('RETURN', 5, { projectId: 'p1' }), // return of a pre-window reservation
    ]);
    expect(flows.projects[0].stillReserved).toBe(0);
  });

  it('keeps the top suppliers and folds ranks beyond the top plus supplier-less receipts', () => {
    const supplierByOrder = new Map(
      ['a', 'b', 'c', 'd'].map((id, i) => [
        `o${i}`,
        { id, name: id.toUpperCase() },
      ]),
    );
    const flows = run(
      [
        mv('PURCHASE', 40, { orderId: 'o0' }),
        mv('PURCHASE', 30, { orderId: 'o1' }),
        mv('PURCHASE', 20, { orderId: 'o2' }),
        mv('PURCHASE', 10, { orderId: 'o3' }), // rank 4 → folded
        mv('PURCHASE', 7), // no order → folded
      ],
      { supplierByOrder },
    );
    expect(flows.suppliers.map((s) => s.id)).toEqual(['a', 'b', 'c', null]);
    expect(flows.suppliers[3].units).toBe(17);
  });

  it('keeps the top-5 projects and aggregates the rest into others', () => {
    const movements = Array.from({ length: 7 }, (_, i) =>
      mv('RESERVED', -(10 - i), { projectId: `p${i}` }),
    );
    const flows = run(movements);
    expect(flows.projects).toHaveLength(5);
    expect(flows.projects[0].id).toBe('p0');
    expect(flows.others).toMatchObject({ count: 2, drawn: 4 + 5 });
  });

  it('splits non-project positives into supplier receipts vs adjustments and negatives into write-offs', () => {
    const flows = run([
      mv('ADJUSTMENT', 8),
      mv('RETURN', 2), // no projectId → an inbound correction
      mv('ADJUSTMENT', -3),
      mv('RETURN', -4, { orderId: 'o9' }), // return to supplier
    ]);
    expect(flows.adjustmentsIn).toBe(10);
    expect(flows.writeOffs).toBe(7);
    expect(flows.suppliers).toEqual([]);
  });

  it('resolves missing project titles to null', () => {
    const flows = run([mv('RESERVED', -1, { projectId: 'ghost' })]);
    expect(flows.projects[0].title).toBeNull();
  });
});
