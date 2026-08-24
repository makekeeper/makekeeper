import { Test } from '@nestjs/testing';
import { PrismaService } from '@makekeeper/backend-core';
import {
  formatCellAddress,
  parseCellAddress,
} from '@makekeeper/plugin-contract';
import { StoragesService } from './storages.service';

// The grid-address convention must match the UI (frontend getCellAddress): column
// letter from the 0-based column, row number from the 0-based row. (row 0, col 0)
// = "A1". These helpers stop the agent from mislabelling cells (issue #15).
describe('cell address helpers', () => {
  it('formats (row, col) to the UI address', () => {
    expect(formatCellAddress(0, 0)).toBe('A1');
    expect(formatCellAddress(0, 1)).toBe('B1');
    expect(formatCellAddress(2, 0)).toBe('A3');
    expect(formatCellAddress(null, 1)).toBeNull();
    expect(formatCellAddress(1, undefined)).toBeNull();
  });

  it('formats columns past Z as bijective base-26 letters', () => {
    expect(formatCellAddress(0, 25)).toBe('Z1');
    expect(formatCellAddress(0, 26)).toBe('AA1');
    expect(formatCellAddress(2, 27)).toBe('AB3');
    expect(formatCellAddress(0, 51)).toBe('AZ1');
    expect(formatCellAddress(0, 52)).toBe('BA1');
    expect(formatCellAddress(0, 701)).toBe('ZZ1');
    expect(formatCellAddress(0, 702)).toBe('AAA1');
  });

  it('rejects coordinates that are not non-negative integers', () => {
    expect(formatCellAddress(-1, 0)).toBeNull();
    expect(formatCellAddress(0, -1)).toBeNull();
    expect(formatCellAddress(2.5, 0)).toBeNull();
    expect(formatCellAddress(0, 1.5)).toBeNull();
  });

  it('parses an address back to (row, col), inverse of formatting', () => {
    expect(parseCellAddress('A1')).toEqual({ row: 0, col: 0 });
    expect(parseCellAddress('B1')).toEqual({ row: 0, col: 1 });
    expect(parseCellAddress('a3')).toEqual({ row: 2, col: 0 });
    expect(parseCellAddress('AA1')).toEqual({ row: 0, col: 26 });
    expect(parseCellAddress('ab3')).toEqual({ row: 2, col: 27 });
    expect(parseCellAddress('A0')).toBeNull(); // row 0 → number must be ≥ 1
    expect(parseCellAddress('B03')).toBeNull(); // zero-padding is non-canonical
    expect(parseCellAddress('11')).toBeNull();
    expect(parseCellAddress('A1.5')).toBeNull();
    expect(parseCellAddress('')).toBeNull();
  });

  it('round-trips every valid coordinate pair', () => {
    for (const [row, col] of [
      [0, 0],
      [7, 25],
      [0, 26],
      [41, 51],
      [2, 702],
      [999, 18277],
    ]) {
      const address = formatCellAddress(row, col);
      expect(address).not.toBeNull();
      expect(parseCellAddress(address as string)).toEqual({ row, col });
    }
  });
});

// Covers the cell-scoped branch of getComponents: passing a cell
// (row/col) restricts results to that single grid cell — direct components at the
// coordinate plus the contents of any nested storages placed in that cell — instead
// of the default whole-storage recursive search.
describe('StoragesService.getComponents — cell filter', () => {
  let service: StoragesService;
  let findManyStorage: jest.Mock;
  let findManyComponent: jest.Mock;

  // Storage tree: root has a nested "box" sitting in cell (row 0, col 1).
  const storages = [
    { id: 'root', parentId: null, parentRow: null, parentCol: null },
    { id: 'box', parentId: 'root', parentRow: 0, parentCol: 1 },
    { id: 'other', parentId: 'root', parentRow: 2, parentCol: 2 },
  ];

  beforeEach(async () => {
    findManyStorage = jest.fn(() => Promise.resolve(storages));
    findManyComponent = jest.fn(() => Promise.resolve([]));
    const moduleRef = await Test.createTestingModule({
      providers: [
        StoragesService,
        {
          provide: PrismaService,
          useValue: {
            storage: { findMany: findManyStorage },
            component: { findMany: findManyComponent },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(StoragesService);
  });

  const whereOf = (): Record<string, unknown> =>
    findManyComponent.mock.calls[0][0].where;

  it('without a cell, searches the whole storage subtree recursively', async () => {
    await service.getComponents('root');
    expect(whereOf()).toEqual({ storageId: { in: ['root', 'box', 'other'] } });
  });

  it('with a cell, returns direct components plus nested-container contents of that cell', async () => {
    await service.getComponents('root', { row: 0, col: 1 });
    expect(whereOf()).toEqual({
      OR: [
        { storageId: 'root', storageRow: 0, storageCol: 1 },
        { storageId: { in: ['box'] } },
      ],
    });
  });

  it('with an empty cell (no nested containers), filters to just the coordinate', async () => {
    await service.getComponents('root', { row: 4, col: 4 });
    expect(whereOf()).toEqual({
      OR: [{ storageId: 'root', storageRow: 4, storageCol: 4 }],
    });
  });
});
