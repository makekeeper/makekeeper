// Pure day-bucketing helpers shared by the series API and the aggregation job.
// Kept side-effect-free (dates passed in) so they are unit-testable without a
// clock. All day keys are local-time `yyyy-mm-dd` strings, matching the format
// the existing chat activity aggregation already emits.

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Midnight (local) of the given date, as a new Date.
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Ascending `yyyy-mm-dd` keys for the window ending on `today` (inclusive),
// spanning `days` days. e.g. days=2, today=2026-07-16 → ['2026-07-15','2026-07-16'].
export function dayKeysEndingOn(days: number, today: Date): string[] {
  const span = Math.max(Math.trunc(days), 1);
  const end = startOfDay(today);
  const keys: string[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    keys.push(isoDay(d));
  }
  return keys;
}

// Ascending `yyyy-mm-dd` keys for every day in the half-open range [from, to).
export function dayKeysInRange(from: Date, to: Date): string[] {
  const start = startOfDay(from);
  const endExclusive = startOfDay(to);
  const keys: string[] = [];
  for (let d = new Date(start); d < endExclusive; d.setDate(d.getDate() + 1)) {
    keys.push(isoDay(d));
  }
  return keys;
}

// Collapse raw per-day rows onto a dense ordered set of day keys: sum any
// duplicates (e.g. one row per dimension/scope) and fill missing days with 0.
export function densify(
  rows: { date: string; value: number }[],
  dayKeys: string[],
): { date: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    sums.set(row.date, (sums.get(row.date) ?? 0) + row.value);
  }
  return dayKeys.map((date) => ({ date, value: sums.get(date) ?? 0 }));
}

// Deterministic JSON encoding of a dimension map (keys sorted) so the value is
// stable across runs — it participates in the StatsDaily unique constraint.
export function encodeDimensions(
  dimensions: Record<string, string> | undefined,
): string | null {
  if (!dimensions) return null;
  const keys = Object.keys(dimensions).sort();
  if (keys.length === 0) return null;
  return JSON.stringify(keys.map((k) => [k, dimensions[k]]));
}

// Inverse of encodeDimensions: turn a stored dimensions string back into a map
// (used by the grouped series read). Returns {} for null/empty; a malformed
// value yields {} rather than throwing.
export function decodeDimensions(
  encoded: string | null | undefined,
): Record<string, string> {
  if (!encoded) return {};
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const pair of parsed) {
      if (
        Array.isArray(pair) &&
        typeof pair[0] === 'string' &&
        typeof pair[1] === 'string'
      ) {
        out[pair[0]] = pair[1];
      }
    }
    return out;
  } catch {
    return {};
  }
}
