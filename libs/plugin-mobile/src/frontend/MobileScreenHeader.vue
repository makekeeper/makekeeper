<script setup lang="ts">
import { BackLink } from '@makekeeper/frontend-core';

// THE header of the phone surface. Every screen gets this one and renders no
// heading of its own.
//
// That is the whole point of it existing. The surface had three mechanisms at
// once — a view's own <h1> with its own padding, this bar, and nothing at all on
// the camera screen — plus a screen that put its title in the bar and its
// subtitle in the content. Uniform sizes did not fix it, because the sizes were
// never the problem: the SOURCE was.
//
// The back arrow appears only where there is somewhere to climb to, so a tab
// root wears the same bar without one. Shaped like the web's detail views: a
// quiet "← where you came from" over a bold title, at the two sizes `BackLink`
// and `PageHeader` already use at phone width.
defineProps<{
  title: string | null;
  subtitle: string | null;
  // Where the arrow leads, for the screens whose exit is an address.
  back: string | null;
  backLabel: string;
  backAriaLabel?: string;
  // Set when leaving is an ACTION rather than a destination — a face of a screen
  // popping the entry it pushed. The arrow then renders as a button.
  backPops?: boolean;
}>();

defineEmits<{ (event: 'back'): void }>();
</script>

<template>
  <header
    class="space-y-1 border-b border-slate-200 px-4 py-3 dark:border-white/5"
  >
    <BackLink
      v-if="back"
      :to="backPops ? undefined : back"
      :label="backLabel"
      :aria-label="backAriaLabel"
      @click="$emit('back')"
    />
    <!-- Truncates rather than wraps: a two-line title would move the content
         under it by a row, and this bar sits above screens that size themselves
         to the space left over. -->
    <h1
      v-if="title"
      class="truncate text-lg font-bold text-slate-900 dark:text-white"
    >
      {{ title }}
    </h1>
    <p v-if="subtitle" class="text-sm text-slate-500 dark:text-slate-400">
      {{ subtitle }}
    </p>
  </header>
</template>
