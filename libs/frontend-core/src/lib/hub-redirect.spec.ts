import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { computed, defineComponent, ref } from 'vue';
import { useHubRedirect } from './navigation';
import type { RegisteredNavItem } from './registry';

const view = defineComponent({ template: '<div />' });

const tab = (path: string): RegisteredNavItem => ({
  path,
  titleKey: `nav.${path}`,
  icon: 'Box',
  hub: 'access',
  pluginId: 'multiuser',
});

const makeRouter = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: view },
      { path: '/access', component: view },
      { path: '/access/users', component: view },
      { path: '/access/sharing', component: view },
    ],
  });

// A container hub has no content of its own, so landing on it must forward to
// the first tab the CURRENT user may see — role decides the landing tab (#110).
const mountHub = async (router: Router, visible: RegisteredNavItem[]) => {
  const tabs = ref(visible);
  const host = defineComponent({
    setup: () => {
      useHubRedirect(
        '/access',
        computed(() => tabs.value),
      );
      return () => null;
    },
  });
  mount(host, { global: { plugins: [router] } });
  await flushPromises();
  return tabs;
};

describe('useHubRedirect', () => {
  it('forwards the hub root to the first visible tab', async () => {
    const router = makeRouter();
    await router.push('/access');
    await mountHub(router, [tab('/access/users'), tab('/access/sharing')]);

    expect(router.currentRoute.value.path).toBe('/access/users');
  });

  it('lands a user without the first tab on the next one they may see', async () => {
    const router = makeRouter();
    await router.push('/access');
    await mountHub(router, [tab('/access/sharing')]);

    expect(router.currentRoute.value.path).toBe('/access/sharing');
  });

  it('replaces rather than pushes, so Back leaves the hub', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.push('/access');
    await mountHub(router, [tab('/access/users')]);
    expect(router.currentRoute.value.path).toBe('/access/users');

    router.back();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('leaves a hub whose main tab IS the hub root alone', async () => {
    const router = makeRouter();
    await router.push('/access');
    await mountHub(router, [tab('/access'), tab('/access/users')]);

    expect(router.currentRoute.value.path).toBe('/access');
  });

  it('sends a user who may see no tab away from the empty hub', async () => {
    // The sidebar already hides such a hub, but the route stays reachable by
    // deep link — without this it renders an empty tab bar over an empty view.
    const router = makeRouter();
    await router.push('/access');
    await mountHub(router, []);

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('leaves an already-open tab alone', async () => {
    const router = makeRouter();
    await router.push('/access/sharing');
    await mountHub(router, [tab('/access/users'), tab('/access/sharing')]);

    expect(router.currentRoute.value.path).toBe('/access/sharing');
  });
});
