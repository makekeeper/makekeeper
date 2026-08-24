<script setup lang="ts">
import { type Component } from 'vue';

// One empty-state treatment for lists and panels — an optional icon, a title, a
// hint line, and an optional action slot. Replaces the ad-hoc inline empty
// blocks scattered across views.
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: Component;
  }>(),
  {
    description: '',
    icon: undefined,
  },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center py-12 px-6">
    <span
      v-if="icon"
      class="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 mb-3"
    >
      <component :is="icon" class="w-6 h-6" />
    </span>
    <p class="text-sm font-semibold text-slate-700 dark:text-slate-200">
      {{ title }}
    </p>
    <p
      v-if="description"
      class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm"
    >
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
