import { ref } from 'vue';

// Pinch to zoom the CAMERA — never the page.
//
// The phone shell deliberately takes pinch away from the document (viewport
// meta, `touch-action: pan-x pan-y` on the locked body, and WebKit's own gesture
// events refused outright) because a zoomed interface reads as the UI drifting
// under the thumb. That ban is what made this necessary: the one place a pinch
// genuinely means something — a shelf label two metres from the lens — lost the
// gesture along with everything else, leaving only the slider.
//
// So the gesture is re-implemented HERE, on the preview element, from raw
// touches. It never reaches the document, and the page stays exactly as locked
// as it was.

export interface ZoomBounds {
  min: number;
  max: number;
}

// Distance between two touches, in pixels. Pure so the arithmetic below can be
// tested without a browser: touch events are not something jsdom has.
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

// Where the zoom lands for a pinch that started at `startDistance` with the
// camera at `startZoom` and is now `distance` apart.
//
// RATIO of the two distances, applied to the zoom the pinch started from —
// which is what makes the gesture feel attached to the fingers: spreading them
// twice as far doubles the zoom, wherever the pinch began. Anchoring to the
// zoom at the START of the gesture (rather than the current one) is what stops
// the drift a per-frame multiply accumulates.
//
// A pinch that starts with the fingers already together has no ratio to work
// from; the zoom simply stays where it was.
export function pinchZoomValue(
  startDistance: number,
  startZoom: number,
  distance: number,
  bounds: ZoomBounds,
): number {
  if (startDistance <= 0) return startZoom;
  const scaled = startZoom * (distance / startDistance);
  return Math.min(bounds.max, Math.max(bounds.min, scaled));
}

// Handlers to bind on the element that shows the preview. Give the element
// `touch-none` as well, or the browser spends the first few pixels of the
// gesture deciding whether it was a scroll.
export function usePinchZoom(source: {
  bounds: () => ZoomBounds;
  current: () => number;
  apply: (value: number) => void;
}): {
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onTouchEnd: () => void;
} {
  // Where this pinch began. Null between gestures — one finger on the preview
  // is not a pinch and must be left alone.
  const startDistance = ref<number | null>(null);
  const startZoom = ref(1);

  const twoTouches = (event: TouchEvent): [Touch, Touch] | null =>
    event.touches.length === 2 && event.touches[0] && event.touches[1]
      ? [event.touches[0], event.touches[1]]
      : null;

  const onTouchStart = (event: TouchEvent): void => {
    const pair = twoTouches(event);
    if (!pair) return;
    startDistance.value = touchDistance(pair[0], pair[1]);
    startZoom.value = source.current();
  };

  const onTouchMove = (event: TouchEvent): void => {
    const pair = twoTouches(event);
    if (!pair || startDistance.value === null) return;
    // The listener is bound to an element, not the document, so it is not
    // passive by default and this really does stop the browser acting on the
    // gesture itself.
    event.preventDefault();
    source.apply(
      pinchZoomValue(
        startDistance.value,
        startZoom.value,
        touchDistance(pair[0], pair[1]),
        source.bounds(),
      ),
    );
  };

  // Any finger leaving ends the pinch: what is left is at most one, and the
  // next pinch measures itself afresh rather than jumping from a stale span.
  const onTouchEnd = (): void => {
    startDistance.value = null;
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}
