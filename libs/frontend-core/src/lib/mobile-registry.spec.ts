import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import {
  getMobileNav,
  getMobileRoutes,
  registerPlugin,
  type NavVisibility,
} from './registry';

const Stub = defineComponent({ template: '<div />' });

const visibility = (over: Partial<NavVisibility> = {}): NavVisibility => ({
  isPluginEnabled: () => true,
  multiuserEnabled: false,
  isAdmin: false,
  simpleMode: false,
  isFeatureVisible: () => true,
  ...over,
});

registerPlugin({
  id: 'mob-a',
  nameKey: 'plugins.mob-a.name',
  navigation: [],
  routes: [],
  messages: {},
  mobileNavigation: [
    { path: '/m/a', titleKey: 'nav.a', icon: 'Box', order: 20 },
  ],
  mobileRoutes: [{ path: '/m/a', name: 'm-a', component: Stub }],
});

registerPlugin({
  id: 'mob-b',
  nameKey: 'plugins.mob-b.name',
  navigation: [],
  routes: [],
  messages: {},
  mobileNavigation: [
    { path: '/m/b', titleKey: 'nav.b', icon: 'Box', order: 10 },
    {
      path: '/m/b-admin',
      titleKey: 'nav.bAdmin',
      icon: 'Box',
      adminOnly: true,
    },
  ],
  mobileRoutes: [{ path: '/m/b', name: 'm-b', component: Stub }],
});

const paths = (items: { path: string }[]): string[] => items.map((i) => i.path);

describe('getMobileNav', () => {
  it('orders tabs by weight and tags them with their plugin id', () => {
    const nav = getMobileNav(visibility());
    expect(paths(nav)).toEqual(['/m/b', '/m/a', '/m/b-admin']);
    expect(nav[1]).toMatchObject({ pluginId: 'mob-a' });
  });

  it('drops the tabs of a disabled plugin', () => {
    const nav = getMobileNav(
      visibility({ isPluginEnabled: (id) => id !== 'mob-b' }),
    );
    expect(paths(nav)).toEqual(['/m/a']);
  });

  it('hides adminOnly tabs from non-admins only while multiuser is on', () => {
    expect(paths(getMobileNav(visibility({ multiuserEnabled: true })))).toEqual(
      ['/m/b', '/m/a'],
    );
    expect(
      paths(
        getMobileNav(visibility({ multiuserEnabled: true, isAdmin: true })),
      ),
    ).toContain('/m/b-admin');
  });

  it('ignores simple mode — the mobile surface is a device, not a UX lens', () => {
    expect(paths(getMobileNav(visibility({ simpleMode: true })))).toEqual([
      '/m/b',
      '/m/a',
      '/m/b-admin',
    ]);
  });
});

describe('getMobileRoutes', () => {
  it('collects mobile routes across plugins, stamped with their owner', () => {
    const routes = getMobileRoutes();
    expect(paths(routes)).toEqual(expect.arrayContaining(['/m/a', '/m/b']));
    const a = routes.find((r) => r.path === '/m/a');
    expect(a?.meta).toMatchObject({ pluginId: 'mob-a' });
  });
});
