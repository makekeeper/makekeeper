<script setup lang="ts">
// A one-line secret/value the user is meant to take away: the whole row is the
// copy affordance (click anywhere on it), with the icon on the right only
// signalling that — and flipping to a check for a moment after a copy.
import { ref, onBeforeUnmount } from 'vue';
import { Copy, Check } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { copyText } from '../clipboard';

const props = defineProps<{
  value: string;
  /** Names the value for screen readers; falls back to the generic "Copy". */
  ariaLabel?: string;
}>();

const emit = defineEmits<{ (e: 'copied'): void }>();

const { t } = useI18n();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const copy = async (): Promise<void> => {
  await copyText(props.value);
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 1500);
  emit('copied');
};

defineExpose({ copy });

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    type="button"
    :aria-label="ariaLabel ?? t('common.copy')"
    :title="t('common.copy')"
    class="group flex w-full items-center gap-3 rounded-xl bg-slate-100 p-3 text-left transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-white/10 dark:hover:bg-white/15"
    @click="copy"
  >
    <!-- One line, ellipsed: a token that wraps turns a card into a wall, and
         the value is meant for the clipboard, not for reading. The full string
         is what gets copied and what a screen reader gets. -->
    <code
      class="min-w-0 flex-1 truncate font-mono text-xs text-slate-800 dark:text-slate-200"
    >
      {{ value }}
    </code>
    <component
      :is="copied ? Check : Copy"
      class="h-4 w-4 shrink-0"
      :class="
        copied
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-slate-500 dark:text-slate-400'
      "
      aria-hidden="true"
    />
  </button>
</template>
