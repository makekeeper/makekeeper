import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import type { HelloNudgeState } from '@makekeeper/plugin-contract';

// The "let us know you're here" card (#367, #368).
//
// The server decides everything: WHEN (a week after the instance first met the
// feature) and WHETHER this person still wants it (each closes it for
// themselves, on the server, so it does not come back in the next browser).
// The store only renders the answer.
export const useHelloStore = defineStore('hello', () => {
  const state = ref<HelloNudgeState | null>(null);
  const dismissing = ref(false);

  const show = computed(() => state.value?.show === true);

  // Best-effort: an older backend (404) or a network error mean "no card",
  // never an error on screen.
  const load = async (): Promise<void> => {
    try {
      state.value = await apiJson<HelloNudgeState>('/api/hello');
    } catch {
      // Silence is the right answer here: see above.
    }
  };

  const dismiss = async (): Promise<void> => {
    dismissing.value = true;
    try {
      state.value = await apiJson<HelloNudgeState>('/api/hello/dismiss', {
        method: 'POST',
      });
    } finally {
      dismissing.value = false;
    }
  };

  return { state, show, dismissing, load, dismiss };
});
