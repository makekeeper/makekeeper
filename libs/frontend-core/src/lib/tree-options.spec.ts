import { describe, it, expect } from 'vitest';
import { buildTreeOptions } from './tree-options';

const rows = [
  { value: 'r', label: 'Resistors', parentValue: 'p', order: 0 },
  { value: 'm', label: 'Mechanical', parentValue: null, order: 1 },
  { value: 'e', label: 'Electronics', parentValue: null, order: 0 },
  { value: 'p', label: 'Passive', parentValue: 'e', order: 0 },
];

describe('buildTreeOptions', () => {
  it('emits depth-first, parents before their children', () => {
    expect(buildTreeOptions(rows).map((o) => [o.value, o.depth])).toEqual([
      ['e', 0],
      ['p', 1],
      ['r', 2],
      ['m', 0],
    ]);
  });

  it('carries the parent so a consumer can walk back up', () => {
    const byValue = new Map(buildTreeOptions(rows).map((o) => [o.value, o]));
    expect(byValue.get('r')?.parentValue).toBe('p');
    expect(byValue.get('e')?.parentValue).toBeNull();
  });

  it('sorts siblings by order, then by label', () => {
    const labels = buildTreeOptions([
      { value: 'b', label: 'Bravo', parentValue: null, order: 0 },
      { value: 'a', label: 'Alpha', parentValue: null, order: 0 },
      { value: 'c', label: 'Charlie', parentValue: null, order: -1 },
    ]).map((o) => o.label);
    expect(labels).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('surfaces a row whose parent is not in the set instead of dropping it', () => {
    const out = buildTreeOptions([
      { value: 'x', label: 'Orphan', parentValue: 'gone', order: 0 },
    ]);
    expect(out).toEqual([
      { value: 'x', label: 'Orphan', depth: 0, parentValue: null },
    ]);
  });

  it('terminates on a cycle rather than walking it forever', () => {
    const out = buildTreeOptions([
      { value: 'a', label: 'A', parentValue: 'b', order: 0 },
      { value: 'b', label: 'B', parentValue: 'a', order: 0 },
    ]);
    // Neither row can be a root, so nothing is reachable from the top — the
    // point is that this RETURNS.
    expect(out).toEqual([]);
  });
});
