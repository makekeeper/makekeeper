// Wall clock ↔ instant, in a named zone (#308).
//
// This is the whole of why a schedule stores a timezone. "Every Monday at
// 10:00" is a WALL CLOCK statement: it means 10:00 on somebody's clock, which
// is a different instant in July than in January. Storing only the instant
// makes a daily 10:00 reminder arrive at 09:00 for half the year; storing only
// the wall clock leaves nothing to compare against `now`.
//
// The trick throughout is a "floating" Date: a Date whose UTC fields hold the
// wall-clock fields of the target zone. Recurrence maths then runs in plain UTC
// (which is what rrule does anyway) and the zone is applied exactly twice — on
// the way in and on the way out.

// The zone's offset from UTC at that instant, in minutes (positive east).
function offsetMinutesAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const at = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` renders midnight as 24 in some engines; normalise it.
  const hour = at('hour') % 24;
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    hour,
    at('minute'),
    at('second'),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

// Whether the runtime knows the zone at all. An unknown zone must not silently
// become UTC — that is how a schedule quietly fires at the wrong hour.
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// An instant → the floating Date holding its wall clock in `timezone`.
export function toFloating(instant: Date, timezone: string): Date {
  return new Date(
    instant.getTime() + offsetMinutesAt(instant, timezone) * 60_000,
  );
}

// A floating Date → the instant it names in `timezone`.
//
// Two passes, because the offset depends on the instant we are solving for. The
// first guess uses the offset at the naive instant; the second re-reads it at
// the candidate, which is what gets a spring-forward morning right. Where the
// wall clock does not exist (the hour a spring-forward skips) the result lands
// on the following real instant rather than looping — a reminder set for a time
// the day never has still has to happen.
export function fromFloating(floating: Date, timezone: string): Date {
  const guessOffset = offsetMinutesAt(floating, timezone);
  const candidate = new Date(floating.getTime() - guessOffset * 60_000);
  const actualOffset = offsetMinutesAt(candidate, timezone);
  if (actualOffset === guessOffset) return candidate;
  return new Date(floating.getTime() - actualOffset * 60_000);
}
