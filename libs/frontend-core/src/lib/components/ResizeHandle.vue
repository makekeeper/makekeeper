<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';

// A window splitter: the seam a user drags to decide how much room a pane gets.
// The pane owns the number (and its persistence) — the handle only reports the
// size the gesture asks for, already clamped, so a caller can bind it straight
// to a store.
//
// It is a control, not a decoration: WAI-ARIA's window-splitter pattern means
// it is focusable, carries `role="separator"` with the live value, answers the
// arrow keys, and takes Home/End to the bounds. `resetTo` adds the gesture the
// pattern leaves to the author — Enter, or a double-click, puts the pane back
// to its shipped width, which is the only way out of a size the user cannot
// undo by aiming.
//
// The band is deliberately wider than the line it draws (16px against 1px): a
// finger, and a mouse travelling at speed, both need more than a seam to hit.
// On a coarse pointer it widens to 24px, the smallest target WCAG 2.2 (2.5.8)
// counts as reachable by a finger.
const props = withDefaults(
  defineProps<{
    // Current size of the pane, in px — the value the drag moves.
    size: number;
    min: number;
    max: number;
    // Resolved by the caller (§5.5): the handle never sees a key.
    label: string;
    // Which edge of the pane carries the handle. On the left edge the pane
    // grows as the pointer travels left, hence the inverted delta.
    edge?: 'left' | 'right';
    // Keyboard nudge, px per arrow press.
    step?: number;
    // Enter / double-click target. Omitted ⇒ both gestures do nothing.
    resetTo?: number;
  }>(),
  { edge: 'left', step: 16 },
);

const emit = defineEmits<{
  (e: 'update:size', value: number): void;
  // True for the whole gesture. Callers use it to suspend the pane's width
  // transition — a 300ms ease on a value that changes every frame drags the
  // panel along behind the pointer.
  (e: 'update:active', value: boolean): void;
}>();

const handle = ref<HTMLElement | null>(null);
const active = ref(false);

// The gesture's origin: the pointer's x and the pane's size when it started, so
// the pane follows the pointer's total travel rather than accumulating per-event
// deltas (which drift once a value hits a bound and is clamped).
let startX = 0;
let startSize = 0;

// How many px the pane gains per px the pointer travels to the RIGHT. A handle
// on the left edge inverts it: the pane grows as the seam moves left. Every
// gesture — drag and arrows alike — goes through this one sign, so the keyboard
// can never disagree with the pointer about which way is bigger.
function travelSign(): number {
  return props.edge === 'left' ? -1 : 1;
}

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(value)));
}

function apply(next: number): void {
  const clamped = clamp(next);
  if (clamped !== props.size) emit('update:size', clamped);
}

// While dragging, the whole document must stop behaving like a document: text
// selects itself under a fast pointer, and the cursor flickers back to whatever
// the element under it wants. Restored on release AND on unmount — a pane that
// disappears mid-drag must not leave the page unselectable.
function setDragChrome(on: boolean): void {
  document.body.style.userSelect = on ? 'none' : '';
  document.body.style.cursor = on ? 'col-resize' : '';
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  startX = event.clientX;
  startSize = props.size;
  active.value = true;
  emit('update:active', true);
  setDragChrome(true);
  // Capture keeps the move/up events coming to this element even when the
  // pointer outruns the 16px band — which it always does.
  handle.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (!active.value) return;
  apply(startSize + (event.clientX - startX) * travelSign());
}

function endDrag(event: PointerEvent): void {
  if (!active.value) return;
  active.value = false;
  emit('update:active', false);
  setDragChrome(false);
  if (handle.value?.hasPointerCapture(event.pointerId)) {
    handle.value.releasePointerCapture(event.pointerId);
  }
}

function reset(): void {
  if (props.resetTo === undefined) return;
  apply(props.resetTo);
}

function onKeyDown(event: KeyboardEvent): void {
  // A vertical separator is moved by the horizontal arrows (ARIA), and the
  // direction is the screen's, not the pane's: Left always moves the seam left,
  // whichever side of it the pane is on.
  const sign = travelSign();
  switch (event.key) {
    case 'ArrowLeft':
      apply(props.size - props.step * sign);
      break;
    case 'ArrowRight':
      apply(props.size + props.step * sign);
      break;
    case 'Home':
      apply(props.min);
      break;
    case 'End':
      apply(props.max);
      break;
    case 'Enter':
      reset();
      break;
    default:
      return;
  }
  event.preventDefault();
}

onBeforeUnmount(() => {
  if (active.value) setDragChrome(false);
});
</script>

<template>
  <div
    ref="handle"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="props.label"
    :aria-valuenow="props.size"
    :aria-valuemin="props.min"
    :aria-valuemax="props.max"
    class="group absolute inset-y-0 z-10 w-4 coarse:w-6 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    :class="
      props.edge === 'left'
        ? '-left-2 coarse:-left-3'
        : '-right-2 coarse:-right-3'
    "
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @keydown="onKeyDown"
    @dblclick="reset"
  >
    <!-- The line the band stands for. Invisible at rest — the panel already has
         a border there — and lit while pointed at, focused or dragged. On a
         coarse pointer `:hover` never fires, so the seam is drawn at rest
         instead: an invisible splitter on a tablet is an undiscoverable one. -->
    <span
      aria-hidden="true"
      class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors group-hover:bg-brand-500/60 group-focus-visible:bg-brand-500"
      :class="
        active
          ? 'bg-brand-500'
          : 'bg-transparent coarse:bg-slate-300/70 dark:coarse:bg-white/20'
      "
    />
  </div>
</template>
