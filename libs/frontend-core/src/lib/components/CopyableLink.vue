<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { Copy, Check } from '@lucide/vue';
import Button from './Button.vue';

// The "or open this address by hand" fallback that sits under a QR code: the
// hint, the address itself, and one button that puts it on the clipboard.
// It exists as a primitive because it is needed under EVERY code the app paints
// — the phone-bridge session and the device pairing offer to begin with — and a
// second hand-rolled copy of it is exactly how the two phone dialogs drifted
// apart in the first place (#271).
const props = withDefaults(defineProps<{ url: string; hint?: string }>(), {
  hint: '',
});

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const copy = async (): Promise<void> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.url);
    } else {
      // Older/insecure contexts have no async clipboard — the selection dance
      // is the only way, and the address stays selectable either way.
      const ta = document.createElement('textarea');
      ta.value = props.url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // Clipboard blocked — the address is on screen and selectable.
  }
};

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="space-y-3 text-center">
    <div class="space-y-1">
      <p v-if="hint" class="text-xs text-slate-500 dark:text-slate-400">
        {{ hint }}
      </p>
      <a
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="block text-xxs break-all text-brand-600 dark:text-brand-400 hover:underline select-all"
      >
        {{ url }}
      </a>
    </div>
    <div class="flex justify-center">
      <Button
        variant="secondary"
        size="sm"
        :icon-left="copied ? Check : Copy"
        @click="copy"
      >
        {{ copied ? $t('common.copied') : $t('common.copyLink') }}
      </Button>
    </div>
  </div>
</template>
