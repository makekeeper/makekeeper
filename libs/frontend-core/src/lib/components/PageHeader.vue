<script setup lang="ts">
import { computed, type Component } from 'vue';
import PluginSlot from './PluginSlot.vue';

// One page-title treatment for every view. Replaces the ad-hoc range of
// text-2xl/xl/lg/base headers (and the title-less Logistics view) with a single
// icon + title + subtitle + actions layout.
//
// `contextRef` opts the header into the `page.header.actions` cross-plugin slot:
// a page passes the ORef of the entity it shows and any plugin that can act on
// that entity (e.g. exchange's Export) renders a control top-right, in one
// predictable spot, left of the page's own primary action. Pages that omit it
// pass an undefined ctx, so contributors self-hide.
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    icon?: Component;
    contextRef?: string;
  }>(),
  {
    subtitle: '',
    icon: undefined,
    contextRef: undefined,
  },
);

const actionsCtx = computed(() => ({ entityRef: props.contextRef }));
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <span
        v-if="icon"
        class="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
      >
        <component :is="icon" class="w-5 h-5" />
      </span>
      <div class="min-w-0">
        <h2
          class="text-lg md:text-xl font-bold text-slate-900 dark:text-white truncate"
        >
          {{ title }}
        </h2>
        <p
          v-if="subtitle"
          class="text-xs text-slate-500 dark:text-slate-400 mt-0.5"
        >
          {{ subtitle }}
        </p>
      </div>
    </div>
    <div
      v-if="$slots.actions || contextRef"
      class="flex items-center gap-2 shrink-0"
    >
      <PluginSlot name="page.header.actions" :ctx="actionsCtx" />
      <slot name="actions" />
    </div>
  </div>
</template>
