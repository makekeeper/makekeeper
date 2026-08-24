import { defineStore } from 'pinia';
import { ref, computed, type ComputedRef } from 'vue';
import {
  apiFetch,
  apiJson,
  useResource,
  useSessionStore,
  type Resource,
  type ResourceState,
} from '@makekeeper/frontend-core';
import type {
  DeployHookSettingsPatch,
  DeployHookState,
  DeployHookTriggerResult,
  InstallInfo,
  UpdateCheckSettings,
  UpdateCheckState,
} from '@makekeeper/plugin-contract';

// What a panel can be in, from the view's perspective: the resource's own
// discriminated status, plus `forbidden` — the admin gate never let the fetch
// fire. Kept distinct from `error` so "you may not see this" stops masquerading
// as "this failed to load" (#106; the ambiguity behind the #101 endless-spinner
// bug).
export type UpdatePanelStatus = ResourceState<unknown>['status'] | 'forbidden';

// Instance update state (#94). Admin-only: the endpoints are @AdminOnly, and in
// single-user mode the sole user is effectively the admin.
export const useUpdateStore = defineStore('settings-updates', () => {
  const state = ref<UpdateCheckState | null>(null);
  const loading = ref(false);
  const checking = ref(false);
  const triggering = ref(false);

  const canAdminister = computed(() => {
    const session = useSessionStore();
    return !session.multiuserEnabled || session.isAdmin;
  });

  const updateAvailable = computed(() => state.value?.updateAvailable === true);

  async function refresh(): Promise<void> {
    if (!canAdminister.value) return;
    loading.value = true;
    try {
      const res = await apiFetch('/api/settings/updates');
      if (res.ok) state.value = (await res.json()) as UpdateCheckState;
    } finally {
      loading.value = false;
    }
  }

  // Install-method diagnostics (#100) and the deploy hook (#101), each read
  // through `useResource` (#106): the composable owns the loading|ready|error
  // union, the abort-per-refetch and the stale-response ordering the former
  // hand-rolled data+failed ref pairs did not. `enabled` carries the admin
  // gate, so a non-permitted session never fires the request — and flipping to
  // admin (session resolving late) fetches on its own.
  //
  // `keepPreviousData` on both: revisits re-read the resource (the view
  // refetches on mount), and a card that tears down to a spinner while
  // re-loading what is already on screen reads as a navigation, not a refresh.
  //
  // One shape for both admin-gated panels: the resource, the null-when-
  // forbidden data projection, the panel status, the "settled enough to
  // render" flag and the guarded refresh (refetch does not consult `enabled`,
  // so the guard cannot live inside the resource).
  interface AdminPanel<T> {
    resource: Resource<T>;
    data: ComputedRef<T | null>;
    status: ComputedRef<UpdatePanelStatus>;
    resolved: ComputedRef<boolean>;
    refresh: () => Promise<void>;
  }

  function adminPanel<T>(path: string): AdminPanel<T> {
    const resource = useResource<T>((signal) => apiJson<T>(path, { signal }), {
      enabled: canAdminister,
      keepPreviousData: true,
    });
    // Gated alongside status: when a session stops being admin the panel must
    // not keep serving the previously loaded (admin-only) value under a
    // `forbidden` status.
    const data = computed<T | null>(() =>
      canAdminister.value ? (resource.data.value ?? null) : null,
    );
    const status = computed<UpdatePanelStatus>(() =>
      canAdminister.value ? resource.state.value.status : 'forbidden',
    );
    // "Resolved" = safe to render a definite card: any settled status counts
    // (`forbidden` included — a gate that never fetches must not spin), and so
    // does data kept on screen during a refetch (`keepPreviousData`).
    const resolved = computed<boolean>(
      () => status.value !== 'loading' || data.value !== null,
    );
    const refresh = async (): Promise<void> => {
      if (!canAdminister.value) return;
      await resource.refetch();
    };
    return { resource, data, status, resolved, refresh };
  }

  const installInfoPanel = adminPanel<InstallInfo>(
    '/api/settings/install-info',
  );
  const deployHookPanel = adminPanel<DeployHookState>(
    '/api/settings/deploy-hook',
  );

  async function checkNow(): Promise<UpdateCheckState | null> {
    if (!canAdminister.value) return null;
    checking.value = true;
    try {
      const res = await apiFetch('/api/settings/updates/check', {
        method: 'POST',
      });
      if (res.ok) state.value = (await res.json()) as UpdateCheckState;
      return state.value;
    } finally {
      checking.value = false;
    }
  }

  async function saveDeployHook(
    patch: DeployHookSettingsPatch,
  ): Promise<boolean> {
    try {
      const saved = await apiJson<DeployHookState>(
        '/api/settings/deploy-hook',
        { method: 'PATCH', body: patch },
      );
      // The PATCH response IS the fresh state — apply it to the resource
      // (`setData`) instead of re-fetching: no second round-trip, and success
      // is only reported with the confirmed state already on screen.
      deployHookPanel.resource.setData(saved);
      return true;
    } catch {
      return false;
    }
  }

  // Fires the configured hook. The caller MUST have confirmed with the admin
  // first (§ the danger-tone useConfirm in UpdatesView) — this never self-fires.
  // A rejected hook still returns a state to render (lastOutcome/
  // lastStatusCode), so `ok` is the only success signal.
  async function triggerDeployHook(): Promise<boolean> {
    if (!canAdminister.value) return false;
    triggering.value = true;
    try {
      const result = await apiJson<DeployHookTriggerResult>(
        '/api/settings/deploy-hook/trigger',
        { method: 'POST' },
      );
      deployHookPanel.resource.setData(result.state);
      return result.ok;
    } catch {
      return false;
    } finally {
      triggering.value = false;
    }
  }

  async function save(patch: Partial<UpdateCheckSettings>): Promise<boolean> {
    const res = await apiFetch('/api/settings/updates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) state.value = (await res.json()) as UpdateCheckState;
    return res.ok;
  }

  return {
    state,
    installInfo: installInfoPanel.data,
    installInfoStatus: installInfoPanel.status,
    installInfoResolved: installInfoPanel.resolved,
    deployHook: deployHookPanel.data,
    deployHookStatus: deployHookPanel.status,
    deployHookResolved: deployHookPanel.resolved,
    loading,
    checking,
    triggering,
    canAdminister,
    updateAvailable,
    refresh,
    refreshInstallInfo: installInfoPanel.refresh,
    refreshDeployHook: deployHookPanel.refresh,
    saveDeployHook,
    triggerDeployHook,
    checkNow,
    save,
  };
});
