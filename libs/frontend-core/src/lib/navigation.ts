import { computed, watch, type ComputedRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  getNavBadge,
  getHubTabs,
  getMobileNav,
  pluginRegistryVersion,
  getSidebarNav,
  type NavVisibility,
  type RegisteredMobileNavItem,
  type RegisteredNavItem,
} from './registry';
import { usePluginsStore } from './plugins-store';
import { useSessionStore } from './session-store';
import { usePreferencesStore } from './preferences-store';

// The live visibility context (#110): plugin enablement, multiuser role and the
// simple/advanced UX lens. Built here — outside registry.ts — because the
// plugins store already imports the registry (same cycle-avoidance as
// `useSlotContributions`). Every navigation surface goes through this, so the
// sidebar and the hub tab bars can never drift apart.
function useNavVisibility(): ComputedRef<NavVisibility> {
  const plugins = usePluginsStore();
  const session = useSessionStore();
  const prefs = usePreferencesStore();
  return computed<NavVisibility>(() => ({
    isPluginEnabled: (pluginId) => plugins.isEnabled(pluginId),
    multiuserEnabled: session.multiuserEnabled,
    isAdmin: session.isAdmin,
    simpleMode: prefs.isSimpleModeActive,
    isFeatureVisible: (key) => prefs.isFeatureVisible(key),
  }));
}

// Sidebar entries the current user may see: plain items and tabbed hubs, never
// a hub's tabs (those render inside the hub) and never a hub with no visible tab.
export function useSidebarNav(): ComputedRef<RegisteredNavItem[]> {
  const visibility = useNavVisibility();
  return computed(() => {
    // Depend on the registry version so an external plugin enabled or removed
    // at runtime updates the sidebar without a page reload (#150).
    void pluginRegistryVersion.value;
    return getSidebarNav(visibility.value);
  });
}

// Badge counts for sidebar entries (#307), as a function the template calls per
// entry. Reactive on two axes: the registry version (a source registered late,
// a plugin toggled) and whatever store the source itself reads.
export function useNavBadges(): ComputedRef<
  (item: RegisteredNavItem) => number
> {
  const plugins = usePluginsStore();
  return computed(() => {
    void pluginRegistryVersion.value;
    return (item: RegisteredNavItem) =>
      getNavBadge(item, (pluginId) => plugins.isEnabled(pluginId));
  });
}

// The visible tabs of one hub, for the hub layout's tab bar. Reactive to the
// same state as the sidebar — a tab appears/disappears the moment its plugin is
// toggled, the role changes or the UX mode flips.
export function useHubTabs(hubId: string): ComputedRef<RegisteredNavItem[]> {
  const visibility = useNavVisibility();
  return computed(() => {
    void pluginRegistryVersion.value;
    return getHubTabs(hubId, visibility.value);
  });
}

// The visible tabs of the mobile shell's bottom bar (#198), reactive to the same
// plugin/role state as the sidebar.
export function useMobileNav(): ComputedRef<RegisteredMobileNavItem[]> {
  const visibility = useNavVisibility();
  return computed(() => {
    void pluginRegistryVersion.value;
    return getMobileNav(visibility.value);
  });
}

// Where a hub sends a user who may see none of its tabs. The sidebar already
// hides such a hub, but the route stays reachable by deep link (`/access` for a
// user in a READ-shared scope) and would otherwise render an empty tab bar over
// an empty view — a blank page.
const HUB_FALLBACK_PATH = '/';

// A hub landed on at its own root: send the user to the first tab they may see,
// so the landing tab follows the role (admin → Users, regular user → Sharing).
// Inert for a hub whose main tab IS the hub root (Settings → General), so every
// hub can wire it unconditionally. `replace`, never `push` — with `push` the
// Back button bounces straight off the redirect and the user is trapped.
export function useHubRedirect(
  hubPath: string,
  tabs: ComputedRef<RegisteredNavItem[]>,
): void {
  const route = useRoute();
  const router = useRouter();
  watch(
    () => [route.path, tabs.value] as const,
    ([path, visible]) => {
      if (path !== hubPath) return;
      const first = visible[0];
      if (first === undefined) {
        router.replace(HUB_FALLBACK_PATH);
        return;
      }
      if (first.path !== hubPath) router.replace(first.path);
    },
    { immediate: true },
  );
}
