<script setup lang="ts">
import Spinner from './Spinner.vue';

// A full-screen wait lock for ONE operation the person must not work around.
//
// The distinction from a button's own `loading` state is what this exists for.
// A spinner on the button says "this control is busy" and leaves the rest of
// the screen live — right for a save the person is waiting on anyway. It is
// wrong for an operation whose CONTEXT is the thing at risk: mobile intake
// recognises the frame the camera is showing right now, and a person who takes
// the next photograph while the model is still looking at the previous one has
// two shots in flight and no way to tell which answer belongs to which part.
//
// Teleported to <body> at `z-overlay` so no transformed ancestor can trap it,
// and it covers the viewport — that IS the interaction block, no `pointer-events`
// gymnastics needed. `aria-modal` + `role="alertdialog"` tell a screen reader
// the same thing the backdrop tells the eye.
defineProps<{
  show: boolean;
  // What is being waited on, in the caller's words. Always a resolved string —
  // the primitive holds no copy of its own, because it has no idea what the
  // caller is doing.
  label: string;
  // The thing being worked on, when it has a picture. A dimmed backdrop is a
  // poor place to keep it — the point of showing the frame mobile intake sent
  // is that it stays READABLE, and it only does so above the scrim rather than
  // behind it.
  preview?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        :aria-label="label"
        class="fixed inset-0 z-overlay flex items-center justify-center p-6 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm"
      >
        <div
          class="glass-card rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl px-8 py-7 text-center animate-scale-in"
        >
          <img
            v-if="preview"
            :src="preview"
            :alt="label"
            class="mx-auto mb-5 w-40 h-40 rounded-xl object-cover"
          />
          <Spinner class="mx-auto" aria-hidden="true" />
          <p
            role="status"
            class="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            {{ label }}
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
