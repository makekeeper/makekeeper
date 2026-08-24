import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import router from './index';

// Regression: vue-router starts the initial navigation at `app.use(router)`,
// before the session bootstrap in main.ts resolves. The guard used to read the
// not-yet-loaded session state (multiuser looked off), so a direct link opened
// any section without ever hitting the /login wall. The guard must await the
// bootstrap probe before judging the navigation.
describe('router guard — deep link vs. session bootstrap race', () => {
  const view = { template: '<div />' };

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    if (!router.hasRoute('test-login')) {
      router.addRoute({
        path: '/login',
        name: 'test-login',
        meta: { public: true },
        component: view,
      });
      router.addRoute({
        path: '/settings/plugins',
        name: 'test-plugins-admin',
        component: view,
      });
      // Distinct target per test — pushing the route the singleton router is
      // already on would short-circuit as a duplicate navigation.
      router.addRoute({
        path: '/projects',
        name: 'test-projects',
        component: view,
      });
    }
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (status: {
    enabled: boolean;
    user: { id: string; username: string; isAdmin: boolean } | null;
  }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/auth/status')) {
          if (!status.enabled) {
            return { ok: false, status: 404 } as Response;
          }
          return {
            ok: true,
            json: async () => ({
              enabled: true,
              hasUsers: true,
              configOk: true,
              registrationAllowed: true,
              user: status.user,
              scopes: status.user
                ? [{ scopeId: status.user.id, accessLevel: 'OWNER' }]
                : [],
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

  it('redirects an anonymous deep link to /login while the mode is on', async () => {
    stubFetch({ enabled: true, user: null });

    await router.push('/settings/plugins');

    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('lets an authenticated deep link through', async () => {
    localStorage.setItem('auth.token', 'jwt-token');
    stubFetch({
      enabled: true,
      user: { id: 'u1', username: 'ivan', isAdmin: true },
    });

    await router.push('/projects');

    expect(router.currentRoute.value.path).toBe('/projects');
  });

  it('leaves deep links untouched while the mode is off', async () => {
    stubFetch({ enabled: false, user: null });

    await router.push('/settings/plugins');

    expect(router.currentRoute.value.path).toBe('/settings/plugins');
  });
});
