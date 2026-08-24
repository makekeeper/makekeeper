<script setup lang="ts">
// Multi-select checkbox. The Switch primitive answers "is this setting on"; a
// list where several rows are picked for one action is a different question, and
// was so far answered by hand-classed native inputs that differed in size,
// colour and focus treatment across views.
//
// Native <input> underneath on purpose: checkbox semantics, keyboard behaviour
// and form association are the browser's job. Only the box itself is styled, via
// `appearance-none` plus a drawn tick, so light and dark match the rest of the
// design system instead of the OS accent colour.
withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    // Required when no visible <label for> names the box (icon-dense rows).
    ariaLabel?: string;
  }>(),
  {
    disabled: false,
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'change', value: boolean): void;
}>();

const onChange = (event: Event): void => {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const next = input.checked;
  emit('update:modelValue', next);
  emit('change', next);
};
</script>

<template>
  <input
    type="checkbox"
    :checked="modelValue"
    :disabled="disabled"
    :aria-label="ariaLabel"
    class="relative h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-md border border-slate-300 bg-white transition-colors checked:border-brand-500 checked:bg-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:bg-white/5 dark:checked:border-brand-500 dark:checked:bg-brand-500 checked:after:absolute checked:after:left-[3px] checked:after:top-0 checked:after:h-2.5 checked:after:w-1.5 checked:after:rotate-45 checked:after:border-b-2 checked:after:border-r-2 checked:after:border-white checked:after:content-['']"
    @change="onChange"
  />
</template>
