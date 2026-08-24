import { describe, expect, it } from 'vitest';
import { pinchZoomValue, touchDistance } from './pinch-zoom';

// The arithmetic of the pinch, without a browser: jsdom has no touch events, and
// this is the part that can actually be wrong.

const BOUNDS = { min: 1, max: 4 };

describe('touchDistance', () => {
  it('measures the span between two fingers', () => {
    expect(
      touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }),
    ).toBe(5);
  });
});

describe('pinchZoomValue', () => {
  it('scales the zoom by how much the fingers spread', () => {
    expect(pinchZoomValue(100, 1, 200, BOUNDS)).toBe(2);
    expect(pinchZoomValue(100, 2, 150, BOUNDS)).toBe(3);
  });

  it('zooms back out as the fingers come together', () => {
    expect(pinchZoomValue(200, 2, 100, BOUNDS)).toBe(1);
  });

  // Anchored to where the gesture STARTED, so a slow pinch does not drift: the
  // same span always means the same zoom, however many frames it took.
  it('is a function of the span, not of how it was reached', () => {
    const direct = pinchZoomValue(100, 1, 180, BOUNDS);
    const viaMiddle = pinchZoomValue(100, 1, 140, BOUNDS);
    expect(pinchZoomValue(100, 1, 180, BOUNDS)).toBe(direct);
    expect(viaMiddle).not.toBe(direct);
  });

  it('never leaves the camera range', () => {
    expect(pinchZoomValue(100, 2, 1000, BOUNDS)).toBe(4);
    expect(pinchZoomValue(100, 2, 1, BOUNDS)).toBe(1);
  });

  // Two fingers landing on the same spot: no span to divide by, so the zoom
  // holds rather than exploding.
  it('holds still when the pinch begins with no span', () => {
    expect(pinchZoomValue(0, 2.5, 300, BOUNDS)).toBe(2.5);
  });
});
