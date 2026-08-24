<script setup lang="ts">
import { computed } from 'vue';
import { Users, User } from '@lucide/vue';
import { useModeTransitionStore } from './transition-store';

// The "magic moment" shown while the multiuser plugin itself is being toggled,
// mounted once in App.vue next to the toast/confirm hosts (above modals and
// toasts). Both directions get the Siri-style treatment — an iridescent orb of
// swirling blurred color blobs plus an aurora glow running around the screen
// edge. Enabling plays it in full spectrum with a hue-rotate shimmer; disabling
// is the same swirl drained to slate grays: the magic fading out.
const transition = useModeTransitionStore();

const enabling = computed(() => transition.phase === 'enabling');

const icon = computed(() => (enabling.value ? Users : User));

const aurora = computed(() =>
  enabling.value ? 'bg-mode-aurora' : 'bg-mode-aurora-dim',
);

// Swirling blobs inside the orb: each sits off-center inside a spinning
// wrapper (stock `spin` keyframes at different speeds/directions), so they
// orbit and blend into a liquid, never-repeating shimmer. Same geometry for
// both phases; only the palette changes.
const BLOB_COLORS = {
  enabling: [
    'bg-brand-500/80 dark:bg-brand-400/80',
    'bg-fuchsia-500/70 dark:bg-fuchsia-400/70',
    'bg-cyan-400/70 dark:bg-cyan-300/70',
    'bg-violet-500/70 dark:bg-violet-400/70',
  ],
  disabling: [
    'bg-slate-400/70 dark:bg-slate-500/70',
    'bg-slate-500/60 dark:bg-slate-400/60',
    'bg-slate-300/70 dark:bg-slate-600/70',
    'bg-slate-600/50 dark:bg-slate-300/50',
  ],
} as const;

const BLOB_GEOMETRY = [
  { anim: 'animate-mode-orbit-1', place: 'absolute -top-6 left-1/2 w-24 h-24' },
  {
    anim: 'animate-mode-orbit-2',
    place: 'absolute -bottom-6 left-0 w-28 h-28',
  },
  {
    anim: 'animate-mode-orbit-3',
    place: 'absolute top-1/2 -right-6 w-24 h-24',
  },
  { anim: 'animate-mode-orbit-4', place: 'absolute -top-4 -left-4 w-20 h-20' },
] as const;

const blobs = computed(() => {
  const colors = BLOB_COLORS[enabling.value ? 'enabling' : 'disabling'];
  return BLOB_GEOMETRY.map((geometry, i) => ({
    ...geometry,
    color: colors[i],
  }));
});
</script>

<template>
  <Transition name="mode-veil" appear>
    <div
      v-if="transition.phase"
      class="fixed inset-0 z-[70] flex items-center justify-center"
      role="status"
      aria-live="assertive"
    >
      <!-- Screen-edge aurora: an oversized spinning conic gradient, heavily
           blurred; the veil above it leaves a glowing rim. -->
      <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          class="absolute -inset-1/2 animate-mode-swirl blur-3xl"
          :class="[
            aurora,
            enabling
              ? 'opacity-70 dark:opacity-60'
              : 'opacity-50 dark:opacity-40',
          ]"
        />
      </div>

      <!-- Frosted veil, inset so the aurora shows as a shimmering frame around
           the screen and tints through the glass. -->
      <div
        class="absolute inset-2 rounded-2xl bg-white/85 dark:bg-dark-950/90 backdrop-blur-xl"
        aria-hidden="true"
      />

      <div
        class="relative flex flex-col items-center gap-8 px-6 text-center animate-scale-in"
      >
        <!-- The orb: liquid blobs swirling under glass, breathing, with an
             aurora halo; hue-cycling only while enabling (grays don't shift). -->
        <div
          class="relative flex items-center justify-center w-40 h-40 animate-mode-breathe"
        >
          <div
            class="absolute -inset-8 rounded-full animate-mode-swirl blur-2xl"
            :class="[
              aurora,
              enabling
                ? 'opacity-50 dark:opacity-40'
                : 'opacity-40 dark:opacity-30',
            ]"
            aria-hidden="true"
          />
          <div
            class="relative w-36 h-36 rounded-full overflow-hidden shadow-2xl"
            :class="enabling ? 'animate-mode-hue' : ''"
          >
            <div
              v-for="b in blobs"
              :key="b.anim"
              class="absolute inset-0"
              :class="b.anim"
            >
              <span class="rounded-full blur-xl" :class="[b.place, b.color]" />
            </div>
            <!-- Glass sheen over the liquid -->
            <div
              class="absolute inset-0 rounded-full border border-white/50 dark:border-white/20 bg-white/10"
            />
          </div>
          <component
            :is="icon"
            class="absolute w-11 h-11 text-white drop-shadow-lg"
          />
        </div>

        <div class="space-y-2 animate-fade-in">
          <h2 class="text-xl font-semibold text-slate-900 dark:text-white">
            {{ $t(`multiuser.transition.${transition.phase}.title`) }}
          </h2>
          <p class="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
            {{ $t(`multiuser.transition.${transition.phase}.subtitle`) }}
          </p>
        </div>

        <!-- Progress sweep timed to the transition duration -->
        <div
          class="w-56 h-1 rounded-full overflow-hidden bg-slate-200 dark:bg-dark-700"
        >
          <div
            class="h-full rounded-full animate-mode-sweep"
            :class="
              enabling
                ? 'bg-gradient-to-r from-brand-500 via-fuchsia-500 to-cyan-400'
                : 'bg-gradient-to-r from-slate-500 via-slate-400 to-slate-300 dark:from-slate-400 dark:via-slate-500 dark:to-slate-600'
            "
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mode-veil-enter-active {
  transition: opacity 0.3s ease-out;
}
.mode-veil-enter-from {
  opacity: 0;
}
</style>
