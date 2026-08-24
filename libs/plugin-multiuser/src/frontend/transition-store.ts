import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ModeTransitionPhase = 'enabling' | 'disabling';

// How long the overlay plays before the hook hard-reloads the app. Long enough
// to read the message, short enough not to feel like a loading screen.
const TRANSITION_MS = 2400;

// Drives the fullscreen "mode is changing" effect shown when the admin flips
// the multiuser plugin itself. The phase is never cleared here — the lifecycle
// hook ends in a full page navigation, so the overlay stays up until unload
// (no flash of the stale UI underneath).
export const useModeTransitionStore = defineStore(
  'multiuser-transition',
  () => {
    const phase = ref<ModeTransitionPhase | null>(null);

    const play = (next: ModeTransitionPhase): Promise<void> => {
      phase.value = next;
      return new Promise((resolve) => setTimeout(resolve, TRANSITION_MS));
    };

    return { phase, play };
  },
);
