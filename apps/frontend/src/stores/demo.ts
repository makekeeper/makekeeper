import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiFetch, apiJson } from '@makekeeper/frontend-core';
import type { DemoClearResult, DemoStatus } from '@makekeeper/plugin-contract';

// Whether this instance is showing the demo workshop a first install seeds
// (#339), and the one action that removes it.
//
// Dismissal is per-browser on purpose: "I have read the notice" is not instance
// state, and a server-side flag would let the first visitor hide the notice
// from everyone else. Clearing the data IS instance state, and lives on the
// server.
const DISMISSED_KEY = 'demoBannerDismissed';

const readDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Sentinel for "the server says the demo data is still there". Not user text. */
export const DEMO_CLEAR_INCOMPLETE = 'demo-clear-incomplete';

export const useDemoStore = defineStore('demo', () => {
  const status = ref<DemoStatus | null>(null);
  const dismissed = ref(readDismissed());
  const clearing = ref(false);

  const active = computed(() => status.value?.active === true);
  const showBanner = computed(() => active.value && !dismissed.value);

  // Best-effort: an unreachable or older backend simply means no banner.
  const load = async (): Promise<void> => {
    const response = await apiFetch('/api/demo').catch(() => null);
    if (!response?.ok) return;
    status.value = await response.json();
  };

  const dismiss = (): void => {
    dismissed.value = true;
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // A browser that refuses storage still gets the banner hidden for this
      // session — the ref above is the source of truth for the render.
    }
  };

  /**
   * Remove the demo rows, then ask the server whether they are actually gone.
   *
   * The verification is not ceremony. The removal runs with scope enforcement
   * suspended on the server, and a delete that matched nothing would still
   * stamp the instance as cleared — so "it returned 200" and "the data is gone"
   * are genuinely different claims, and only the second one is worth telling
   * the user. The status is re-read rather than assumed.
   */
  const clear = async (): Promise<DemoClearResult> => {
    clearing.value = true;
    try {
      const result = await apiJson<DemoClearResult>('/api/demo/clear', {
        method: 'POST',
      });
      await load();
      if (status.value?.active !== false) {
        throw new Error(DEMO_CLEAR_INCOMPLETE);
      }
      return result;
    } finally {
      clearing.value = false;
    }
  };

  return { status, active, showBanner, clearing, load, dismiss, clear };
});
