import { stampInZone } from './clock';

describe('stampInZone', () => {
  const moment = new Date('2026-08-29T01:07:09.000Z');

  it('tells the time where the person is, not where the server is', () => {
    expect(stampInZone(moment, 'Europe/Belgrade').readable).toBe(
      '2026-08-29 03:07',
    );
    expect(stampInZone(moment, 'UTC').readable).toBe('2026-08-29 01:07');
  });

  it('crosses the date line with the zone', () => {
    expect(stampInZone(moment, 'Pacific/Auckland').readable).toBe(
      '2026-08-29 13:07',
    );
    expect(stampInZone(moment, 'America/Los_Angeles').readable).toBe(
      '2026-08-28 18:07',
    );
  });

  it('writes the same moment in the shape DTSTART takes', () => {
    expect(stampInZone(moment, 'Europe/Belgrade').stamp).toBe(
      '20260829T030709',
    );
  });

  it('writes midnight as hour zero, never as hour 24', () => {
    const midnight = new Date('2026-08-28T22:00:00.000Z');
    const zoned = stampInZone(midnight, 'Europe/Belgrade');
    expect(zoned.readable).toBe('2026-08-29 00:00');
    expect(zoned.stamp).toBe('20260829T000000');
  });
});
