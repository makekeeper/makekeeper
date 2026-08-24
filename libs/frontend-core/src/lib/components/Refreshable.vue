<script setup lang="ts">
import Spinner from './Spinner.vue';

// Content that can be reloaded in place.
//
// The default reload — swap the data for a spinner and back — tears the section
// off the screen and rebuilds it: the layout jumps, and a fast response reads as
// a glitch rather than as an update. This keeps what is already rendered,
// blurs it, and puts a spinner over it, so a refresh looks like the same section
// being brought up to date.
//
// It is purely visual and stateless. WHEN to refresh, and for how long the state
// stays legible, belong to the data layer — `useResource` with
// `keepPreviousData` (which is what makes the old content available to blur at
// all) and `minLoadingMs`. Wire `refreshing` to the resource's own `refreshing`.
defineProps<{
  refreshing: boolean;
}>();
</script>

<template>
  <div class="relative">
    <!-- The blur is what makes the state read as "being updated" rather than
         "broken"; pointer-events-none stops a click landing on a value that is
         about to change under it. -->
    <div
      class="transition duration-200"
      :class="
        refreshing ? 'pointer-events-none select-none blur-sm opacity-60' : ''
      "
      :aria-busy="refreshing"
    >
      <slot />
    </div>

    <div
      v-if="refreshing"
      class="absolute inset-0 flex items-start justify-center pt-12"
      aria-live="polite"
      :aria-label="$t('common.refreshing')"
    >
      <Spinner />
    </div>
  </div>
</template>
