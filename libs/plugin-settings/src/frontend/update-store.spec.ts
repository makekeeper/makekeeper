import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { useSessionStore } from '@makekeeper/frontend-core';
import type { DeployHookState, InstallInfo } from '@makekeeper/plugin-contract';
import { useUpdateStore } from './update-store';

const INSTALL_INFO: InstallInfo = {
  method: 'dokploy',
  container: true,
  confidence: 'declared',
};

const HOOK: DeployHookState = {
  hasUrl: true,
  hasToken: true,
  urlPreview: 'https://deploy.example/…cdef',
  method: 'POST',
  lastTriggeredAt: null,
  lastOutcome: 'never',
  lastStatusCode: null,
};

interface StubResponse {
  ok: boolean;
  body: unknown;
}

type FetchStub = Mock<
  (
    url: string,
    init?: RequestInit,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
>;

// The store fetches through apiFetch, which bottoms out in global fetch — the
// same seam the sibling view specs stub. `respond` sees the method so specs
// can answer a PATCH/POST differently from the reads.
const stubFetch = (
  respond: (url: string, method: string) => StubResponse,
): FetchStub => {
  const stub: FetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    const { ok, body } = respond(url, init?.method ?? 'GET');
    return { ok, status: ok ? 200 : 500, json: async () => body };
  });
  vi.stubGlobal('fetch', stub);
  return stub;
};

const respondOk = (url: string): StubResponse => {
  if (url.includes('install-info')) return { ok: true, body: INSTALL_INFO };
  if (url.includes('deploy-hook')) return { ok: true, body: HOOK };
  return { ok: true, body: {} };
};

describe('useUpdateStore (#106)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads install info and deploy hook on creation in single-user mode', async () => {
    stubFetch(respondOk);
    const store = useUpdateStore();
    await flushPromises();
    expect(store.installInfoStatus).toBe('ready');
    expect(store.installInfo).toEqual(INSTALL_INFO);
    expect(store.deployHookStatus).toBe('ready');
    expect(store.deployHook).toEqual(HOOK);
  });

  it('settles into a definite error state when a fetch fails', async () => {
    stubFetch((url) =>
      url.includes('install-info')
        ? { ok: false, body: { message: 'boom' } }
        : respondOk(url),
    );
    const store = useUpdateStore();
    await flushPromises();
    expect(store.installInfoStatus).toBe('error');
    expect(store.installInfo).toBeNull();
    expect(store.deployHookStatus).toBe('ready');
  });

  // The #101 regression: a non-permitted session used to leave the flags in
  // their "still loading" combination and the spinner never ended. Now the
  // gate is its own status and no request fires at all.
  it('reports forbidden — not loading, not error — for a non-admin session', async () => {
    const fetchStub = stubFetch(respondOk);
    const session = useSessionStore();
    session.multiuserEnabled = true;
    const store = useUpdateStore();
    await flushPromises();
    expect(store.installInfoStatus).toBe('forbidden');
    expect(store.deployHookStatus).toBe('forbidden');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('fetches once the session resolves to an admin', async () => {
    stubFetch(respondOk);
    const session = useSessionStore();
    session.multiuserEnabled = true;
    const store = useUpdateStore();
    await flushPromises();
    expect(store.installInfoStatus).toBe('forbidden');

    session.user = {
      id: 'u1',
      username: 'admin',
      displayName: null,
      isAdmin: true,
    };
    await flushPromises();
    expect(store.installInfoStatus).toBe('ready');
    expect(store.deployHook).toEqual(HOOK);
  });

  // A demoted session must not keep serving the admin-only payloads under a
  // `forbidden` status — data and status flip together.
  it('hides loaded data when the session stops being an admin', async () => {
    stubFetch(respondOk);
    const session = useSessionStore();
    const store = useUpdateStore();
    await flushPromises();
    expect(store.installInfo).toEqual(INSTALL_INFO);

    session.multiuserEnabled = true;
    await flushPromises();
    expect(store.installInfoStatus).toBe('forbidden');
    expect(store.installInfo).toBeNull();
    expect(store.deployHook).toBeNull();
  });

  // The PATCH response IS the fresh state (matching the pre-#106 behavior):
  // it is applied to the resource directly — no follow-up read — so success
  // is never reported while the panel could still flip to a load error.
  it('applies the save response without a second round-trip', async () => {
    const saved: DeployHookState = { ...HOOK, urlPreview: 'https://new/…9999' };
    const fetchStub = stubFetch((url, method) => {
      if (url.includes('deploy-hook') && method === 'PATCH')
        return { ok: true, body: saved };
      return respondOk(url);
    });
    const store = useUpdateStore();
    await flushPromises();
    const callsBefore = fetchStub.mock.calls.length;

    const ok = await store.saveDeployHook({ url: 'https://new/hook' });
    await flushPromises();
    expect(ok).toBe(true);
    expect(store.deployHook).toEqual(saved);
    expect(store.deployHookStatus).toBe('ready');
    expect(fetchStub.mock.calls.length).toBe(callsBefore + 1);
  });

  it('applies the trigger result state and reports the hook outcome', async () => {
    const fired: DeployHookState = {
      ...HOOK,
      lastTriggeredAt: '2026-07-28T00:00:00.000Z',
      lastOutcome: 'failed',
      lastStatusCode: 403,
    };
    stubFetch((url, method) => {
      if (url.includes('deploy-hook/trigger') && method === 'POST')
        return { ok: true, body: { ok: false, state: fired } };
      return respondOk(url);
    });
    const store = useUpdateStore();
    await flushPromises();

    const ok = await store.triggerDeployHook();
    await flushPromises();
    expect(ok).toBe(false);
    expect(store.deployHook).toEqual(fired);
  });
});
