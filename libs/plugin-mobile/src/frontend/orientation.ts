// The phone shell is a PORTRAIT shape, and says so out loud when it is not.
//
// Three layers, because no single one covers every way the app is opened:
//
//   * `"orientation": "portrait"` in the web manifest. Honoured by an INSTALLED
//     app on Android and ignored by Safari, so it never covers iOS or a plain
//     browser tab;
//   * `screen.orientation.lock('portrait')` below — best effort, and genuinely
//     unavailable more often than not (it needs a fullscreen/standalone context
//     and does not exist on iOS at all). A rejection is the normal case, not an
//     error worth reporting;
//   * the notice, for everything the first two miss. It is the only layer that
//     always works, which is why it exists at all rather than being a fallback
//     nobody expects to see.
//
// The shell is entered explicitly by URL, so a desktop browser can be sitting on
// `/m` in a wide window — which is "landscape" by any orientation test. Telling
// somebody at a desk to rotate their monitor is the failure this guards against:
// the height bound is what makes the question "is this a phone lying on its
// side", not "is this window wider than it is tall".

// A phone in landscape is short: its height is the narrow edge, roughly
// 320–500px across the devices in use. A tablet in landscape starts around 750px
// and a desktop window higher still, so 550 separates the two cases with room on
// both sides.
export const LANDSCAPE_PHONE_QUERY =
  '(orientation: landscape) and (max-height: 550px)';

// The slice of `MediaQueryList` this needs. Declared structurally so the
// subscribe/unsubscribe pairing — the part that leaks if it is got wrong — is
// testable without a browser.
export interface OrientationQuery {
  matches: boolean;
  addEventListener(
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ): void;
  removeEventListener(
    type: 'change',
    listener: (event: { matches: boolean }) => void,
  ): void;
}

// Report whether the viewport is a phone on its side, now and whenever it
// changes. Returns the unsubscribe.
//
// `null` — no `matchMedia` at all (jsdom, an ancient engine) — answers "not
// landscape" and subscribes to nothing: a shell that cannot measure the screen
// must show the app, never a notice the user has no way to dismiss.
export function observeLandscapePhone(
  query: OrientationQuery | null,
  onChange: (isLandscapePhone: boolean) => void,
): () => void {
  if (!query) {
    onChange(false);
    return () => undefined;
  }
  const listener = (event: { matches: boolean }): void =>
    onChange(event.matches);
  query.addEventListener('change', listener);
  // Answer for the CURRENT state too: a phone already on its side when the
  // shell mounts fires no `change`.
  onChange(query.matches);
  return () => query.removeEventListener('change', listener);
}

export function matchLandscapePhone(): OrientationQuery | null {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
    ? window.matchMedia(LANDSCAPE_PHONE_QUERY)
    : null;
}

interface LockableOrientation {
  lock(orientation: 'portrait'): Promise<void>;
}

// `lock` is absent on iOS and on every desktop engine, so its presence is
// checked rather than assumed (§5.1 — narrowed, not asserted).
const isLockable = (value: unknown): value is LockableOrientation =>
  typeof value === 'object' &&
  value !== null &&
  'lock' in value &&
  typeof (value as { lock: unknown }).lock === 'function';

// Ask the platform to hold the app in portrait. Silent about failure BY DESIGN:
// the API rejects whenever the document is not fullscreen or the browser simply
// does not implement it, which is the common case and not something the user
// did. The notice covers what the lock cannot.
export async function requestPortraitLock(): Promise<void> {
  if (typeof screen === 'undefined') return;
  const orientation: unknown = screen.orientation;
  if (!isLockable(orientation)) return;
  try {
    await orientation.lock('portrait');
  } catch {
    // Not permitted here — the notice is the answer.
  }
}
