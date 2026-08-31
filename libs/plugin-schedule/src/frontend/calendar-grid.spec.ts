import {
  dayKey,
  groupByDay,
  monthGrid,
  rangeFor,
  shiftAnchor,
  startOfWeek,
} from './calendar-grid';

describe('dayKey', () => {
  it('reads the LOCAL day, not the UTC one', () => {
    // 23:30 local on the 5th is the 6th in UTC east of Greenwich; putting the
    // event on the wrong day is the classic calendar bug.
    const evening = new Date(2026, 0, 5, 23, 30);
    expect(dayKey(evening)).toBe('2026-01-05');
  });
});

describe('startOfWeek', () => {
  it('starts on Monday', () => {
    // 2026-01-08 is a Thursday.
    expect(dayKey(startOfWeek(new Date(2026, 0, 8)))).toBe('2026-01-05');
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    expect(dayKey(startOfWeek(new Date(2026, 0, 11)))).toBe('2026-01-05');
  });
});

describe('monthGrid', () => {
  it('always draws six weeks, so the page below it never moves', () => {
    for (const month of [0, 1, 4, 11]) {
      expect(monthGrid(new Date(2026, month, 15))).toHaveLength(42);
    }
  });

  it('begins on the Monday that completes the first week', () => {
    // February 2026 starts on a Sunday, so the grid opens in January.
    expect(dayKey(monthGrid(new Date(2026, 1, 15))[0] as Date)).toBe(
      '2026-01-26',
    );
  });
});

describe('rangeFor', () => {
  it('asks for the whole drawn grid, not just the month', () => {
    const { from, to } = rangeFor('month', new Date(2026, 1, 15));
    expect(dayKey(from)).toBe('2026-01-26');
    expect(dayKey(to)).toBe('2026-03-09');
  });
});

describe('groupByDay', () => {
  it('buckets by local day and orders within a day', () => {
    const grouped = groupByDay([
      {
        ref: 'mk://a/b/2',
        kindKey: 'k',
        title: 'later',
        field: 'f',
        at: new Date(2026, 0, 5, 18).toISOString(),
      },
      {
        ref: 'mk://a/b/1',
        kindKey: 'k',
        title: 'earlier',
        field: 'f',
        at: new Date(2026, 0, 5, 9).toISOString(),
      },
    ]);
    expect(grouped.get('2026-01-05')?.map((item) => item.title)).toEqual([
      'earlier',
      'later',
    ]);
  });
});

describe('shiftAnchor', () => {
  it('moves by the unit the view is showing', () => {
    const anchor = new Date(2026, 0, 15);
    expect(shiftAnchor('month', anchor, 1).getMonth()).toBe(1);
    expect(dayKey(shiftAnchor('week', anchor, -1))).toBe('2026-01-08');
  });
});
