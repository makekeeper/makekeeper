// Tiny field readers for exchange section records (#62). Archive JSON is
// untrusted input: every provider narrows each record from `unknown` and
// clamps strings before anything reaches Prisma. Centralised here so all
// providers validate the same way instead of hand-rolling guards.

export function isExchangeRecord(
  value: unknown,
  t: string,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['t'] === t
  );
}

// Plain nested-object guard for embedded snapshots (a project's `cover`, …).
export function isRecordObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Required string, length-clamped. Null when absent/not a string/empty.
export function readString(
  rec: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  const value = rec[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, max);
}

// Optional string: absent/null → null; a present non-string is also null.
export function readOptionalString(
  rec: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  const value = rec[key];
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, max)
    : null;
}

export function readNumber(
  rec: Record<string, unknown>,
  key: string,
): number | null {
  const value = rec[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readBoolean(
  rec: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = rec[key];
  return typeof value === 'boolean' ? value : fallback;
}

// ISO date string → Date; null when absent or unparsable.
export function readDate(
  rec: Record<string, unknown>,
  key: string,
): Date | null {
  const value = rec[key];
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Entity imports run with scope enforcement suspended (the policy's parent
// checks cannot see rows created inside the import transaction), so providers
// stamp the caller's scope explicitly on every scoped-model create…
export function exchangeScopeStamp(ctx: {
  preserveIds: boolean;
  scopeId: string | null;
}): { scopeId?: string | null } {
  // Instance restores write the archive's scopeIds verbatim instead.
  return ctx.preserveIds ? {} : { scopeId: ctx.scopeId };
}

// …and narrow their match/target lookups the same way. No filter in
// single-user mode — that mirrors the policy being inactive.
export function exchangeScopeFilter(ctx: {
  scopeId: string | null;
}): Record<string, unknown> {
  return ctx.scopeId ? { scopeId: ctx.scopeId } : {};
}

// One enum-ish value out of an allow-list, with a fallback. `find` keeps the
// narrowing cast-free: a hit is already typed as a member of `allowed`.
export function readOneOf<T extends string>(
  rec: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = rec[key];
  return allowed.find((entry) => entry === value) ?? fallback;
}
