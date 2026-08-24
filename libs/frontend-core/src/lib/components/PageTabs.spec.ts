import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import PageTabs from './PageTabs.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: { nav: { general: 'General', agent: 'Agent', deep: 'Deep' } },
  },
});

const view = defineComponent({ template: '<div />' });

const makeRouter = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings', component: view },
      { path: '/settings/agent', component: view },
      { path: '/settings/agent/detail', component: view },
    ],
  });

const tabs = [
  { path: '/settings', titleKey: 'nav.general', icon: 'Settings' },
  { path: '/settings/agent', titleKey: 'nav.agent', icon: 'Bot' },
];

const mountTabs = async (path: string) => {
  const router = makeRouter();
  await router.push(path);
  await router.isReady();
  return mount(PageTabs, {
    props: { tabs, ariaLabel: 'Settings' },
    global: { plugins: [router, i18n] },
  });
};

// The active tab is the LONGEST matching path — without that rule the hub's own
// root tab (`/settings`) would stay lit on every sub-path, which is the
// double-highlight bug hubs exist to fix (#110).
describe('PageTabs', () => {
  it('renders one link per tab with its resolved label', async () => {
    const wrapper = await mountTabs('/settings');
    const links = wrapper.findAll('a');
    expect(links).toHaveLength(2);
    expect(links[0].text()).toBe('General');
    expect(links[1].text()).toBe('Agent');
  });

  it('marks exactly the root tab active on the hub root', async () => {
    const wrapper = await mountTabs('/settings');
    const current = wrapper
      .findAll('a')
      .map((a) => a.attributes('aria-current'));
    expect(current).toEqual(['page', undefined]);
  });

  it('marks exactly the sub-tab active on a sub-path', async () => {
    const wrapper = await mountTabs('/settings/agent');
    const current = wrapper
      .findAll('a')
      .map((a) => a.attributes('aria-current'));
    expect(current).toEqual([undefined, 'page']);
  });

  it('keeps a tab lit while the user drills into it', async () => {
    const wrapper = await mountTabs('/settings/agent/detail');
    const current = wrapper
      .findAll('a')
      .map((a) => a.attributes('aria-current'));
    expect(current).toEqual([undefined, 'page']);
  });
});
