<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import {
  AnchoredPopover,
  isDialogOpen,
  usePreferencesStore,
} from '@makekeeper/frontend-core';
import { HEADER_OVERFLOW } from './header-overflow';

// The permanent trace of the header's overflow (#274): an amber counter on the
// avatar saying how many controls live in its menu. Rendered by the shell OVER
// the avatar (the wrapper is `relative`), so neither menu component knows it
// exists. The first time anything ever collapses, a one-time coachmark says in
// words where the controls went; persisted, so a reload does not re-teach.
const overflow = inject(HEADER_OVERFLOW, null);
const prefs = usePreferencesStore();

const count = computed(() => overflow?.collapsedCount.value ?? 0);

const reducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const bumping = ref(false);
let bumpTimer: ReturnType<typeof setTimeout> | undefined;

const badgeRef = ref<HTMLElement | null>(null);
const coachOpen = ref(false);
const coachAnchor = ref<HTMLElement | null>(null);
let coachTimer: ReturnType<typeof setTimeout> | undefined;

const dismissCoach = (): void => {
  coachOpen.value = false;
  document.removeEventListener('click', dismissCoach);
};

// The lesson is spent here, at the moment it is on screen — not where the
// collapse is observed. A coachmark shown behind a dialog's backdrop would
// point at a dimmed header nobody is looking at, and mark the profile as
// taught anyway (#351); so while a dialog is open it is not shown, the flag
// stays unwritten, and the next collapse teaches instead.
const showCoach = (): void => {
  prefs.markHeaderOverflowCoached();
  coachAnchor.value = badgeRef.value?.parentElement ?? null;
  coachOpen.value = true;
  coachTimer = setTimeout(dismissCoach, 6500);
  // Attached only while the coachmark is open, and only after the event
  // that caused the collapse has finished propagating — a click that opened
  // the chat panel must not dismiss the lesson it just triggered.
  setTimeout(() => {
    if (coachOpen.value) document.addEventListener('click', dismissCoach);
  }, 0);
};

watch(count, (next, prev) => {
  // The count updates instantly; a short scale bump marks an increase. No
  // flight animation — it was tried and cut for jank (see HeaderOverflowRow).
  if (next > prev && !reducedMotion) {
    bumping.value = true;
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => (bumping.value = false), 200);
  }

  // The one-time lesson, on the first collapse this profile has ever seen —
  // unless a dialog owns the screen, in which case it keeps waiting.
  if (
    next > 0 &&
    prev === 0 &&
    !prefs.headerOverflowCoached &&
    !isDialogOpen.value
  ) {
    showCoach();
  }
});

// The other half of "not while a dialog is open", in both directions.
watch(isDialogOpen, (open) => {
  if (open) {
    // A dialog that opens a moment after the coachmark did would leave it
    // drawing over the backdrop, since the popover tier deliberately sits
    // above the modal one. It comes down — but the lesson goes back with it:
    // the reader's attention moved to the dialog, so what they got was a
    // glimpse, and spending the one chance on a glimpse is the loss this
    // ticket exists to prevent.
    if (!coachOpen.value) return;
    clearTimeout(coachTimer);
    dismissCoach();
    prefs.unmarkHeaderOverflowCoached();
    return;
  }

  // The screen is the reader's again. The header did not un-collapse while the
  // dialog was up, so `count` never returned to zero and its rising edge will
  // never come round again — teaching here is what makes "the next collapse
  // teaches instead" true in the very case that caused #351, rather than
  // deferring the lesson until the window happens to be widened and renarrowed.
  if (count.value > 0 && !prefs.headerOverflowCoached) showCoach();
});

onBeforeUnmount(() => {
  clearTimeout(bumpTimer);
  clearTimeout(coachTimer);
  document.removeEventListener('click', dismissCoach);
});
</script>

<template>
  <span
    v-show="count > 0"
    ref="badgeRef"
    class="absolute -top-1 -right-1.5 z-10 flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-xxs font-bold tabular-nums border-2 border-white dark:border-dark-900 pointer-events-none transition-transform duration-200"
    :class="bumping ? 'scale-125' : ''"
  >
    <span aria-hidden="true">{{ count }}</span>
    <!-- The multiuser avatar's accessible name belongs to its plugin, which
         must not know about the shell's overflow — so the shell says it here,
         beside whichever avatar is rendered, instead of renaming the button. -->
    <span class="sr-only">{{ $t('header.moreCount', { count }) }}</span>
  </span>

  <AnchoredPopover :open="coachOpen" :anchor="coachAnchor">
    <div
      role="status"
      class="w-56 mt-1 px-3 py-2.5 rounded-xl bg-slate-900 dark:bg-dark-800 text-slate-100 text-xs leading-relaxed shadow-xl animate-fade-in"
    >
      {{ $t('header.overflowHint') }}
    </div>
  </AnchoredPopover>
</template>
