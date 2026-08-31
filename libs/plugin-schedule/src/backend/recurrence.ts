import { rrulestr } from 'rrule';
import { fromFloating, isKnownTimezone, toFloating } from './zoned-time';

// RRULE (RFC 5545) read in a named zone (#308).
//
// rrule computes in plain UTC and has no zone of its own, which is exactly what
// is wanted here: the rule is evaluated against FLOATING dates (UTC fields
// holding the zone's wall clock), and the zone is applied once on the way in
// and once on the way out. That keeps "every Monday at 10:00" at 10:00 on both
// sides of a daylight-saving change, which a rule evaluated in UTC does not.
//
// RFC 5545 was chosen over a hand-rolled union of daily/weekly/monthly because
// the awkward cases — "the second Tuesday", "every weekday", a skipped date —
// are already specified, and because a calendar that speaks it can export what
// it holds later without re-deriving any of this.

export interface RecurrenceError {
  ok: false;
  // i18n key naming what is wrong; the caller resolves it in the person's own
  // locale rather than showing rrule's English (§5.5).
  reasonKey: string;
}

export type RecurrenceCheck = { ok: true } | RecurrenceError;

// A rule carries its own zone, and the rule and the record must not both claim
// one (#325).
//
// This module evaluates rules against FLOATING dates — UTC fields holding the
// zone's wall clock — and applies the zone once on each side. rrule, given a
// `DTSTART;TZID=...`, does that conversion ITSELF, so the offset was applied
// twice: a reminder two minutes ahead came back as an occurrence two hours
// behind, and the creation check refused it as having nothing ahead of it.
// (Verified against rrule: with a TZID, `after()` returns real instants; with a
// floating DTSTART it returns floating ones.)
//
// So the two are separated at the door: the digits stay in the rule, their zone
// moves to the record. A `Z` suffix means the digits are UTC and says so the
// same way.
const DTSTART_WITH_TZID = /^DTSTART;TZID=([^:\r\n]+):(\d{8}T\d{6})/m;
const DTSTART_IN_UTC = /^DTSTART:(\d{8}T\d{6})Z/m;

export function normalizeRule(
  rule: string,
  timezone: string,
): { rule: string; timezone: string } {
  const zoned = DTSTART_WITH_TZID.exec(rule);
  if (zoned) {
    return {
      rule: rule.replace(zoned[0], `DTSTART:${zoned[2]}`),
      // The zone the digits were written in wins over the one the caller
      // passed: it is the one the person meant when they wrote the time.
      timezone: isKnownTimezone(zoned[1]) ? zoned[1] : timezone,
    };
  }
  const utc = DTSTART_IN_UTC.exec(rule);
  if (utc) {
    return { rule: rule.replace(utc[0], `DTSTART:${utc[1]}`), timezone: 'UTC' };
  }
  return { rule, timezone };
}

// Validate a rule + zone pair before anything is stored. A schedule whose rule
// never parses is a row that silently never fires.
export function checkRecurrence(
  rule: string,
  timezone: string,
): RecurrenceCheck {
  if (!isKnownTimezone(timezone)) {
    return { ok: false, reasonKey: 'schedule.errors.unknownTimezone' };
  }
  try {
    rrulestr(rule);
  } catch {
    return { ok: false, reasonKey: 'schedule.errors.invalidRule' };
  }
  return { ok: true };
}

// The first firing strictly after `after`, or null when the rule has run out
// (a COUNT/UNTIL rule that is finished).
export function nextOccurrence(
  rule: string,
  timezone: string,
  after: Date,
): Date | null {
  try {
    const clean = normalizeRule(rule, timezone);
    const set = rrulestr(clean.rule);
    // `inc: false` — strictly after, so re-computing from the moment a firing
    // just happened cannot return that same moment and fire twice.
    const floating = set.after(toFloating(after, clean.timezone), false);
    return floating ? fromFloating(floating, clean.timezone) : null;
  } catch {
    return null;
  }
}

// Every firing in [from, to), capped. Used to count what was missed during
// downtime and to draw a rule's future occurrences on the calendar.
export function occurrencesBetween(
  rule: string,
  timezone: string,
  from: Date,
  to: Date,
  limit = 500,
): Date[] {
  try {
    // Normalized on read as well as on write: rows created before this was
    // understood still carry their zone inside the rule.
    const clean = normalizeRule(rule, timezone);
    const set = rrulestr(clean.rule);
    return set
      .between(
        toFloating(from, clean.timezone),
        toFloating(to, clean.timezone),
        true,
      )
      .slice(0, limit)
      .map((floating) => fromFloating(floating, clean.timezone));
  } catch {
    return [];
  }
}
