// Building an RFC 5545 rule from what a person actually picks (#309).
//
// The UI offers the four repeats a workshop needs — once, every day, every
// weekday, weekly on chosen days — and writes them as a standard rule, so the
// stored value is the same thing a calendar would store and the awkward cases
// stay expressible by anyone who edits the rule later.

export type ReminderRepeat = 'once' | 'daily' | 'weekdays' | 'weekly';

// RFC 5545 weekday codes, Monday first because that is how the app's own week
// reads.
export const WEEKDAY_CODES = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
] as const;

export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

// `20260105T100000` — a local wall clock, deliberately without a `Z`: the zone
// travels beside the rule, and stamping UTC here would bake in today's offset.
function stamp(date: string, time: string): string {
  const [hour, minute] = time.split(':');
  return `${date.split('-').join('')}T${hour}${minute}00`;
}

export interface ReminderRuleInput {
  repeat: ReminderRepeat;
  // `yyyy-mm-dd` — the first (or only) occurrence.
  date: string;
  // `HH:MM`, 24-hour, as TimePicker always produces.
  time: string;
  weekdays: WeekdayCode[];
}

export function buildRrule(input: ReminderRuleInput): string {
  // No TZID: the digits are the wall clock, and the zone travels beside the
  // rule on the record. Writing `TZID=UTC` here was a filler that made the rule
  // claim a zone it did not mean, and left two places claiming one (#325).
  const dtstart = `DTSTART:${stamp(input.date, input.time)}`;
  switch (input.repeat) {
    case 'once':
      // A one-off is a rule that happens exactly once, not a special case in
      // the engine: everything downstream keeps one shape.
      return `${dtstart}\nRRULE:FREQ=DAILY;COUNT=1`;
    case 'daily':
      return `${dtstart}\nRRULE:FREQ=DAILY`;
    case 'weekdays':
      return `${dtstart}\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`;
    case 'weekly': {
      const days = input.weekdays.length > 0 ? input.weekdays : ['MO'];
      return `${dtstart}\nRRULE:FREQ=WEEKLY;BYDAY=${days.join(',')}`;
    }
  }
}

// The zone the person is standing in. There is no server-side preference to
// read it from (#211), and a schedule without a zone is a schedule that drifts.
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
