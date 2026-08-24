<script setup lang="ts">
import { computed } from 'vue';
import { Loader } from '@lucide/vue';

// One canonical loading affordance for the whole app, replacing the ad-hoc mix
// of CircleDot / bare CSS border-spinner / pulsing icons across the plugins.
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    label?: string;
  }>(),
  {
    size: 'md',
    label: '',
  },
);

const sizeClass = computed<string>(() => {
  const map = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  } satisfies Record<NonNullable<typeof props.size>, string>;
  return map[props.size];
});
</script>

<template>
  <Loader
    class="animate-spin text-brand-500 dark:text-brand-400"
    :class="sizeClass"
    role="status"
    :aria-label="label || $t('common.loading')"
  />
</template>
