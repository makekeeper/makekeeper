import { describe, expect, it } from 'vitest';
import type { PluginNavItem } from '@makekeeper/plugin-contract';
import {
  getHubTabs,
  getSidebarNav,
  isNavItemVisible,
  isNavPathActive,
  registerPlugin,
  resolveActiveTab,
  type NavVisibility,
  type RegisteredNavItem,
} from './registry';

// Navigation hubs (#110): one sidebar entry per hub, sub-sections as tabs, all
// filtered by ONE visibility rule shared with the sidebar. The tab set is
// assembled across plugins — `guest` contributes a tab into `owner`'s hub
// without either knowing the other.
const nav = (item: PluginNavItem): PluginNavItem => item;

registerPlugin({
  id: 'owner',
  nameKey: 'plugins.owner.name',
  routes: [],
  messages: {},
  navigation: [
    nav({
      path: '/hub',
      titleKey: 'nav.hub',
      icon: 'Box',
      section: 'system',
      hubId: 'hub',
    }),
    nav({
      path: '/hub',
      titleKey: 'nav.hubMain',
      icon: 'Box',
      hub: 'hub',
      order: 0,
    }),
    nav({
      path: '/hub/admin',
      titleKey: 'nav.hubAdmin',
      icon: 'Box',
      hub: 'hub',
      order: 10,
      adminOnly: true,
    }),
    nav({ path: '/plain', titleKey: 'nav.plain', icon: 'Box' }),
  ],
});

registerPlugin({
  id: 'guest',
  nameKey: 'plugins.guest.name',
  routes: [],
  messages: {},
  navigation: [
    nav({
      path: '/hub/guest',
      titleKey: 'nav.hubGuest',
      icon: 'Box',
      hub: 'hub',
      order: 100,
      advanced: true,
    }),
    // A tab of a hub nobody registered — silently dropped, never a sidebar entry.
    nav({
      path: '/nowhere',
      titleKey: 'nav.nowhere',
      icon: 'Box',
      hub: 'ghost',
    }),
  ],
});

registerPlugin({
  id: 'lonely',
  nameKey: 'plugins.lonely.name',
  routes: [],
  messages: {},
  navigation: [
    nav({
      path: '/lonely',
      titleKey: 'nav.lonely',
      icon: 'Box',
      section: 'system',
      hubId: 'lonely',
    }),
    nav({
      path: '/lonely/x',
      titleKey: 'nav.lonelyX',
      icon: 'Box',
      hub: 'lonely',
      adminOnly: true,
    }),
  ],
});

registerPlugin({
  id: 'ordered',
  nameKey: 'plugins.ordered.name',
  routes: [],
  messages: {},
  navigation: [
    nav({
      path: '/ordered',
      titleKey: 'nav.ordered',
      icon: 'Box',
      hubId: 'ordered',
    }),
    // No `order` declared: sorts after every tab that declares one, rather than
    // silently joining the guest band at 100.
    nav({
      path: '/ordered/last',
      titleKey: 'nav.orderedLast',
      icon: 'Box',
      hub: 'ordered',
    }),
    nav({
      path: '/ordered/guest',
      titleKey: 'nav.orderedGuest',
      icon: 'Box',
      hub: 'ordered',
      order: 100,
    }),
    nav({
      path: '/ordered/own',
      titleKey: 'nav.orderedOwn',
      icon: 'Box',
      hub: 'ordered',
      order: 0,
    }),
  ],
});

const ctx = (overrides: Partial<NavVisibility> = {}): NavVisibility => ({
  isPluginEnabled: () => true,
  multiuserEnabled: false,
  isAdmin: false,
  simpleMode: false,
  // The live rule returns true outside simple mode; keyed entries in these
  // tests pass their own function when the answer matters.
  isFeatureVisible: () => true,
  ...overrides,
});

const paths = (items: RegisteredNavItem[]): string[] =>
  items.map((item) => item.path);

describe('isNavItemVisible', () => {
  const item: RegisteredNavItem = {
    path: '/x',
    titleKey: 'nav.x',
    icon: 'Box',
    pluginId: 'p',
  };

  it('hides an entry of a disabled plugin', () => {
    expect(isNavItemVisible(item, ctx({ isPluginEnabled: () => false }))).toBe(
      false,
    );
  });

  it('hides a bare advanced entry in simple mode only', () => {
    const advanced = { ...item, advanced: true };
    expect(isNavItemVisible(advanced, ctx({ simpleMode: true }))).toBe(false);
    expect(isNavItemVisible(advanced, ctx())).toBe(true);
  });

  // #269: an advanced entry naming its feature key follows the per-feature
  // rule (which already encapsulates the mode and the user's override) — so
  // the settings toggle can bring a hidden page back in simple mode.
  it('an advanced entry keyed to a feature follows the feature, not the mode', () => {
    const keyed = { ...item, advanced: true, uxFeatureKey: 'p.page' };
    expect(
      isNavItemVisible(
        keyed,
        ctx({ simpleMode: true, isFeatureVisible: (k) => k === 'p.page' }),
      ),
    ).toBe(true);
    expect(
      isNavItemVisible(
        keyed,
        ctx({ simpleMode: true, isFeatureVisible: () => false }),
      ),
    ).toBe(false);
  });

  it('applies adminOnly only while multi-user mode is on', () => {
    const adminOnly = { ...item, adminOnly: true };
    expect(isNavItemVisible(adminOnly, ctx())).toBe(true);
    expect(isNavItemVisible(adminOnly, ctx({ multiuserEnabled: true }))).toBe(
      false,
    );
    expect(
      isNavItemVisible(
        adminOnly,
        ctx({ multiuserEnabled: true, isAdmin: true }),
      ),
    ).toBe(true);
  });
});

