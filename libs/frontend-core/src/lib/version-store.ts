import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UpdateVersionSummary } from '@makekeeper/plugin-contract';
import { apiFetch } from './api';

// Shell-level app version (#94). Reads the public `/api/settings/version` summary
// so the sidebar can show the installed version and hint when a newer one exists.
// Non-sensitive and unauthenticated — safe to fetch for every user.
export const useVersionStore = defineStore('app-version', () => {
  const summary = ref<UpdateVersionSummary | null>(null);

  const version = computed(() => summary.value?.currentVersion ?? null);
  const updateAvailable = computed(
    () => summary.value?.updateAvailable === true,
  );
  const releaseUrl = computed(() => summary.value?.releaseUrl ?? null);
  const latestVersion = computed(() => summary.value?.latestVersion ?? null);

  async function refresh(): Promise<void> {
    try {
      const res = await apiFetch('/api/settings/version');
      if (res.ok) summary.value = (await res.json()) as UpdateVersionSummary;
    } catch {
      // A version probe must never disrupt the shell.
    }
  }

  return {
    summary,
    version,
    updateAvailable,
    releaseUrl,
    latestVersion,
    refresh,
  };
});
