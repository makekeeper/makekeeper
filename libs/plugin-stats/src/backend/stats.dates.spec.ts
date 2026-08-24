import {
  dayKeysEndingOn,
  dayKeysInRange,
  decodeDimensions,
  densify,
  encodeDimensions,
  isoDay,
  startOfDay,
} from './stats.dates';

describe('stats.dates', () => {
  it('isoDay formats local y-m-d with zero padding', () => {
    expect(isoDay(new Date(2026, 6, 5))).toBe('2026-07-05');
    expect(isoDay(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('startOfDay zeroes the time components', () => {
    const d = startOfDay(new Date(2026, 6, 16, 13, 45, 12, 500));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(isoDay(d)).toBe('2026-07-16');
  });

  it('dayKeysEndingOn returns an ascending inclusive window', () => {
    const keys = dayKeysEndingOn(3, new Date(2026, 6, 16));
    expect(keys).toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });

  it('dayKeysEndingOn clamps a non-positive span to one day', () => {
    expect(dayKeysEndingOn(0, new Date(2026, 6, 16))).toEqual(['2026-07-16']);
  });

  it('dayKeysInRange enumerates a half-open range', () => {
    const keys = dayKeysInRange(new Date(2026, 6, 14), new Date(2026, 6, 16));
    expect(keys).toEqual(['2026-07-14', '2026-07-15']);
  });

  it('densify sums duplicates and fills gaps with zero', () => {
    const rows = [
      { date: '2026-07-14', value: 2 },
      { date: '2026-07-14', value: 3 },
      { date: '2026-07-16', value: 1 },
    ];
    const keys = ['2026-07-14', '2026-07-15', '2026-07-16'];
    expect(densify(rows, keys)).toEqual([
      { date: '2026-07-14', value: 5 },
      { date: '2026-07-15', value: 0 },
      { date: '2026-07-16', value: 1 },
    ]);
  });

  it('encodeDimensions is stable regardless of key order, null when empty', () => {
    expect(encodeDimensions(undefined)).toBeNull();
    expect(encodeDimensions({})).toBeNull();
    expect(encodeDimensions({ b: '2', a: '1' })).toBe(
      encodeDimensions({ a: '1', b: '2' }),
    );
    expect(encodeDimensions({ a: '1', b: '2' })).toBe('[["a","1"],["b","2"]]');
  });

  it('decodeDimensions inverts encodeDimensions and tolerates junk', () => {
    expect(decodeDimensions(null)).toEqual({});
    expect(decodeDimensions('')).toEqual({});
    expect(decodeDimensions('not json')).toEqual({});
    const enc = encodeDimensions({ provider: 'openai', model: 'gpt' });
    expect(decodeDimensions(enc)).toEqual({ provider: 'openai', model: 'gpt' });
  });
});
