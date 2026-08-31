import { fromFloating, isKnownTimezone, toFloating } from './zoned-time';

const iso = (date: Date): string => date.toISOString();

describe('zoned time', () => {
  it('rejects a zone the runtime does not know', () => {
    expect(isKnownTimezone('Europe/Moscow')).toBe(true);
    expect(isKnownTimezone('Mars/Olympus')).toBe(false);
  });

  it('reads an instant as the wall clock of its zone', () => {
    // 07:00 UTC is 10:00 in Moscow, which does not observe DST.
    const floating = toFloating(
      new Date('2026-01-05T07:00:00Z'),
      'Europe/Moscow',
    );
    expect(iso(floating)).toBe('2026-01-05T10:00:00.000Z');
  });

  it('turns a wall clock back into the instant it names', () => {
    const instant = fromFloating(
      new Date('2026-01-05T10:00:00Z'),
      'Europe/Moscow',
    );
    expect(iso(instant)).toBe('2026-01-05T07:00:00.000Z');
  });

  it('keeps a daily 10:00 at 10:00 across a DST change', () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer. The same wall clock is a
    // different instant on the two sides — which is the entire point.
    const winter = fromFloating(
      new Date('2026-01-05T10:00:00Z'),
      'Europe/Berlin',
    );
    const summer = fromFloating(
      new Date('2026-07-06T10:00:00Z'),
      'Europe/Berlin',
    );
    expect(iso(winter)).toBe('2026-01-05T09:00:00.000Z');
    expect(iso(summer)).toBe('2026-07-06T08:00:00.000Z');
  });

  it('round-trips either side of a spring-forward', () => {
    for (const wall of [
      '2026-03-29T01:30:00Z',
      '2026-03-29T04:30:00Z',
      '2026-10-25T04:30:00Z',
    ]) {
      const instant = fromFloating(new Date(wall), 'Europe/Berlin');
      expect(iso(toFloating(instant, 'Europe/Berlin'))).toBe(
        new Date(wall).toISOString(),
      );
    }
  });

  it('lands a skipped wall clock on a real instant', () => {
    // 02:30 does not exist in Berlin on the spring-forward night; the schedule
    // still has to fire, so it resolves to the following real instant.
    const instant = fromFloating(
      new Date('2026-03-29T02:30:00Z'),
      'Europe/Berlin',
    );
    expect(iso(instant)).toBe('2026-03-29T01:30:00.000Z');
  });
});
