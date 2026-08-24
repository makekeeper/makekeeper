import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
// Side effect: building the i18n instance runs the plugin loader, so
// `initializeRouter` below registers the REAL plugin routes with their real
// `meta` (public/adminOnly/pluginId) — this spec exercises the guard against
// the production route table, not test doubles.
import '../i18n';
import router, { initializeRouter } from './index';

initializeRouter();

// Companion to index.spec.ts (which isolates the bootstrap race with synthetic
// routes): verifies the /login wall against the real routes — the real /login
// carries meta.public (no redirect loop) and /access/users carries adminOnly.
describe('router guard — real plugin route table', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (user: { id: string; isAdmin: boolean } | null) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/auth/status')) {
          return {
            ok: true,
            json: async () => ({
              enabled: true,
              hasUsers: true,
              configOk: true,
              registrationAllowed: true,
              user,
              scopes: user ? [{ scopeId: user.id, accessLevel: 'OWNER' }] : [],
            }),
          } as Response;
        }
        if (url.includes('/api/plugins')) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }),
    );
  };

  it('anonymous deep link to /settings/plugins lands on the real /login route', async () => {
    stubFetch(null);

    await router.push('/settings/plugins');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.meta.public).toBe(true);
  });

  it('anonymous deep link to the admin-only /access/users also lands on /login', async () => {
    stubFetch(null);
    await router.push('/');

    await router.push('/access/users');

    expect(router.currentRoute.value.name).toBe('login');
  });

  it('an authenticated non-admin deep-linking an adminOnly route is sent home', async () => {
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({ id: 'u1', isAdmin: false });
    await router.push('/');

    await router.push('/access/users');

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('an authenticated admin deep link passes through', async () => {
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({ id: 'u1', isAdmin: true });

    await router.push('/access/users');

    expect(router.currentRoute.value.name).toBe('multiuser-users');
  });

  // Regression for #25: the QR phone link is opened on a phone with no user
  // login. The phone-bridge route is public (it authenticates by the session
  // token in the URL), so an anonymous visitor must reach it, not the auth wall.
  // The path moved to /d/:token when the bridge was extracted from capture (#77).
  it('anonymous deep link to the QR phone-bridge route is NOT bounced to /login', async () => {
    stubFetch(null);

    await router.push('/d/some-session-token');

    expect(router.currentRoute.value.name).toBe('phoneBridge');
    expect(router.currentRoute.value.meta.public).toBe(true);
  });

  // Regression for the epic #197 breakage: a phone that had once been paired and
  // then revoked still held a device token, `apiFetch` attached it to every
  // request, and the first 401 threw the QR page — which needs no credential at
  // all — out to /login. The device credential now lives in its own storage
  // slot, so a session token is what the desktop carries and neither leaks into
  // the other's surface.
  it('a stale device token does not travel on the public phone-bridge page', async () => {
    stubFetch(null);
    localStorage.setItem('auth.deviceToken', 'revoked-device-token');

    await router.push('/d/another-session-token');

    expect(router.currentRoute.value.name).toBe('phoneBridge');
    // The session slot is what a logged-out visitor has, and it is empty — the
    // dead device token is not promoted into it.
    expect(localStorage.getItem('auth.token')).toBeNull();
  });

  // Regression for #207, reported from a phone: the installed PWA launches at
  // its start_url `/m` with no device token — an installed app does not always
  // inherit the storage of the tab it was installed from — and the guard threw
  // it to the DESKTOP login form, which then landed the person in the desktop
  // app. A phone that lost its credential goes to pairing, which is a screen it
  // can actually finish, and from there to its own password wall.
  it('an installed PWA launching anonymously at /m lands on pairing, not /login', async () => {
    stubFetch(null);

    await router.push('/m');

    expect(router.currentRoute.value.name).toBe('mobile-pair');
  });

  it('the phone password wall is reachable anonymously and stays inside the shell', async () => {
    stubFetch(null);

    await router.push('/m/login');

    expect(router.currentRoute.value.name).toBe('mobile-login');
    // Rendered by the mobile shell, so signing in returns to the phone surface.
    expect(router.currentRoute.value.matched[0].name).toBe('mobile');
  });

  it('a signed-in phone has nothing left to do on the password wall', async () => {
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({ id: 'u1', isAdmin: false });
    await router.push('/');

    await router.push('/m/login');

    expect(router.currentRoute.value.path).toBe('/m');
  });

  // The password wall is the FALLBACK: it must not foreclose the preferred way
  // back in. A phone that signed in holds a session and no device token, and
  // pairing is exactly where it goes to get one — so an authenticated visitor
  // is not bounced off it, with or without a code in the query.
  it('a signed-in phone may still open pairing to earn a device token', async () => {
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({ id: 'u1', isAdmin: false });
    await router.push('/');

    await router.push('/m/pair');

    expect(router.currentRoute.value.name).toBe('mobile-pair');
  });

  it('and an authenticated desktop scanning a pairing QR still redeems it', async () => {
    // Adding a second phone from a browser that is already signed in is the
    // ordinary case — the code in the query is what says "this is a pairing".
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({ id: 'u1', isAdmin: true });
    await router.push('/');

    await router.push('/m/pair?code=ONE-TIME');

    expect(router.currentRoute.value.name).toBe('mobile-pair');
  });
});

// Single-user mode: the same route table, none of the auth. The phone's sign-in
// screen exists as a route regardless (routes are static), but there are no
// passwords to type into it — its form is a multiuser contribution, and the
// screen would stand empty. #207 asked for a fallback, not a dead end.
describe('router guard — phone sign-in with multi-user mode off', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // 404 is how the mode announces itself as off: the auth endpoints
        // belong to the multiuser plugin, and a disabled plugin has no routes.
        if (url.includes('/api/auth/status')) {
          return { ok: false, status: 404 } as Response;
        }
        if (url.includes('/api/plugins')) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the phone password wall to pairing instead', async () => {
    await router.push('/m/login');

    expect(router.currentRoute.value.name).toBe('mobile-pair');
  });
});

// Hub layouts (#110): a hub's tabs are CHILD routes of its layout record, so
// the tab bar stays mounted on every tab — including a tab contributed by
// another plugin, which the shell nests via `meta.hub` (no cross-plugin import).
describe('router — hub layout nesting', () => {
  it("nests the settings plugin's own tabs under the hub layout", () => {
    const agent = router.resolve('/settings/agent');

    expect(agent.name).toBe('settings-agent');
    expect(agent.matched.map((r) => r.name)).toEqual([
      'hub-settings',
      'settings-agent',
    ]);
    expect(agent.meta.adminOnly).toBe(true);
    // Merged from the layout record, so the disabled-plugin guard still applies.
    expect(agent.meta.pluginId).toBe('settings');
  });

  it("nests the exchange plugin's guest tab under the same hub layout", () => {
    const exchange = router.resolve('/settings/exchange');

    expect(exchange.name).toBe('exchange');
    expect(exchange.matched.map((r) => r.name)).toEqual([
      'hub-settings',
      'exchange',
    ]);
    // Its own plugin id survives nesting — disabling exchange still hides it.
    expect(exchange.meta.pluginId).toBe('exchange');
  });

  it('resolves the Access hub tabs under their container layout', () => {
    const sharing = router.resolve('/access/sharing');

    expect(sharing.name).toBe('multiuser-sharing');
    expect(sharing.matched.map((r) => r.name)).toEqual([
      'hub-access',
      'multiuser-sharing',
    ]);
  });
});
