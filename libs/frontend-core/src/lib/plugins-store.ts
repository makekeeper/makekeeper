import { defineStore } from 'pinia';
import { apiFetch } from './api';
import { getFrontendPlugin } from './registry';
import { ref, computed } from 'vue';
import type { PluginPublic } from '@makekeeper/plugin-contract';

// Reactive source of truth for which plugins are enabled. Fetched once at
// bootstrap from `GET /api/plugins`; toggled from the admin via `PATCH`. The
// sidebar, router guard and settings host all read from here, so a toggle
// applies across the UI without a page reload.
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginPublic[]>([]);
  const loaded = ref(false);

  const byId = computed<Record<string, PluginPublic>>(() =>
    Object.fromEntries(plugins.value.map((p) => [p.id, p])),
  );

  // Unknown plugins default to enabled so nothing is hidden before the fetch
  // resolves (and for the core `dashboard`/app routes that aren't plugins).
  const isEnabled = (pluginId: string): boolean =>
    byId.value[pluginId]?.isEnabled ?? true;

  const fetchPlugins = async (): Promise<void> => {
    try {
      const response = await apiFetch('/api/plugins');
      if (response.ok) {
        plugins.value = await response.json();
      }
    } catch (error) {
      console.error('Error fetching plugins:', error);
    } finally {
      loaded.value = true;
    }
  };

  // First-load helper for callers that only need the list to exist (the router
  // guard on a cold deep link). Deduped against the bootstrap fetch in main.ts;
  // unlike `fetchPlugins` it never re-fetches once loaded, so it cannot hand
  // back stale data after an admin toggle.
  let inFlightLoad: Promise<void> | null = null;
  const ensureLoaded = (): Promise<void> => {
    if (loaded.value) return Promise.resolve();
    inFlightLoad ??= fetchPlugins().finally(() => {
      inFlightLoad = null;
    });
    return inFlightLoad;
  };

  // Instance-level (admin) toggle. Optimistically flips both the instance flag
  // and the caller's effective state, then re-fetches so the effective states
  // (per-user/grant narrowing) come back exact.
  const setEnabled = async (
    pluginId: string,
    isEnabledValue: boolean,
  ): Promise<void> => {
    const current = byId.value[pluginId];
    const previous = current
      ? {
          isEnabled: current.isEnabled,
          instanceEnabled: current.instanceEnabled,
        }
      : undefined;
    if (current) {
      current.instanceEnabled = isEnabledValue;
      current.isEnabled = isEnabledValue;
    }
    try {
      const response = await apiFetch(`/api/plugins/${pluginId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: isEnabledValue }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fetchPlugins();
    } catch (error) {
      console.error(`Error toggling plugin ${pluginId}:`, error);
      if (current && previous) Object.assign(current, previous);
      return;
    }
    // Frontend lifecycle hook of the toggled plugin (transition UX etc.).
    // Outside the try above on purpose: a hook failure must not roll the
    // already-persisted toggle back.
    const plugin = getFrontendPlugin(pluginId);
    const hook = isEnabledValue
      ? plugin?.onInstanceEnabled
      : plugin?.onInstanceDisabled;
    try {
      await hook?.();
    } catch (error) {
      console.error(`Error in ${pluginId} lifecycle hook:`, error);
    }
  };

  return {
    plugins,
    loaded,
    byId,
    isEnabled,
    fetchPlugins,
    ensureLoaded,
    setEnabled,
  };
});
