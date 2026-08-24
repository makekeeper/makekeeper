import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import {
  registerPlugin,
  unregisterPlugin,
  usePreferencesStore,
  SectionNav,
} from '@makekeeper/frontend-core';
import SettingsView from './SettingsView.vue';
import en from '../i18n/en.json';

// The host renders panels other plugins register, so the test registers two of
// its own — that is exactly the contract: the section list is registry data.
const panelOf = (text: string) =>
  defineComponent({ render: () => h('p', text) });

const PANELS = [
  {
    id: 'logistics',
    nameKey: 'test.logistics.name',
    descriptionKey: 'test.logistics.description',
    body: 'logistics panel',
  },
  {
    id: 'phone-bridge',
    nameKey: 'test.phoneBridge.name',
    descriptionKey: 'test.phoneBridge.description',
    body: 'phone bridge panel',
  },
];

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      ...en,
      test: {
        logistics: { name: 'Logistics', description: 'Shipping' },
        phoneBridge: { name: 'Phone bridge', description: 'Tunnel' },
      },
    },
  },
});

const render = async (
  path = '/settings',
): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:rest(.*)', name: 'settings', component: SettingsView }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(SettingsView, {
    global: { plugins: [i18n, createPinia(), router] },
  });
  await flushPromises();
  return { wrapper, router };
};

describe('SettingsView (#266)', () => {
  beforeEach(() => {
    for (const panel of PANELS) {
      registerPlugin({
        id: panel.id,
        nameKey: panel.nameKey,
        settings: {
          descriptionKey: panel.descriptionKey,
          icon: 'Settings',
          version: '1.0.0',
          component: panelOf(panel.body),
        },
      });
    }
  });

  afterEach(() => {
    for (const panel of PANELS) unregisterPlugin(panel.id);
  });

  it('lists every registered panel and renders only the open one', async () => {
    const { wrapper } = await render();
    const nav = wrapper.findComponent(SectionNav);
    expect(nav.props('items').map((item) => item.key)).toEqual([
      'logistics',
      'phone-bridge',
    ]);
    expect(wrapper.text()).toContain('logistics panel');
    expect(wrapper.text()).not.toContain('phone bridge panel');
  });

  it('opens the section named by the query', async () => {
    const { wrapper } = await render('/settings?section=phone-bridge');
    expect(wrapper.text()).toContain('phone bridge panel');
    expect(wrapper.text()).not.toContain('logistics panel');
  });

  it('falls back to the default rather than leaving a blank pane', async () => {
    // Also the answer for a panel this user is not allowed to see: never a
    // blank pane, and never a hint that the panel exists.
    const { wrapper } = await render('/settings?section=nope');
    expect(wrapper.text()).toContain('logistics panel');
    expect(wrapper.findComponent(SectionNav).props('activeKey')).toBe(
      'logistics',
    );
  });

  it('redirects the old #settings-<id> deep link onto its section', async () => {
    const { wrapper, router } = await render('/settings#settings-phone-bridge');
    await flushPromises();
    expect(router.currentRoute.value.query['section']).toBe('phone-bridge');
    expect(router.currentRoute.value.hash).toBe('');
    expect(wrapper.text()).toContain('phone bridge panel');
  });

  it('redirects a legacy hash arriving while the page is already open', async () => {
    // The watch is what catches a pasted old URL on a page that never
    // remounts — and it must settle, not bounce: the redirect drops the hash,
    // which is what stops it firing again.
    const { router } = await render();
    await router.push('/settings#settings-phone-bridge');
    await flushPromises();
    expect(router.currentRoute.value.query['section']).toBe('phone-bridge');
    expect(router.currentRoute.value.hash).toBe('');
  });

  // The API section (#282) is the host's own, not a registered panel, and it
  // sits at the pro tier: scripting the instance is depth, so simple mode
  // leaves it out and the `settings.api` toggle brings it back.
  it('keeps the API section out of the picker in simple mode', async () => {
    const { wrapper } = await render();
    expect(
      wrapper
        .findComponent(SectionNav)
        .props('items')
        .map((item) => item.key),
    ).not.toContain('api');
    expect(wrapper.text()).not.toContain(en.settings.api.endpoint.title);
  });

  it('offers the API section in pro mode and opens it from the query', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    usePreferencesStore().setMode('advanced');
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/:rest(.*)', name: 'settings', component: SettingsView },
      ],
    });
    await router.push('/settings?section=api');
    await router.isReady();
    const wrapper = mount(SettingsView, {
      global: {
        plugins: [i18n, pinia, router],
        stubs: { ApiSection: { template: '<p>api section</p>' } },
      },
    });
    await flushPromises();
    expect(
      wrapper
        .findComponent(SectionNav)
        .props('items')
        .map((item) => item.key),
    ).toContain('api');
    expect(wrapper.text()).toContain('api section');
  });

  it('shows the plugin version in the section header, not on the picker', async () => {
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('v1.0.0');
    expect(wrapper.findComponent(SectionNav).text()).not.toContain('v1.0.0');
  });
});
