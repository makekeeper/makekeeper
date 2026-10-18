<script setup lang="ts">
import { type Component } from 'vue';
import Spinner from './Spinner.vue';

// A destination that IS the button: one press, one outcome.
//
// The shape a list of ways-out takes when choosing and doing are the same act —
// the print dialog's printers, and anything later that offers "here are the
// places this can go". It exists as a primitive because the alternative is what
// the print dialog had for a week: two rows of fifteen inline utility classes
// each, diverging in their hover and border treatment, with the focus ring and
// the live region remembered in one of them and forgotten in the other.
//
// The row is ONE `<button>`, never a clickable `<div>` with controls inside it:
// a whole-row target with a nested button is a keyboard trap and an ambiguous
// accessible name. Whatever the row is doing is announced from here, so a
// caller that changes `subtitle` while the work runs says so to a screen reader
// without arranging anything.
withDefaults(
  defineProps<{
    title: string;
    // The quiet second line: how this destination is reached, or — while it is
    // working — what it is doing.
    subtitle?: string;
    // Lucide icon for the chip on the left.
    icon?: Component;
    // The verb at the right edge: what pressing will do, now.
    action?: string;
    // The row this list expects to be pressed, wearing the accent.
    lead?: boolean;
    busy?: boolean;
    disabled?: boolean;
  }>(),
  {
    subtitle: '',
    icon: undefined,
    action: '',
    lead: false,
    busy: false,
    disabled: false,
  },
);

defineEmits<{ (e: 'press'): void }>();
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:opacity-60"
    :class="
      lead
        ? 'border-brand-500/60 bg-brand-500/5 hover:bg-brand-500/10'
        : 'border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5'
    "
    :disabled="disabled || busy"
    @click="$emit('press')"
  >
    <span
      v-if="icon"
      class="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-600 dark:bg-white/10 dark:text-slate-300"
      :class="lead ? 'bg-white' : 'bg-slate-100'"
    >
      <component :is="icon" class="size-4" />
    </span>

    <span class="flex min-w-0 flex-col">
      <span class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ title }}
      </span>
      <!-- The live region is the second line, because that is where the work
           reports itself: "Sending… 128 of 240 rows", then "Printed." -->
      <span
        v-if="subtitle"
        class="text-xs text-slate-500 dark:text-slate-400"
        aria-live="polite"
      >
        {{ subtitle }}
      </span>
    </span>

    <span
      class="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-semibold"
      :class="
        lead
          ? 'text-brand-600 dark:text-brand-400'
          : 'text-slate-600 dark:text-slate-300'
      "
    >
      <Spinner v-if="busy" class="size-4" />
      <template v-else>{{ action }}</template>
    </span>
  </button>
</template>
