<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';

// "Back to <where>" — one treatment for the climb out of a detail screen.
//
// The pattern already existed on every desktop detail view and had drifted into
// five spellings of itself: `text-xs` in the project detail, `text-sm` in the
// inventory form and the tag detail, a hand-rolled `<button>` calling
// `router.push` in some, a `RouterLink` in others. The phone shell then needed a
// sixth, which is the moment to stop and make it a primitive instead.
//
// The label names the DESTINATION, never just "Back": on a phone especially, the
// word is the only thing telling you which section you are returning to.
//
// Link or button, by what the control actually does. Climbing from one ADDRESS
// to another is a link (§5.3): middle-clickable, openable in a new tab,
// announced as a link. Leaving a transient face of one screen is not — there is
// no address to open, and the right move is to pop the entry that face pushed,
// which no href can express. Wearing one treatment does not make them the same
// element.
defineProps<{
  label: string;
  to?: RouteLocationRaw;
  // Accessible name, when the visible label alone would mislead. "Stock" on its
  // own reads as a link INTO stock rather than the way back out of here.
  ariaLabel?: string;
}>();

defineEmits<{ (event: 'click'): void }>();
</script>

<template>
  <component
    :is="to === undefined ? 'button' : RouterLink"
    :to="to"
    :type="to === undefined ? 'button' : undefined"
    :aria-label="ariaLabel"
    class="inline-flex items-center gap-1.5 rounded-xl text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-400 dark:hover:text-white"
    @click="$emit('click')"
  >
    <ArrowLeft class="h-4 w-4 shrink-0" />
    <span class="truncate">{{ label }}</span>
  </component>
</template>
