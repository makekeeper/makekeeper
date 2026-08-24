import {
  createViewportLock,
  FIXED_VIEWPORT,
  VIEWPORT_LOCK_CLASS,
  ZOOM_GESTURE_EVENTS,
  type LockablePage,
} from './viewport-lock';

// The lock touches state the DESKTOP app shares. Putting it back exactly as it
// was matters more than setting it: a desktop user left unable to zoom is an
// accessibility regression caused by a phone screen they never opened.

const ORIGINAL = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

function fakePage(): LockablePage & {
  classes: Set<string>;
  viewport: string;
  refused: Set<string>;
} {
  return {
    classes: new Set<string>(),
    viewport: ORIGINAL,
    refused: new Set<string>(),
    addClass(name) {
      this.classes.add(name);
    },
    removeClass(name) {
      this.classes.delete(name);
    },
    readViewport() {
      return this.viewport;
    },
    writeViewport(content) {
      this.viewport = content;
    },
    refuseGestures(events) {
      for (const name of events) this.refused.add(name);
    },
    allowGestures(events) {
      for (const name of events) this.refused.delete(name);
    },
  };
}

describe('viewport lock', () => {
  it('pins the page and forbids zoom while the shell is up', () => {
    const page = fakePage();
    createViewportLock(page).lock();

    expect(page.classes.has(VIEWPORT_LOCK_CLASS)).toBe(true);
    expect(page.viewport).toBe(FIXED_VIEWPORT);
  });

  it('restores exactly what the app was serving', () => {
    const page = fakePage();
    const lock = createViewportLock(page);

    lock.lock();
    lock.unlock();

    expect(page.viewport).toBe(ORIGINAL);
    expect(page.classes.has(VIEWPORT_LOCK_CLASS)).toBe(false);
  });

  it('a second lock does not adopt the locked value as the original', () => {
    const page = fakePage();
    const lock = createViewportLock(page);

    // A shell that re-mounts — pairing lands, the view is rebuilt — must not
    // "restore" the very value it imposed.
    lock.lock();
    lock.lock();
    lock.unlock();

    expect(page.viewport).toBe(ORIGINAL);
  });

  it('locks again cleanly after an unlock', () => {
    const page = fakePage();
    const lock = createViewportLock(page);

    lock.lock();
    lock.unlock();
    lock.lock();
    lock.unlock();

    expect(page.viewport).toBe(ORIGINAL);
  });

  // Pinch zoom came back once already. The meta tag alone does not stop it —
  // iOS has ignored `user-scalable=no` since iOS 10 — so the lock must also
  // refuse WebKit's gesture events, and must stop refusing them on the way out
  // or the desktop app inherits a document it cannot zoom.
  it("refuses WebKit's zoom gestures while locked, and only while locked", () => {
    const page = fakePage();
    const lock = createViewportLock(page);

    lock.lock();
    expect([...page.refused].sort()).toEqual([...ZOOM_GESTURE_EVENTS].sort());

    lock.unlock();
    expect(page.refused.size).toBe(0);
  });
});
