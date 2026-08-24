<script setup lang="ts">
// Accessible on/off switch. Replaces the six hand-rolled toggles (native
// checkboxes, bare divs, peer-checkbox tricks) that differed in size, colour and
// AT semantics. One size, one colour, proper `role="switch"` + focus ring.
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    // So a `<label for>` can point at the switch itself.
    id?: string;
  }>(),
  {
    disabled: false,
    ariaLabel: undefined,
    id: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'change', value: boolean): void;
}>();

const toggle = (): void => {
  if (props.disabled) return;
  const next = !props.modelValue;
  emit('update:modelValue', next);
  emit('change', next);
};
</script>

<template>
  <button
    :id="id"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @click="toggle"
    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
    :class="modelValue ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/10'"
  >
    <span
      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
      :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
    />
  </button>
</template>
