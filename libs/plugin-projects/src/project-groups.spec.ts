import { describe, it, expect } from 'vitest';
import {
  buildGroupTreeRows,
  collectGroupSubtreeIds,
  groupAncestorPath,
  normalizeGroupName,
  type ProjectGroupDto,
} from './project-groups';

// The shared, framework-agnostic half of the group contract. The tree walk lives
// here rather than in the settings component so the order it produces, and what
// a collapsed branch actually hides, stay checkable without rendering anything.

const group = (
  id: string,
  name: string,
  parentId: string | null = null,
  position = 0,
): ProjectGroupDto => ({ id, name, parentId, position, isDefault: false });

//  General
//  Electronics
//    PCB
//      Standard
//    Firmware
//  Hardware
const tree: ProjectGroupDto[] = [
  { ...group('gen', 'General'), isDefault: true },
  group('elec', 'Electronics', null, 1),
  group('pcb', 'PCB', 'elec'),
  group('std', 'Standard', 'pcb'),
  group('fw', 'Firmware', 'elec', 1),
  group('hw', 'Hardware', null, 2),
];

describe('buildGroupTreeRows', () => {
  const rows = buildGroupTreeRows(tree, new Set());
  const row = (id: string) => rows.find((r) => r.group.id === id);

  it('walks depth-first in sibling order', () => {
    expect(rows.map((r) => r.group.id)).toEqual([
      'gen',
      'elec',
      'pcb',
      'std',
      'fw',
      'hw',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 2, 1, 0]);
  });

  it('hides the subtree of a collapsed branch but keeps the row', () => {
    const rows = buildGroupTreeRows(tree, new Set(['elec']));
    expect(rows.map((r) => r.group.id)).toEqual(['gen', 'elec', 'hw']);
    expect(rows.find((r) => r.group.id === 'elec')?.expanded).toBe(false);
    expect(rows.find((r) => r.group.id === 'elec')?.hasChildren).toBe(true);
  });
});

describe('collectGroupSubtreeIds', () => {
  it('includes the root and every descendant', () => {
    expect(collectGroupSubtreeIds('elec', tree).sort()).toEqual([
      'elec',
      'fw',
      'pcb',
      'std',
    ]);
  });

  it('resolves an unknown id to itself alone', () => {
    expect(collectGroupSubtreeIds('ghost', tree)).toEqual(['ghost']);
  });
});

describe('groupAncestorPath', () => {
  it('reads root first, the group itself last', () => {
    expect(groupAncestorPath('std', tree)).toEqual([
      'Electronics',
      'PCB',
      'Standard',
    ]);
  });
});

describe('normalizeGroupName', () => {
  it('folds case and surrounding space', () => {
    expect(normalizeGroupName('  Hardware ')).toBe(
      normalizeGroupName('hardware'),
    );
  });
});
