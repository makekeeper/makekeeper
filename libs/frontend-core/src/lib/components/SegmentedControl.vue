<script setup lang="ts" generic="T extends string">
import { computed, type Component } from 'vue';
import { Loader } from '@lucide/vue';

// Compact multi-position selector — a horizontal row of mutually-exclusive
// segments, each optionally icon-only. Replaces hand-rolled two/three-state
// toggles (e.g. the theme switch) with one accessible `radiogroup`: roving
// focus, arrow-key navigation, focus-visible ring and per-segment labels.
//
// Two visual sizes: the default compact `sm` (header theme switch) and `lg`
// (full-width settings panels). Optional per-segment `activeClass` tints and a
// `busyValue` (spinner + disabled while an async switch is in flight) let a
// settings surface reuse this instead of forking a bespoke control.
export type SegmentedOption<V extends string> = {
  value: V;
  // Visible text; also the accessible name for icon-only segments.
  label: string;
  icon?: Component;
  // Small count chip after the label (e.g. items/events behind a tab-like
  // segment), visible before the segment is selected.
  badge?: string;
};

const props = withDefaults(
  defineProps<{
    modelValue: T;
    options: SegmentedOption<T>[];
    // Group label for assistive tech (the control as a whole).
    ariaLabel: string;
    // Hide the text label, leaving the icon only (label still names the segment).
    iconOnly?: boolean;
    // `sm` = compact inline control; `lg` = larger settings-panel control.
    size?: 'sm' | 'lg';
    // Stretch across the container, each segment sharing the width equally.
    fullWidth?: boolean;
    // Per-segment active tint, overriding the neutral default (e.g. a status
    // colour per mode). Values not present fall back to the neutral style.
    activeClass?: Partial<Record<T, string>>;
    // The segment whose switch is in flight — shows a spinner and disables the
    // whole control until it clears.
    busyValue?: T | null;
    // Clicking the active segment deselects it, emitting `deselectValue` —
    // turns the control into a group of mutually-exclusive toggles (e.g.
    // collapsible card sections where "nothing open" is a valid state).
    deselectValue?: T;
  }>(),
  {
    iconOnly: false,
    size: 'sm',
    fullWidth: false,
    activeClass: undefined,
    busyValue: null,
    deselectValue: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void;
  (e: 'change', value: T): void;
}>();

const containerClass = computed<string>(() => {
  const layout = props.fullWidth ? 'flex w-full' : 'inline-flex items-center';
  const sizing =
    props.size === 'lg' ? 'gap-1 rounded-2xl p-1' : 'gap-0.5 rounded-xl p-0.5';
  return `${layout} ${sizing} border border-slate-200 bg-slate-100/60 dark:border-white/10 dark:bg-white/5`;
});

const buttonClass = computed<string>(() => {
  const layout = props.fullWidth ? 'flex flex-1' : 'inline-flex';
  const sizing =
    props.size === 'lg'
      ? 'gap-2 rounded-xl px-3 py-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-brand-500/50'
      : 'gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-brand-500/40';
  return `${layout} ${sizing} items-center justify-center text-xs font-semibold focus-visible:ring-2 disabled:cursor-not-allowed`;
});

const inactiveClass = computed<string>(() =>
  props.size === 'lg'
    ? 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:hover:text-slate-500'
    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
);

const activeClassFor = (value: T): string =>
  props.activeClass?.[value] ??
  'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white';

const select = (value: T): void => {
  if (value === props.modelValue) {
    if (props.deselectValue === undefined || value === props.deselectValue)
      return;
    emit('update:modelValue', props.deselectValue);
    emit('change', props.deselectValue);
    return;
  }
  emit('update:modelValue', value);
  emit('change', value);
};

// Arrow keys move selection to the adjacent segment, wrapping at the ends —
// the expected radiogroup interaction.
const onKey = (event: KeyboardEvent): void => {
  if (props.busyValue !== null) return;
  const isPrev = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  if (!isPrev && !isNext) return;
  event.preventDefault();
  const index = props.options.findIndex((o) => o.value === props.modelValue);
  const count = props.options.length;
  const nextIndex = (index + (isNext ? 1 : -1) + count) % count;
  select(props.options[nextIndex].value);
};

// Deselectable mode can leave no segment selected — keep the group reachable
// by parking the roving tabindex on the first segment.
const tabindexFor = (value: T, index: number): number => {
  if (value === props.modelValue) return 0;
  const hasSelection = props.options.some((o) => o.value === props.modelValue);
  return !hasSelection && index === 0 ? 0 : -1;
};
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="ariaLabel"
    :class="containerClass"
    @keydown="onKey"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :aria-label="option.label"
      :tabindex="tabindexFor(option.value, index)"
      :disabled="busyValue !== null"
      :class="[
        buttonClass,
        option.value === modelValue
          ? activeClassFor(option.value)
          : inactiveClass,
      ]"
      @click="select(option.value)"
    >
      <Loader
        v-if="busyValue === option.value"
        class="h-4 w-4 shrink-0 animate-spin"
      />
      <component
        :is="option.icon"
        v-else-if="option.icon"
        class="h-4 w-4 shrink-0"
      />
      <span v-if="!iconOnly">{{ option.label }}</span>
      <span
        v-if="option.badge !== undefined"
        class="min-w-[18px] rounded-full px-1.5 text-center text-xxs font-bold"
        :class="
          option.value === modelValue
            ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
            : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
        "
        >{{ option.badge }}</span
      >
    </button>
  </div>
</template>
