// What time it is where the person is sitting (#319).
//
// The model has no clock and no location. Without both it cannot answer "in two
// minutes" at all: it produced a bare repeat rule with no start (#318) and named
// UTC as the zone, which is the only one it can name without guessing and wrong
// for everyone not in it. So the prompt states the moment, in the caller's own
// zone, in the two shapes a schedule needs.
export interface ZonedNow {
  // "2026-08-29 03:07" — for the model to reason with.
  readable: string;
  // "20260829T030700" — the same moment in the shape DTSTART takes.
  stamp: string;
}

export function stampInZone(at: Date, zone: string): ZonedNow {
  // en-CA renders ISO-order date parts, and the parts are read by name anyway,
  // so the locale only decides the order of what is then reassembled by hand.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const at_ = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  // Midnight comes back as hour "24" in some runtimes; DTSTART has no such
  // hour, and neither does a sentence a person reads.
  const hour = at_('hour') === '24' ? '00' : at_('hour');
  const date = `${at_('year')}-${at_('month')}-${at_('day')}`;
  const time = `${hour}:${at_('minute')}`;
  return {
    readable: `${date} ${time}`,
    stamp: `${date.replace(/-/g, '')}T${time.replace(':', '')}${at_('second')}`,
  };
}
