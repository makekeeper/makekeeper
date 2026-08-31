import {
  MAX_YEAR,
  MIN_YEAR,
  isShowableYear,
  yearChoices,
} from './calendar-grid';

describe('yearChoices', () => {
  it('offers a short window around the current year', () => {
    expect(yearChoices(2026, 2026)).toEqual([
      2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031,
    ]);
  });

  it('keeps the year being looked at, however far out it is', () => {
    expect(yearChoices(2026, 2040)).toContain(2040);
  });

  it('offers the years the loaded window holds', () => {
    expect(yearChoices(2026, 2026, [2035, 2035, 2019])).toEqual(
      expect.arrayContaining([2019, 2035]),
    );
  });

  it('lists every year once, in order', () => {
    const years = yearChoices(2026, 2028, [2026, 2040]);
    expect([...new Set(years)]).toEqual(years);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it('drops a year the calendar could not show', () => {
    expect(yearChoices(2026, 2026, [999, 30000])).not.toContain(999);
  });

  it('rejects what is not a year', () => {
    expect(isShowableYear(Number.NaN)).toBe(false);
    expect(isShowableYear(2026.5)).toBe(false);
    expect(isShowableYear(MIN_YEAR - 1)).toBe(false);
    expect(isShowableYear(MAX_YEAR + 1)).toBe(false);
    expect(isShowableYear(2026)).toBe(true);
  });
});
