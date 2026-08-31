import { buildRrule } from './reminder-rule';

const base = { date: '2026-01-05', time: '10:00', weekdays: [] as never[] };

describe('buildRrule', () => {
  it('writes a one-off as a rule that happens once', () => {
    // Not a special case downstream: the engine only ever sees a rule.
    expect(buildRrule({ ...base, repeat: 'once' })).toBe(
      'DTSTART:20260105T100000\nRRULE:FREQ=DAILY;COUNT=1',
    );
  });

  it('writes the wall clock without a Z, so the zone beside it decides', () => {
    expect(buildRrule({ ...base, repeat: 'daily' })).toContain(
      '20260105T100000',
    );
  });

  it('writes every weekday as the five named days', () => {
    expect(buildRrule({ ...base, repeat: 'weekdays' })).toContain(
      'BYDAY=MO,TU,WE,TH,FR',
    );
  });

  it('falls back to Monday when weekly names no day', () => {
    expect(buildRrule({ ...base, repeat: 'weekly' })).toContain('BYDAY=MO');
  });

  it('keeps the days a person picked, in the order given', () => {
    expect(
      buildRrule({ ...base, repeat: 'weekly', weekdays: ['MO', 'TH'] }),
    ).toContain('BYDAY=MO,TH');
  });
});
