import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { readLocal, writeLocal } from './browser-storage';

// What belongs to THIS BROWSER, and nothing else (#359, narrowed by #366).
//
// Web Bluetooth grants a device to one browser profile, so the printer this
// browser was granted is a fact about this browser. The density and the roll
// in the machine are not: they describe the printer, the panel asked for them
// twice because the two routes stored them in different places, and they now
// live with the instance (`print-settings-store.ts`). What is left here is the
// device label.

const DEVICE_KEY = 'printingNiimbot.device';

export const useNiimbotSettingsStore = defineStore('printingNiimbot', () => {
  // The last device the chooser returned, for display only ("last printer:
  // B1-X9…"). Reconnecting without the chooser needs `navigator.bluetooth.
  // getDevices()`, which is behind a Chrome flag — so this is a label, not a
  // handle, and the driver always goes through the chooser.
  const deviceName = ref<string>(readLocal(DEVICE_KEY) ?? '');

  function rememberDevice(name: string): void {
    deviceName.value = name;
    writeLocal(DEVICE_KEY, name);
  }

  return {
    deviceName,
    hasDevice: computed<boolean>(() => deviceName.value !== ''),
    rememberDevice,
  };
});
