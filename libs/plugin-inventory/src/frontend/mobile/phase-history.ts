// Reading the history stack well enough to keep a form face honest.
//
// The intake screen has faces that are not routes of their own — the new-item
// form, the receipt — and they live under `?phase=`. That makes them history
// entries, which is what the back GESTURE needs: it pops, and popping is the
// only thing a gesture can do.
//
// What it cannot be trusted to do is pop exactly once. Twice reported, twice
// confirmed: swiping out of the form landed on the screen BEFORE the camera —
// Stock in one session, Home in another, i.e. whatever happened to precede the
// intake tab. So the destination is not inferred from the stack. The screen
// simply refuses to be left backwards for anywhere but its own camera, and the
// helpers below are how it tells a backwards departure from a deliberate one.

// vue-router numbers its history entries; a smaller number means the browser
// moved back. Both unknown positions read as "not backwards", so a runtime that
// does not carry the number keeps ordinary navigation rather than trapping the
// person on the screen.
export function isBackNavigation(
  enteredAt: number | null,
  current: number | null,
): boolean {
  if (enteredAt === null || current === null) return false;
  return current < enteredAt;
}

// `position` is vue-router's own bookkeeping on the history state. Read through
// a guard rather than asserted (§5.1): it is a runtime detail of a library, and
// a missing one must degrade, not throw.
export function readHistoryPosition(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const position: unknown = Reflect.get(state, 'position');
  return typeof position === 'number' ? position : null;
}
