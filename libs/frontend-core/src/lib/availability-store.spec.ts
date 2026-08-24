import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

// The store probes `/api/health` through apiFetch and takes a hint from the
// realtime `connected` ref — both are mocked so the test drives availability
// deterministically without a real backend or socket. Fake timers keep each
// store's self-scheduling poll from firing (and bleeding into the next test)
// unless the clock is explicitly advanced.
const apiFetch = vi.fn();
// A fresh ref per test (reassigned in beforeEach): each store watches its own,
// so a prior test's still-active watcher can't re-probe on this test's toggle.
let connected = ref(false);

vi.mock('./api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock('./realtime', () => ({
  useRealtime: () => ({ connected }),
}));

import { useAvailabilityStore } from './availability-store';

// Minimal stand-ins for a fetch Response — the store only reads `.ok`, and
// apiFetch is a mock, so no cast to the full Response type is needed.
const okResponse = { ok: true };
const errorResponse = { ok: false };

// Let the in-flight probe's promise chain settle (and any Vue watch flush run)
// without advancing far enough to trigger the next scheduled poll.
const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0);

describe('useAvailabilityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    apiFetch.mockReset();
    connected = ref(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts gated in "connecting" until the first probe resolves', () => {
    const store = useAvailabilityStore();
    // Pessimistic default: the overlay is up before any probe has run.
    expect(store.status).toBe('connecting');
    expect(store.isOffline).toBe(true);
    expect(store.everOnline).toBe(false);
  });

  it('goes online when the health probe succeeds', async () => {
    apiFetch.mockResolvedValue(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();

    expect(store.status).toBe('online');
    expect(store.isOffline).toBe(false);
    expect(store.everOnline).toBe(true);
    // A healthy first load is not a recovery — no re-bootstrap is signalled.
    expect(store.recoveryTick).toBe(0);
    // The probe is public (no auth header / no 401 handling).
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ public: true }),
    );
  });

  it('stays gated in "connecting" while the backend is still booting on first load', async () => {
    apiFetch.mockRejectedValue(new Error('connection refused'));
    const store = useAvailabilityStore();
    store.start();
    await flush();

    // Never been online ⇒ reassuring "connecting", not alarming "offline".
    expect(store.status).toBe('connecting');
    expect(store.isOffline).toBe(true);
    expect(store.everOnline).toBe(false);
  });

  it('shows "offline" (not "connecting") once a live connection drops', async () => {
    apiFetch.mockResolvedValueOnce(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();
    expect(store.status).toBe('online');

    apiFetch.mockRejectedValue(new Error('dropped'));
    store.checkNow();
    await flush();
    expect(store.status).toBe('offline');
    expect(store.isOffline).toBe(true);
  });

  it('goes offline on a non-ok HTTP response (5xx from a restarting backend)', async () => {
    // First a healthy probe so the "lost" wording applies, then a 5xx.
    apiFetch.mockResolvedValueOnce(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();

    apiFetch.mockResolvedValue(errorResponse);
    store.checkNow();
    await flush();
    expect(store.status).toBe('offline');
  });

  it('recovers automatically and signals a re-bootstrap once the backend answers again', async () => {
    apiFetch.mockRejectedValueOnce(new Error('down'));
    const store = useAvailabilityStore();
    store.start();
    await flush();
    expect(store.status).toBe('connecting');
    expect(store.recoveryTick).toBe(0);

    apiFetch.mockResolvedValue(okResponse);
    store.checkNow();
    await flush();
    expect(store.status).toBe('online');
    // A success after a failed probe is a recovery — the shell must re-bootstrap.
    expect(store.recoveryTick).toBe(1);
  });

  it('probes immediately when the socket connection state changes', async () => {
    apiFetch.mockResolvedValue(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    connected.value = true;
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('stops polling /api/health while online with the socket connected', async () => {
    apiFetch.mockResolvedValue(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();
    connected.value = true; // one confirming probe, then the heartbeat stops
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(2);

    // Well past any heartbeat interval: the socket is the outage signal now, so
    // no further /api/health requests fire.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('re-probes and goes offline the moment the socket drops', async () => {
    apiFetch.mockResolvedValue(okResponse);
    const store = useAvailabilityStore();
    store.start();
    await flush();
    connected.value = true;
    await flush();
    const before = apiFetch.mock.calls.length;

    apiFetch.mockRejectedValue(new Error('down'));
    connected.value = false; // socket lost ⇒ immediate confirming probe
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(before + 1);
    expect(store.status).toBe('offline');
  });
});
