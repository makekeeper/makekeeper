import { defineStore } from 'pinia';
import { ref } from 'vue';

// Pairing a phone is ONE mechanism of this plugin, so it is one dialog: the
// header's QR button and the Devices section both drive this store, and the
// dialog itself is mounted exactly once (see PairPhoneDialog / MobilePairButton).
// Two copies of the same modal would mean two live pairing codes on screen,
// two pollers, and a second copy that is by definition the neglected one — the
// Devices screen's copy already was, before #261.
export const useMobilePairingStore = defineStore('mobile-pairing', () => {
  const isOpen = ref(false);
  // Bumped each time a phone completes pairing, so any list of devices on
  // screen can refetch without knowing who opened the dialog.
  const pairedCount = ref(0);

  const open = (): void => {
    isOpen.value = true;
  };

  const close = (): void => {
    isOpen.value = false;
  };

  const notifyPaired = (): void => {
    pairedCount.value += 1;
  };

  return { isOpen, pairedCount, open, close, notifyPaired };
});
