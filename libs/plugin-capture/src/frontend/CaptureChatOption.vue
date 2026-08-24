<script setup lang="ts">
// Chat-composer "capture from phone" attach option (#58): contributed into the
// app shell's `app.header.capture` slot. Renders the attach-menu row and owns
// the shared phone-bridge QR modal, reporting capture-active state / photos /
// selection back to the host through the slot ctx callbacks (`onPhoto`,
// `onActiveChange`, `onSelect`). The shell imports no capture code; capture is
// just a phone-bridge consumer with kind 'capture' (#77).
import { ref, watch } from 'vue';
import type { PhoneBridgeContext } from '@makekeeper/plugin-contract';
import { PhoneBridgeModal } from '@makekeeper/frontend-core';
import { Smartphone } from '@lucide/vue';

const props = defineProps<{ context: PhoneBridgeContext }>();
const emit = defineEmits<{
  (e: 'photo', url: string): void;
  (e: 'activeChange', active: boolean): void;
  (e: 'select'): void;
}>();

// PhoneBridgeModal renders only its modal and exposes open()/isActive.
const modalRef = ref<{ open: () => void; isActive: boolean } | null>(null);

// Mirror the modal's live-session flag up to the host so its composer "+" icon
// can pulse while a phone capture is in progress.
watch(
  () => modalRef.value?.isActive ?? false,
  (active) => emit('activeChange', active),
);

const trigger = (): void => {
  emit('select');
  modalRef.value?.open();
};

// A capture message carries the saved photo's public URL.
const onMessage = (data: unknown): void => {
  const url = (data as { url?: string } | undefined)?.url;
  if (url) emit('photo', url);
};
</script>

<template>
  <button
    type="button"
    class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-colors"
    @click="trigger"
  >
    <Smartphone class="w-4 h-4 text-slate-400 dark:text-slate-500" />
    {{ $t('capture.desktop.button') }}
  </button>
  <PhoneBridgeModal
    ref="modalRef"
    :context="props.context"
    @message="onMessage"
  />
</template>
