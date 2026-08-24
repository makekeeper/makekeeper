import { isBackNavigation, readHistoryPosition } from './phase-history';

// The rule that keeps the intake form from being swiped out of the screen it
// belongs to. Pure, because the alternative is a browser.

describe('readHistoryPosition', () => {
  it('reads the position vue-router keeps on the history state', () => {
    expect(readHistoryPosition({ position: 4 })).toBe(4);
  });

  it('answers null for a state that carries no position', () => {
    expect(readHistoryPosition({})).toBe(null);
    expect(readHistoryPosition(null)).toBe(null);
    expect(readHistoryPosition('back')).toBe(null);
    expect(readHistoryPosition({ position: '4' })).toBe(null);
  });
});

describe('isBackNavigation', () => {
  it('is backwards when the stack moved to an earlier entry', () => {
    expect(isBackNavigation(3, 2)).toBe(true);
    // Two entries at once — the case this exists for.
    expect(isBackNavigation(3, 1)).toBe(true);
  });

  it('is not backwards when moving forward or staying put', () => {
    expect(isBackNavigation(3, 4)).toBe(false);
    expect(isBackNavigation(3, 3)).toBe(false);
  });

  // An unknown position must not trap anybody on a screen: ordinary navigation
  // wins over a rule that cannot see what it is judging.
  it('treats an unknown position as an ordinary departure', () => {
    expect(isBackNavigation(null, 2)).toBe(false);
    expect(isBackNavigation(3, null)).toBe(false);
  });
});
