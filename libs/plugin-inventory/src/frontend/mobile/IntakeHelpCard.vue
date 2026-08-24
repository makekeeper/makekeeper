<script setup lang="ts">
import { Camera, Sparkles, PencilLine, Layers } from '@lucide/vue';

// What the four buttons on the intake screen do, contributed into the mobile
// home's help slot. It lives here rather than in the shell because these are
// inventory's buttons — the shell has no business describing them, and if this
// plugin is disabled the instructions leave with it.
//
// Ordered as the screen is, so the reading matches the thumb: shoot, recognize,
// type, review.
const steps = [
  { icon: Camera, key: 'inventory.mobile.help.shoot' },
  { icon: Sparkles, key: 'inventory.mobile.help.recognize' },
  { icon: PencilLine, key: 'inventory.mobile.help.manual' },
  { icon: Layers, key: 'inventory.mobile.help.review' },
];
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-800 p-4 space-y-3"
  >
    <h2 class="text-sm font-semibold">
      {{ $t('inventory.mobile.help.title') }}
    </h2>
    <ul class="space-y-2">
      <li v-for="step in steps" :key="step.key" class="flex items-start gap-3">
        <component
          :is="step.icon"
          class="w-4 h-4 mt-0.5 shrink-0 text-brand-500"
        />
        <span class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t(step.key) }}
        </span>
      </li>
    </ul>
  </section>
</template>
