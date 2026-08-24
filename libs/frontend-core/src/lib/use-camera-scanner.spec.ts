import { describe, expect, it } from 'vitest';
import { readZoomRange } from './use-camera-scanner';

// Camera zoom is a NON-STANDARD track capability: Android Chrome reports it,
// iOS Safari does not, and drivers disagree about what they fill in. The parse
// is therefore the whole risk — a slider offered for a camera that cannot zoom
// is a control that does nothing.

describe('readZoomRange', () => {
  it('reads a well-formed capability', () => {
    expect(readZoomRange({ zoom: { min: 1, max: 8, step: 0.1 } })).toEqual({
      min: 1,
      max: 8,
      step: 0.1,
    });
  });

  it('invents a usable step when the driver omits one', () => {
    // A slider with no step jumps in whole units and feels broken.
    expect(readZoomRange({ zoom: { min: 1, max: 5 } })).toMatchObject({
      step: 0.04,
    });
  });

  it('offers nothing when the camera cannot actually move', () => {
    // min === max is a camera reporting a range it cannot travel.
    expect(readZoomRange({ zoom: { min: 1, max: 1, step: 0.1 } })).toBeNull();
  });

  it('offers nothing for a camera without the capability at all', () => {
    expect(readZoomRange({ facingMode: ['environment'] })).toBeNull();
    expect(readZoomRange(undefined)).toBeNull();
    expect(readZoomRange(null)).toBeNull();
  });

  it('refuses a capability whose bounds are not numbers', () => {
    expect(readZoomRange({ zoom: { min: '1', max: '8' } })).toBeNull();
  });
});
