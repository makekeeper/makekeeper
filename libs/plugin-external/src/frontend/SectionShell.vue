<script setup lang="ts">
// The frame every section of the external-plugins page shares (#262): a
// heading, one explanatory line, the section's own actions on the right, and
// the content below. Kept local to this plugin — it is a page-level rhythm,
// not a design-system primitive.
defineProps<{ title: string; description: string }>();
</script>

<template>
  <section class="space-y-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">
          {{ title }}
        </h2>
        <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>
