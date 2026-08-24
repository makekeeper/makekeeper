<script setup lang="ts">
// One verb in the dashboard's action strip (#90). Plugins contribute these into
// the `dashboard.actions` slot; this primitive keeps every verb visually
// identical whichever plugin owns it. Renders a RouterLink when `to` is set,
// otherwise a button that emits `activate` (e.g. to open the assistant).
import { computed, type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';

const props = withDefaults(
  defineProps<{
    label: string;
    icon: Component;
    to?: RouteLocationRaw;
    // `urgent` tints the verb amber — for actions with pending work (put away N).
    urgent?: boolean;
  }>(),
  { to: undefined, urgent: false },
);

defineEmits<{ activate: [] }>();

const toneClass = computed(() =>
  props.urgent
    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
    : 'glass-card text-slate-700 dark:text-slate-300 hover:bg-brand-500/10',
);
const iconClass = computed(() =>
  props.urgent
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-brand-600 dark:text-brand-400',
);
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    :to="to"
    :type="to ? undefined : 'button'"
    class="flex-1 w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
    :class="toneClass"
    @click="to ? undefined : $emit('activate')"
  >
    <component :is="icon" class="w-4 h-4 shrink-0" :class="iconClass" />
    {{ label }}
  </component>
</template>
