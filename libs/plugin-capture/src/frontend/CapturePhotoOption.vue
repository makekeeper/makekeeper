<script setup lang="ts">
// Self-contained "shoot it on your phone" option (#58): trigger button + the
// shared phone-bridge QR modal, contributed into other plugins' upload surfaces
// (e.g. the logistics screenshot-import) via a PluginSlot. The host supplies the
// PhoneBridgeContext (kind 'capture') and receives the uploaded photo URL — no
// host code imports the capture plugin (#77).
import { ref } from 'vue';
import type { PhoneBridgeContext } from '@makekeeper/plugin-contract';
import { PhoneBridgeModal } from '@makekeeper/frontend-core';
import { Smartphone } from '@lucide/vue';

const props = defineProps<{ context: PhoneBridgeContext }>();
const emit = defineEmits<{ (e: 'photo', url: string): void }>();

// PhoneBridgeModal renders only its modal and exposes open()/isActive.
const modalRef = ref<{ open: () => void } | null>(null);

// A capture message carries the saved photo's public URL.
const onMessage = (data: unknown): void => {
  const url = (data as { url?: string } | undefined)?.url;
  if (url) emit('photo', url);
};
</script>

<template>
  <button
    type="button"
    class="glass-card rounded-xl px-4 py-3 border border-slate-200 dark:border-white/5 flex items-center gap-2 text-sm hover:border-brand-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    @click="modalRef?.open()"
  >
    <Smartphone class="w-4 h-4 text-brand-500" />
    {{ $t('capture.option.fromPhone') }}
  </button>
  <PhoneBridgeModal
    ref="modalRef"
    :context="props.context"
    @message="onMessage"
  />
</template>
