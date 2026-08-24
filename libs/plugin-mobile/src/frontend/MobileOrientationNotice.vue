<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RotateCcw } from '@lucide/vue';
import { matchLandscapePhone, observeLandscapePhone } from './orientation';

// The phone shell is a portrait shape, and a phone turned on its side gets told
// so instead of being handed a squashed one.
//
// It BLOCKS rather than warns: at 400px of height the camera screen loses its
// own controls below the fold and the tab bar sits on top of the content. A
// notice that could be scrolled past would just be a label on a broken screen.
// Nothing here is dismissible for the same reason — the way out is to rotate,
// which is one gesture away and fixes the actual problem.
//
// Why not simply a CSS media query in the shell: the copy has to be translated,
// and the same query has to be readable by `orientation.ts` for the height bound
// (a desktop window at `/m` is landscape too and must not see this).

const isLandscapePhone = ref(false);
const stop = observeLandscapePhone(matchLandscapePhone(), (landscape) => {
  isLandscapePhone.value = landscape;
});
onBeforeUnmount(stop);

// A modal that never takes focus is a modal only for the eyes: the shell behind
// it stays tab-reachable, so a keyboard or a switch lands on controls that are
// covered and, at this height, broken. Moving focus in is also what makes the
// screen reader announce the way out instead of the field it was on.
const dialogRef = ref<HTMLElement | null>(null);
watch(isLandscapePhone, async (landscape) => {
  if (!landscape) return;
  await nextTick();
  dialogRef.value?.focus();
});
</script>

<template>
  <!-- Teleported so no transformed ancestor inside the shell can trap it, on
       the same `z-overlay` rung as the other full-screen locks: while this is
       up, nothing behind it can be acted on anyway. -->
  <Teleport to="body">
    <div
      v-if="isLandscapePhone"
      ref="dialogRef"
      role="alertdialog"
      aria-modal="true"
      tabindex="-1"
      aria-labelledby="mobile-orientation-title"
      aria-describedby="mobile-orientation-body"
      class="fixed inset-0 z-overlay flex flex-col items-center justify-center gap-4 bg-slate-50 px-8 text-center focus:outline-none dark:bg-dark-950"
    >
      <span
        class="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400"
      >
        <RotateCcw class="h-8 w-8" />
      </span>
      <h1
        id="mobile-orientation-title"
        class="text-lg font-bold text-slate-900 dark:text-white"
      >
        {{ $t('mobile.orientation.title') }}
      </h1>
      <p
        id="mobile-orientation-body"
        class="max-w-xs text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('mobile.orientation.body') }}
      </p>
    </div>
  </Teleport>
</template>
