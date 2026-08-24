import type { ExternalShellPlugin } from '../external-types';

// Mounting and UNMOUNTING at runtime (#150).
//
// The bug this covers: an approved plugin only appeared after a manual page
// reload, and a disabled one kept its sidebar entry and its routes until the
// next one. Both halves are asserted here, plus the route removal — a route
// that outlives its plugin navigates to a screen the core can no longer proxy.
//
// The dependencies are mocked rather than loaded because this project runs on
// Jest with no Vue transform: the point of the spec is the mount/unmount
// bookkeeping, not the components it hands to the registry.

const registered: string[] = [];
const registrations: Array<{
  id: string;
  navigation: Array<{ path: string }>;
}> = [];
const unregistered: string[] = [];
const shell = jest.fn<Promise<ExternalShellPlugin[]>, []>();

jest.mock(
  '@makekeeper/frontend-core',
  () => ({
    registerPlugin: (p: {
      id: string;
      navigation: Array<{ path: string }>;
    }): void => {
      registered.push(p.id);
      registrations.push(p);
    },
    unregisterPlugin: (id: string): void => {
      unregistered.push(id);
    },
    useRealtime: () => ({ on: (): void => undefined }),
  }),
  { virtual: true },
);
jest.mock('./external-data', () => ({ fetchExternalShell: () => shell() }));
jest.mock('./ExternalRouteView.vue', () => ({}), { virtual: true });
jest.mock('./ExternalScreen.vue', () => ({}), { virtual: true });
jest.mock(
  'vue',
  () => ({ defineComponent: (c: unknown) => c, h: () => null }),
  {
    virtual: true,
  },
);

const plugin = (pluginId: string, version = '1.0.0'): ExternalShellPlugin =>
  ({
    pluginId,
    version,
    nameKey: 'name',
    icon: 'Blocks',
    screens: ['home'],
    nav: [{ screen: 'home', titleKey: 'name', icon: 'Blocks' }],
    widgets: [],
    slots: [],
    uxFeatures: [],
    objectRefs: [],
    i18n: { en: { name: 'Demo' } },
  }) as unknown as ExternalShellPlugin;

const routes: Array<{ path: string; name?: string }> = [];
const removers: jest.Mock[] = [];
const router = {
  hasRoute: () => false,
  addRoute: (route: { path: string; name?: string }) => {
    routes.push(route);
    const remove = jest.fn();
    removers.push(remove);
    return remove;
  },
} as never;
const i18n = { global: { mergeLocaleMessage: (): void => undefined } } as never;

describe('external plugin mounting', () => {
  beforeEach(() => {
    // Each test gets a fresh module: the mounted-set and the remembered host
    // are module state by design, and sharing them across tests would let one
    // test's mounting decide the next one's.
    jest.resetModules();
    registered.length = 0;
    registrations.length = 0;
    unregistered.length = 0;
    removers.length = 0;
    routes.length = 0;
  });

  it('mounts a newly approved plugin without a page reload', async () => {
    const { bootstrapExternalPlugins, refreshExternalPlugins } = await import(
      './external-bootstrap'
    );
    shell.mockResolvedValue([]);
    await bootstrapExternalPlugins(router, i18n);
    expect(registered).toEqual([]);

    shell.mockResolvedValue([plugin('demo')]);
    await refreshExternalPlugins();
    expect(registered).toEqual(['demo']);
    // …and a second refresh with the same shell must not re-register it.
    await refreshExternalPlugins();
    expect(registered).toEqual(['demo']);
  });

  it('unmounts a disabled plugin, routes included', async () => {
    const { bootstrapExternalPlugins, refreshExternalPlugins } = await import(
      './external-bootstrap'
    );
    shell.mockResolvedValue([plugin('demo')]);
    await bootstrapExternalPlugins(router, i18n);
    const removed = [...removers];
    expect(removed.length).toBeGreaterThan(0);

    shell.mockResolvedValue([]);
    await refreshExternalPlugins();
    expect(unregistered).toEqual(['demo']);
    for (const remove of removed) expect(remove).toHaveBeenCalled();
  });

  it('remounts a plugin whose manifest version changed', async () => {
    const { bootstrapExternalPlugins, refreshExternalPlugins } = await import(
      './external-bootstrap'
    );
    shell.mockResolvedValue([plugin('demo', '1.0.0')]);
    await bootstrapExternalPlugins(router, i18n);
    registered.length = 0;

    shell.mockResolvedValue([plugin('demo', '1.1.0')]);
    await refreshExternalPlugins();
    expect(unregistered).toEqual(['demo']);
    expect(registered).toEqual(['demo']);
  });

  it('keeps a settings screen out of the nav but reachable by route', () => {
    // The card in Settings -> External plugins hosts it; a `navigate` command
    // from the plugin still needs somewhere to land, so the route stays.
    return (async () => {
      const { bootstrapExternalPlugins } = await import('./external-bootstrap');
      shell.mockResolvedValue([
        {
          ...plugin('demo'),
          settingsScreen: 'config',
          screens: ['home', 'config'],
        },
      ]);
      await bootstrapExternalPlugins(router, i18n);

      const nav = registrations[0]?.navigation ?? [];
      expect(nav.some((item) => item.path.includes('config'))).toBe(false);
      expect(routes.some((route) => route.path === '/x/demo/config')).toBe(
        true,
      );
    })();
  });

  it('keeps what is mounted when the shell cannot be read', async () => {
    const { bootstrapExternalPlugins, refreshExternalPlugins } = await import(
      './external-bootstrap'
    );
    shell.mockResolvedValue([plugin('demo')]);
    await bootstrapExternalPlugins(router, i18n);

    shell.mockRejectedValue(new Error('offline'));
    await refreshExternalPlugins();
    // A flaky request must not blank the sidebar.
    expect(unregistered).toEqual([]);
  });
});
