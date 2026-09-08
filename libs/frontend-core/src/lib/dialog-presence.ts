import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';

// "May I put something on screen right now?" — the shared answer (#351).
//
// A dialog covers the page with a backdrop and takes the reader's attention
// whole. Anything the app puts on screen on its own initiative (a coachmark
// pointing at a dimmed header, and the toasts and future coachmarks that will
// ask the same question) has to know that, and nothing could: `Modal`
// teleports to <body> and each instance owns its own `modelValue`, so there
// was no place to ask.
//
// Deliberately module state and not a Pinia store: `Modal` is a primitive that
// must mount anywhere — including a spec, or a surface set up before the app's
// stores are — and a primitive that throws without an active pinia is a
// primitive with a hidden prerequisite.
const openCount = ref(0);

// Counted, not named: a confirmation raised from inside another dialog is two,
// and the page is the reader's again only when the count is back to zero.
export const isDialogOpen: ComputedRef<boolean> = computed(
  () => openCount.value > 0,
);

/**
 * Wiring for a dialog component: pass whatever says it is open, and the count
 * follows it — including the unmount-while-open case, which no watcher sees.
 */
export const useDialogPresence = (isOpen: () => boolean): void => {
  let counted = false;

  const sync = (open: boolean): void => {
    if (open === counted) return;
    counted = open;
    // Floored at zero so an unbalanced release can never report the next
    // dialog's absence as its presence.
    openCount.value = open
      ? openCount.value + 1
      : Math.max(0, openCount.value - 1);
  };

  // `immediate`: a dialog can be mounted already open (a deep link into the
  // lightbox), and that arrival never fires a change.
  watch(isOpen, sync, { immediate: true });

  onBeforeUnmount(() => sync(false));
};
