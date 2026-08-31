import { isWithinQuietHours } from './notifications';

const window = (from: number | null, to: number | null) => ({
  quietFromMinutes: from,
  quietToMinutes: to,
  timezone: null,
  locale: null,
});

describe('isWithinQuietHours', () => {
  it('is never quiet without a window', () => {
    expect(isWithinQuietHours(window(null, null), 3 * 60)).toBe(false);
    expect(isWithinQuietHours(window(60, null), 3 * 60)).toBe(false);
  });

  it('is never quiet when both ends are the same instant', () => {
    // A zero-length window is "no window", not "always quiet" — the latter
    // would silence every channel the moment somebody dragged both ends
    // together.
    expect(isWithinQuietHours(window(9 * 60, 9 * 60), 9 * 60)).toBe(false);
  });

  it('handles a window inside one day', () => {
    const day = window(9 * 60, 17 * 60);
    expect(isWithinQuietHours(day, 8 * 60 + 59)).toBe(false);
    expect(isWithinQuietHours(day, 9 * 60)).toBe(true);
    expect(isWithinQuietHours(day, 16 * 60 + 59)).toBe(true);
    // Exclusive at the end, so a window ending at 17:00 and one starting there
    // cannot both claim the same minute.
    expect(isWithinQuietHours(day, 17 * 60)).toBe(false);
  });

  it('handles the normal case: a window that wraps past midnight', () => {
    const night = window(22 * 60, 7 * 60);
    expect(isWithinQuietHours(night, 21 * 60 + 59)).toBe(false);
    expect(isWithinQuietHours(night, 22 * 60)).toBe(true);
    expect(isWithinQuietHours(night, 0)).toBe(true);
    expect(isWithinQuietHours(night, 6 * 60 + 59)).toBe(true);
    expect(isWithinQuietHours(night, 7 * 60)).toBe(false);
  });
});
