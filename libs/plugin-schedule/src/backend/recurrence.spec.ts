import {
  checkRecurrence,
  nextOccurrence,
  normalizeRule,
  occurrencesBetween,
} from './recurrence';

// "Every Monday at 10:00", written as a calendar would write it.
// Floating digits: the zone is the record's, never the rule's (#325).
const MONDAY_10 = 'DTSTART:20260105T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO';
const DAILY_10 = 'DTSTART:20260105T100000\nRRULE:FREQ=DAILY';

describe('checkRecurrence', () => {
  it('refuses an unknown zone rather than quietly using UTC', () => {
    expect(checkRecurrence(MONDAY_10, 'Mars/Olympus')).toEqual({
      ok: false,
      reasonKey: 'schedule.errors.unknownTimezone',
    });
  });

  it('refuses a rule that does not parse', () => {
    expect(checkRecurrence('not a rule at all', 'Europe/Berlin')).toEqual({
      ok: false,
      reasonKey: 'schedule.errors.invalidRule',
    });
  });

  it('accepts a rule and a zone the runtime knows', () => {
    expect(checkRecurrence(MONDAY_10, 'Europe/Berlin')).toEqual({ ok: true });
  });
});

describe('nextOccurrence', () => {
  it('fires at the stated wall clock in the stated zone', () => {
    const next = nextOccurrence(
      MONDAY_10,
      'Europe/Moscow',
      new Date('2026-01-05T00:00:00Z'),
    );
    // 10:00 Moscow is 07:00 UTC, all year.
    expect(next?.toISOString()).toBe('2026-01-05T07:00:00.000Z');
  });

  it('keeps a daily 10:00 at 10:00 across a DST change', () => {
    const winter = nextOccurrence(
      DAILY_10,
      'Europe/Berlin',
      new Date('2026-01-05T00:00:00Z'),
    );
    const summer = nextOccurrence(
      DAILY_10,
      'Europe/Berlin',
      new Date('2026-07-06T00:00:00Z'),
    );
    expect(winter?.toISOString()).toBe('2026-01-05T09:00:00.000Z');
    expect(summer?.toISOString()).toBe('2026-07-06T08:00:00.000Z');
  });

  it('is strictly after its argument, so a firing cannot repeat itself', () => {
    const at = new Date('2026-01-05T07:00:00Z');
    const next = nextOccurrence(DAILY_10, 'Europe/Moscow', at);
    expect(next?.toISOString()).toBe('2026-01-06T07:00:00.000Z');
  });

  it('answers null when the rule has run out', () => {
    const once = 'DTSTART;TZID=UTC:20260105T100000\nRRULE:FREQ=DAILY;COUNT=1';
    expect(
      nextOccurrence(once, 'Europe/Moscow', new Date('2026-01-06T00:00:00Z')),
    ).toBeNull();
  });
});

describe('occurrencesBetween', () => {
  it('counts what a week of downtime missed', () => {
    const missed = occurrencesBetween(
      DAILY_10,
      'Europe/Moscow',
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-12T00:00:00Z'),
    );
    expect(missed).toHaveLength(7);
  });
});

describe('a rule that names its own zone (#325)', () => {
  // The exact rule the agent sent, and the moment it sent it: two minutes
  // ahead in Belgrade. Before normalization rrule converted the occurrence to
  // a real instant while the comparison point was still floating, so a future
  // firing looked two hours past and creation refused it.
  const RULE =
    'DTSTART;TZID=Europe/Belgrade:20260829T040642\nRRULE:FREQ=MINUTELY;COUNT=1';
  const NOW = new Date('2026-08-29T02:04:00.000Z');

  it('finds the firing that is actually ahead', () => {
    const next = nextOccurrence(RULE, 'Europe/Belgrade', NOW);
    expect(next?.toISOString()).toBe('2026-08-29T02:06:42.000Z');
  });

  it('moves the zone out of the rule and onto the record', () => {
    const clean = normalizeRule(RULE, 'UTC');
    expect(clean.rule).toContain('DTSTART:20260829T040642');
    expect(clean.rule).not.toContain('TZID');
    // The zone the digits were written in wins over the one passed alongside.
    expect(clean.timezone).toBe('Europe/Belgrade');
  });

  it('reads a Z suffix as the zone it is', () => {
    const clean = normalizeRule(
      'DTSTART:20260829T020000Z\nRRULE:FREQ=DAILY',
      'Europe/Belgrade',
    );
    expect(clean.rule).toContain('DTSTART:20260829T020000');
    expect(clean.timezone).toBe('UTC');
  });

  it('leaves a floating rule and its zone alone', () => {
    const clean = normalizeRule(
      'DTSTART:20260829T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
      'Europe/Moscow',
    );
    expect(clean.rule).toContain('DTSTART:20260829T100000');
    expect(clean.timezone).toBe('Europe/Moscow');
  });

  it('keeps the record’s zone when the rule names one nobody knows', () => {
    const clean = normalizeRule(
      'DTSTART;TZID=Mars/Olympus:20260829T100000\nRRULE:FREQ=DAILY',
      'Europe/Moscow',
    );
    expect(clean.timezone).toBe('Europe/Moscow');
  });

  it('lists the occurrences of a zoned rule in the window they fall in', () => {
    const found = occurrencesBetween(
      RULE,
      'Europe/Belgrade',
      new Date('2026-08-29T02:00:00.000Z'),
      new Date('2026-08-29T03:00:00.000Z'),
    );
    expect(found.map((date) => date.toISOString())).toEqual([
      '2026-08-29T02:06:42.000Z',
    ]);
  });
});
