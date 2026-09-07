import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  TelemetryPayload,
  TelemetryState,
} from '@makekeeper/plugin-contract';
import { apiJson } from './api';

// Opt-in liveness telemetry, client side (#343).
//
// In `frontend-core` because two unrelated surfaces read the same instance
// state: the shell owns the one-time consent dialog (it has to appear wherever
// the admin happens to be, exactly like the demo banner), and the settings
// plugin owns the switch that turns it off again. A store in either of them
// would be the other one reaching across a boundary.
//
// Every request here is admin-only on the server, so nothing fetches before a
// session exists — `load()` is called by surfaces that already know they are
// looking at an admin.
export const useTelemetryStore = defineStore('telemetry', () => {
  const state = ref<TelemetryState | null>(null);
  // Distinguishes "not asked yet" from "asked and got nothing". Without it a
  // failed read is indistinguishable from a slow one, and the surface that
  // renders from `state` has no honest way to say which it is showing.
  const loaded = ref(false);
  const preview = ref<TelemetryPayload | null>(null);
  const busy = ref(false);

  const enabled = computed(() => state.value?.consent === 'granted');

  /**
   * Whether the one-time dialog is still owed to a human.
   *
   * Never asks when the build has nowhere to send: a fork that blanked the
   * endpoint must not put our question in front of its users.
   */
  const shouldPrompt = computed(
    () =>
      state.value !== null &&
      !state.value.prompted &&
      state.value.endpointConfigured,
  );

  async function load(): Promise<void> {
    try {
      state.value = await apiJson<TelemetryState>('/api/telemetry');
    } catch {
      // A non-admin, or an instance that has not migrated yet. Silence is
      // right: this is a background read for an optional dialog.
      state.value = null;
    } finally {
      loaded.value = true;
    }
  }

  /** What a ping would carry, built by the sender. Reading it sends nothing. */
  async function loadPreview(): Promise<void> {
    try {
      preview.value = await apiJson<TelemetryPayload>('/api/telemetry/preview');
    } catch {
      preview.value = null;
    }
  }

  async function decide(granted: boolean): Promise<void> {
    busy.value = true;
    try {
      state.value = await apiJson<TelemetryState>('/api/telemetry/consent', {
        method: 'POST',
        body: { granted },
      });
    } finally {
      busy.value = false;
    }
  }

  /**
   * "Asked, and answered nothing." Closing the dialog must not be recorded as a
   * refusal — the promise is that the question is put once, not that silence
   * counts as an answer.
   */
  async function markPrompted(): Promise<void> {
    state.value = await apiJson<TelemetryState>('/api/telemetry/prompted', {
      method: 'POST',
    });
  }

  return {
    state,
    loaded,
    preview,
    busy,
    enabled,
    shouldPrompt,
    load,
    loadPreview,
    decide,
    markPrompted,
  };
});
