import type { CalendarItem } from '@makekeeper/plugin-contract';

// The arithmetic behind the calendar screen, kept out of the component so it
// can be checked without mounting anything (#310).

export type CalendarView = 'month' | 'week' | 'agenda';

// `yyyy-mm-dd` in LOCAL time. Not `toISOString().slice(0, 10)`, which is UTC
// and puts an evening event on tomorrow for anyone east of Greenwich.
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Monday-first, because that is how the rest of the app reads a week.
export function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}

// The window a view needs, which for a month is NOT the month: the grid shows
// the days either side that complete the first and last weeks, and they have to
// be filled or the row starts empty and fills in as the person scrolls.
export function rangeFor(
  view: CalendarView,
  anchor: Date,
): {
  from: Date;
  to: Date;
} {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }
  if (view === 'agenda') {
    const from = startOfDay(anchor);
    const to = new Date(from);
    to.setDate(to.getDate() + 30);
    return { from, to };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(first);
  const to = new Date(from);
  to.setDate(to.getDate() + 42);
  return { from, to };
}

// The six weeks a month grid always draws. Always six, never five-or-six: a
// grid that changes height as the month changes moves everything below it.
export function monthGrid(anchor: Date): Date[] {
  const { from } = rangeFor('month', anchor);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(from);
    day.setDate(day.getDate() + index);
    return day;
  });
}

export function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.at.localeCompare(b.at));
  }
  return map;
}

export function shiftAnchor(
  view: CalendarView,
  anchor: Date,
  direction: 1 | -1,
): Date {
  const next = new Date(anchor);
  if (view === 'month') next.setMonth(next.getMonth() + direction);
  else if (view === 'week') next.setDate(next.getDate() + 7 * direction);
  else next.setDate(next.getDate() + 30 * direction);
  return next;
}

// ── The year picker's list (#314) ──────────────────────────────────────────
//
// A fixed window around today is the FLOOR, not the answer: it is never empty
// and never long to scan, and anything outside it is still reachable by typing.
// What the window is then widened by is what would otherwise be unreachable by
// eye — the year being looked at, and the years the loaded window actually
// holds.
export const YEARS_BACK = 2;
export const YEARS_AHEAD = 5;

// What counts as a year at all. Wide enough that nobody meets the edge, narrow
// enough that a slipped digit ("20265") is caught rather than silently
// scrolling the calendar into the year 20265.
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2999;

export function yearChoices(
  currentYear: number,
  anchorYear: number,
  itemYears: number[] = [],
): number[] {
  const years = new Set<number>();
  for (
    let year = currentYear - YEARS_BACK;
    year <= currentYear + YEARS_AHEAD;
    year++
  ) {
    years.add(year);
  }
  years.add(anchorYear);
  for (const year of itemYears) years.add(year);
  return [...years].filter(isShowableYear).sort((a, b) => a - b);
}

export function isShowableYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}
