<script setup lang="ts">
import { ref, computed } from 'vue';
import { X, Plus } from '@lucide/vue';

// A free list of short tokens the user edits by hand — file extensions, mime
// masks (#112). Values are added with Enter/comma/blur and removed by their
// chip, which is both faster and less error-prone than a comma-separated text
// field: each value is validated as it is added, so a typo bounces at the
// moment it is made instead of silently becoming a rule that matches nothing.
//
// Deliberately value-agnostic: normalisation and validation come from the
// caller, because what counts as a valid token belongs to whoever owns the
// list, not to the widget.
const props = withDefaults(
  defineProps<{
    modelValue: string[];
    placeholder?: string;
    addLabel: string;
    removeLabel: string;
    inputId?: string;
    disabled?: boolean;
    // Returns the value to store, or null to reject the entry.
    normalise?: (raw: string) => string | null;
  }>(),
  {
    placeholder: '',
    inputId: undefined,
    disabled: false,
    normalise: (raw: string) => {
      const value = raw.trim();
      return value.length > 0 ? value : null;
    },
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

const draft = ref('');
const invalid = ref(false);

const values = computed<string[]>(() => props.modelValue);

const commit = (): void => {
  // A paste of "a, b, c" is split here rather than rejected wholesale — the
  // shape people copy out of a config file is a comma-separated line.
  const parts = draft.value
    .split(',')
    .map((part) => props.normalise(part))
    .filter((part): part is string => part !== null && part.length > 0);
  if (parts.length === 0) {
    invalid.value = draft.value.trim().length > 0;
    return;
  }
  const next = [...values.value];
  for (const part of parts) if (!next.includes(part)) next.push(part);
  emit('update:modelValue', next);
  draft.value = '';
  invalid.value = false;
};

const remove = (value: string): void => {
  emit(
    'update:modelValue',
    values.value.filter((item) => item !== value),
  );
};

// Backspace on an empty field removes the last chip — the gesture every tag
// field has, and the only way to undo a mistake without reaching for the mouse.
const onBackspace = (): void => {
  if (draft.value.length > 0 || values.value.length === 0) return;
  remove(values.value[values.value.length - 1]);
};
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1.5 p-2 rounded-xl glass-input focus-within:ring-2 focus-within:ring-brand-500/60"
    :class="{ 'opacity-60': disabled }"
  >
    <span
      v-for="value in values"
      :key="value"
      class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xxs font-medium bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300"
    >
      {{ value }}
      <button
        type="button"
        :aria-label="`${removeLabel}: ${value}`"
        :disabled="disabled"
        class="p-0.5 rounded-full text-slate-400 hover:text-red-600 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 transition-colors"
        @click="remove(value)"
      >
        <X class="w-3 h-3" />
      </button>
    </span>

    <div class="flex items-center gap-1 flex-1 min-w-32">
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="invalid"
        class="flex-1 min-w-0 bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
        :class="{ 'text-red-600 dark:text-red-400': invalid }"
        @keydown.enter.prevent="commit"
        @keydown.,.prevent="commit"
        @keydown.delete="onBackspace"
        @blur="commit"
        @input="invalid = false"
      />
      <button
        type="button"
        :aria-label="addLabel"
        :title="addLabel"
        :disabled="disabled || draft.trim().length === 0"
        class="p-1 rounded-lg text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 transition-colors"
        @click="commit"
      >
        <Plus class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
