<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import { QrCode } from '@lucide/vue';
import type { MobileOriginInfo } from '@makekeeper/plugin-contract';
import PairPhoneDialog from './PairPhoneDialog.vue';
import { useMobilePairingStore } from './pairing-store';

// "Open this on your phone", one gesture from the header — a sibling of the scan
// icon, and deliberately the same size and treatment.
//
// The pairing flow itself lives in `PairPhoneDialog`, and this component is
// where the app mounts it — ONCE (#261). The header is the plugin's only
// permanent presence in the shell, so hosting the dialog here is what lets the
// Devices section open the very same modal instead of a second copy: the button
// is behind `canPair`, the dialog deliberately is not.

const pairing = useMobilePairingStore();
const canPair = ref(false);

onMounted(async () => {
  try {
    canPair.value = (
      await apiJson<MobileOriginInfo>('/api/mobile/origin', { public: true })
    ).canPair;
  } catch {
    // Unknown means we promise nothing: a QR leading nowhere is worse than no
    // button at all.
    canPair.value = false;
  }
});
</script>

<template>
  <button
    v-if="canPair"
    type="button"
    :aria-label="$t('mobile.pairQr.aria')"
    aria-haspopup="dialog"
    :aria-expanded="pairing.isOpen"
    class="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    @click="pairing.open()"
  >
    <QrCode class="w-5 h-5" />
  </button>

  <PairPhoneDialog />
</template>
