import { describe, it, expect } from 'vitest';
import { isAppWideDataChange } from './data-events';

// The rule that stopped the inventory list from blinking (#180).
//
// An external plugin invalidates its own screen whenever its own world moves.
// A printer reporting a temperature every fifteen seconds is not a reason for
// every open view in the app to refetch.

describe('isAppWideDataChange', () => {
  it('accepts a real data change', () => {
    expect(isAppWideDataChange({ pluginIds: ['inventory'] })).toBe(true);
  });

  it('ignores a screen-only invalidation', () => {
    expect(
      isAppWideDataChange({ pluginIds: ['bambu'], screensOnly: true }),
    ).toBe(false);
  });

  it('ignores anything that is not a nudge', () => {
    expect(isAppWideDataChange(undefined)).toBe(false);
    expect(isAppWideDataChange({})).toBe(false);
    expect(isAppWideDataChange({ pluginIds: [] })).toBe(false);
  });
});
