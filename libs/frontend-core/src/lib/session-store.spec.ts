import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from './session-store';

// Regression (#27): only a definitive answer toggles the overlay. A transient
// 5xx during a backend restart must NOT flip a single-user instance "on", which
// wedged every route behind a /login the disabled backend can't answer.
describe('session store — bootstrap overlay detection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubStatus = (status: number, ok: boolean, body: unknown = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, status, json: async () => body }) as Response),
    );

  it('disables the overlay on 404 (plugin off)', async () => {
    stubStatus(404, false);
    const store = useSessionStore();
    await store.bootstrap();
    expect(store.multiuserEnabled).toBe(false);
  });

  it('does NOT enable the overlay on a transient 5xx', async () => {
    stubStatus(503, false);
    const store = useSessionStore();
    await store.bootstrap();
    expect(store.multiuserEnabled).toBe(false);
  });

  it('enables the overlay on a 200 status payload', async () => {
    stubStatus(200, true, {
      hasUsers: true,
      configOk: true,
      registrationAllowed: true,
      user: null,
      scopes: [],
    });
    const store = useSessionStore();
    await store.bootstrap();
    expect(store.multiuserEnabled).toBe(true);
  });
});

// A paired phone presents a DEVICE token, which lives in its own storage slot
// (#199). The bootstrap probe has to send it too — otherwise the phone is
// authenticated for every API call yet reads as anonymous here, and the router
// bounces it to /login the moment pairing succeeds.
describe('session bootstrap — the device credential', () => {
  it('presents a stored device token when there is no session token', async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    localStorage.setItem('auth.deviceToken', 'device-token');

    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        calls.push(init);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            enabled: true,
            hasUsers: true,
            configOk: true,
            registrationAllowed: true,
            user: { id: 'u1', username: 'phone', isAdmin: false },
            scopes: [],
          }),
        } as Response);
      }),
    );

    const store = useSessionStore();
    await store.bootstrap();

    expect((calls[0].headers as Record<string, string>).Authorization).toBe(
      'Bearer device-token',
    );
    expect(store.isAuthenticated).toBe(true);
    vi.unstubAllGlobals();
  });
});
