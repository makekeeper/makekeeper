// What a form control currently holds, taken from the event it fired.
//
// A template handler receives an `Event`, whose `target` is typed `EventTarget |
// null` — so every call site that wanted the value reached for `($event.target
// as HTMLInputElement).value`, which §5.1 bans and which lies the moment the
// handler is moved onto a different element. The narrowing is a real question
// with a real answer, so it is asked once, here, with an `instanceof` guard.
//
// A target that carries no value — the element was swapped, the event was
// re-dispatched — reads as an empty string: the same thing an emptied field
// says, and the only answer a caller could act on anyway.
export type ValueCarryingElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

export function isValueCarrying(
  target: EventTarget | null,
): target is ValueCarryingElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function fieldValue(event: Event): string {
  return isValueCarrying(event.target) ? event.target.value : '';
}

// The same value read as a number. `NaN` for anything unparseable, which a
// caller compares away — `Number('')` being 0 is the trap this avoids naming.
export function fieldNumber(event: Event): number {
  const raw = fieldValue(event).trim();
  return raw === '' ? Number.NaN : Number(raw);
}