describe('getHubTabs', () => {
  it('collects the hub tabs across plugins, sorted by order', () => {
    expect(paths(getHubTabs('hub', ctx()))).toEqual([
      '/hub',
      '/hub/admin',
      '/hub/guest',
    ]);
  });

  it('drops tabs the current user may not see (role, UX mode, enabled)', () => {
    expect(paths(getHubTabs('hub', ctx({ multiuserEnabled: true })))).toEqual([
      '/hub',
      '/hub/guest',
    ]);
    expect(paths(getHubTabs('hub', ctx({ simpleMode: true })))).toEqual([
      '/hub',
      '/hub/admin',
    ]);
    expect(
      paths(
        getHubTabs('hub', ctx({ isPluginEnabled: (id) => id !== 'guest' })),
      ),
    ).toEqual(['/hub', '/hub/admin']);
  });

  it('returns nothing for an unknown hub', () => {
    expect(getHubTabs('does-not-exist', ctx())).toEqual([]);
  });

  it('sorts an order-less tab last, not into the guest band', () => {
    expect(paths(getHubTabs('ordered', ctx()))).toEqual([
      '/ordered/own',
      '/ordered/guest',
      '/ordered/last',
    ]);
  });
});

describe('getSidebarNav', () => {
  it('renders hubs and plain items, never tabs', () => {
    expect(paths(getSidebarNav(ctx()))).toEqual([
      '/hub',
      '/plain',
      '/lonely',
      '/ordered',
    ]);
  });

  it('hides a hub whose every tab is invisible to this user', () => {
    // `lonely`'s only tab is admin-only, so a regular user in multi-user mode
    // gets no sidebar entry for it at all (it would lead nowhere).
    expect(paths(getSidebarNav(ctx({ multiuserEnabled: true })))).toEqual([
      '/hub',
      '/plain',
      '/ordered',
    ]);
  });
});

// The bug #110 was raised for: on `/settings/agent` the prefix-based sidebar
// rule lit both `/settings` and `/settings/agent`, because the sub-page was a
// sidebar entry of its own. The prefix rule has to stay (drill-downs keep their
// section lit), so the fix is that a hub's tabs are not sidebar entries — which
// is what these assertions pin down.
describe('sidebar highlighting on a hub sub-path', () => {
  const activeEntries = (routePath: string, c = ctx()): string[] =>
    paths(getSidebarNav(c)).filter((path) => isNavPathActive(routePath, path));

  it('lights exactly one entry while inside a hub', () => {
    expect(activeEntries('/hub/admin')).toEqual(['/hub']);
    expect(activeEntries('/hub')).toEqual(['/hub']);
  });

  it('keeps a plain section lit when drilling into a detail view', () => {
    expect(activeEntries('/plain/123')).toEqual(['/plain']);
  });

  it('does not light a sibling whose path is a string prefix', () => {
    expect(isNavPathActive('/plainX', '/plain')).toBe(false);
  });
});

// The phone shell's bottom bar. `/m` is Home and is a prefix of every other
// mobile path, which is why the fallback is "longest match", not "first match".
describe('mobile tab highlighting', () => {
  const TABS = ['/m', '/m/inventory', '/m/inventory/stock'] as const;

  it('lights Home only at the mobile root', () => {
    expect(resolveActiveTab('/m', null, TABS)).toBe('/m');
  });

  it('prefers the longest matching tab over the root', () => {
    expect(resolveActiveTab('/m/inventory', null, TABS)).toBe('/m/inventory');
    expect(resolveActiveTab('/m/inventory/stock', null, TABS)).toBe(
      '/m/inventory/stock',
    );
  });

  it('keeps a tab lit while a screen drills into it', () => {
    expect(resolveActiveTab('/m/inventory/drafts', null, TABS)).toBe(
      '/m/inventory',
    );
  });

  // The reported bug: the part detail is opened from Stock but spelled under
  // intake, so the prefix rule lit the wrong tab. The declaration overrides it.
  it('lights the DECLARED tab, not the one the path nests under', () => {
    expect(resolveActiveTab('/m/inventory/item/abc', null, TABS)).toBe(
      '/m/inventory',
    );
    expect(
      resolveActiveTab('/m/inventory/item/abc', '/m/inventory/stock', TABS),
    ).toBe('/m/inventory/stock');
  });

  it('lights nothing outside the tab set', () => {
    expect(resolveActiveTab('/inventory', null, TABS)).toBe(null);
  });
});
