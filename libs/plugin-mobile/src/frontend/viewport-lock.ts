// Pin the page while the mobile shell is on screen.
//
// A phone-sized app that is really a web page inherits two behaviours nobody
// wants in it: the document scrolls behind the fixed chrome, and a stray pinch
// or double-tap zooms the whole interface. Both read as the UI "drifting" —
// especially on iOS, where rubber-banding moves the tab bar out from under a
// thumb that was already aiming at it.
//
// So while the shell is mounted the document is locked and the viewport is
// declared non-zoomable, and BOTH are put back on the way out. Reversible on
// purpose: the same index.html serves the desktop app, which must keep its
// ordinary scrolling and its zoom — taking zoom away from a desktop user is an
// accessibility regression, not a design choice.
//
// Blocking the pinch takes THREE things, and any one of them alone leaves the
// page zoomable — which is exactly how it came back:
//
//   * the viewport meta below. Android honours `user-scalable=no`; iOS has
//     ignored it since iOS 10, so it cannot be the whole answer;
//   * `touch-action: pan-x pan-y` on the locked body (styles.css). This is the
//     one that actually stops the gesture in modern engines. It used to say
//     `manipulation`, which sounds stricter and is not: that value drops
//     double-tap zoom and explicitly KEEPS pinch;
//   * refusing WebKit's `gesturestart`/`gesturechange`/`gestureend` here, for
//     the Safari versions that still zoom through both of the above.

export const VIEWPORT_LOCK_CLASS = 'mk-viewport-locked';
export const FIXED_VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

// Non-standard, WebKit-only, and the reason the constant is named rather than
// inlined: these are what a `preventDefault` has to reach to stop an iOS pinch.
export const ZOOM_GESTURE_EVENTS = [
  'gesturestart',
  'gesturechange',
  'gestureend',
] as const;

// The page, as the lock needs it. A port rather than direct DOM calls so the
// remember-once/restore-exactly rule — the part that can actually be got wrong —
// is testable without a browser.
export interface LockablePage {
  addClass(name: string): void;
  removeClass(name: string): void;
  readViewport(): string | null;
  writeViewport(content: string): void;
  // Paired by contract: whatever `lock` starts refusing, `unlock` stops. The
  // desktop app shares this document.
  refuseGestures(events: readonly string[]): void;
  allowGestures(events: readonly string[]): void;
}

export function createViewportLock(page: LockablePage): {
  lock: () => void;
  unlock: () => void;
} {
  let previous: string | null = null;
  let held = false;

  return {
    lock(): void {
      page.addClass(VIEWPORT_LOCK_CLASS);
      // Remember what the app was serving, and only the first time: a shell that
      // re-mounts (pairing lands, the view is rebuilt) must not adopt its own
      // locked value as the thing it later restores.
      if (!held) {
        previous = page.readViewport();
        held = true;
      }
      page.writeViewport(FIXED_VIEWPORT);
      page.refuseGestures(ZOOM_GESTURE_EVENTS);
    },
    unlock(): void {
      page.removeClass(VIEWPORT_LOCK_CLASS);
      if (previous !== null) page.writeViewport(previous);
      page.allowGestures(ZOOM_GESTURE_EVENTS);
      previous = null;
      held = false;
    },
  };
}

// One listener reference for every gesture event, so `removeEventListener`
// really removes: a fresh arrow per call would silently leave the desktop app
// with a document that refuses to zoom.
const refuseGesture = (event: Event): void => event.preventDefault();

const documentPage: LockablePage = {
  addClass: (name) => document.documentElement.classList.add(name),
  removeClass: (name) => document.documentElement.classList.remove(name),
  readViewport: () =>
    document.querySelector('meta[name="viewport"]')?.getAttribute('content') ??
    null,
  writeViewport: (content) =>
    document
      .querySelector('meta[name="viewport"]')
      ?.setAttribute('content', content),
  refuseGestures: (events) => {
    for (const name of events) {
      // `passive: false` is the point: a passive listener may not call
      // `preventDefault`, and touch-adjacent events default to passive.
      document.addEventListener(name, refuseGesture, { passive: false });
    }
  },
  allowGestures: (events) => {
    for (const name of events) {
      document.removeEventListener(name, refuseGesture);
    }
  },
};

const pageLock = createViewportLock(documentPage);

export const lockViewport = (): void => pageLock.lock();
export const unlockViewport = (): void => pageLock.unlock();
