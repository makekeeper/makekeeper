import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { Select, SectionNav, useToastStore } from '@makekeeper/frontend-core';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import AgentCapabilitiesView from './AgentCapabilitiesView.vue';
import en from '../i18n/en.json';

// Self-contained test i18n: the settings plugin's own bundle plus the label
// keys the sample groups reference (other plugins' names aren't imported here).
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      ...en,
      plugins: {
        ...(en as Record<string, unknown>).plugins,
        storages: { name: 'Storages' },
        inventory: { name: 'Inventory' },
      },
    },
  },
});

const GROUPS = [
  {
    pluginId: 'storages',
    pluginLabelKey: 'plugins.storages.name',
    icon: 'Box',
    tools: [
      {
        name: 'list_storages',
        descriptionKey: 'storages.agentTools.list_storages.description',
        permission: 'READ',
        isEnabled: true,
        confirmationPolicy: 'AUTO',
      },
      {
        name: 'delete_storage_cell',
        descriptionKey: 'storages.agentTools.delete_storage_cell.description',
        permission: 'DESTRUCTIVE',
        isEnabled: true,
        confirmationPolicy: 'CONFIRM',
      },
    ],
  },
  {
    pluginId: 'inventory',
    pluginLabelKey: 'plugins.inventory.name',
    icon: 'Wrench',
    tools: [
      {
        name: 'update_component',
        descriptionKey: 'inventory.agentTools.update_component.description',
        permission: 'WRITE',
        isEnabled: true,
        // On, changes data, never asks — the fact the picker has to carry.
        confirmationPolicy: 'AUTO',
      },
    ],
  },
];

// The section is route state now (#265), so the page needs a real router —
// mounting without one takes the whole view down.
const render = async (
  path = '/settings/agent-capabilities',
): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> => {
  const pinia = createPinia();
  // The toast host is a store the view reaches for directly, so the test needs
  // the same active instance the mount uses.
  setActivePinia(pinia);
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:rest(.*)', component: AgentCapabilitiesView }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(AgentCapabilitiesView, {
    global: { plugins: [i18n, pinia, router] },
  });
  await flushPromises();
  return { wrapper, router };
};

describe('AgentCapabilitiesView (#265)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => JSON.parse(JSON.stringify(GROUPS)),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists every plugin in the picker and renders only the open one', async () => {
    const { wrapper } = await render();

    const nav = wrapper.findComponent(SectionNav);
    expect(nav.props('items').map((item) => item.key)).toEqual([
      'storages',
      'inventory',
    ]);

    // Default section is the first group: its tools, and nobody else's.
    expect(wrapper.text()).toContain('list_storages');
    expect(wrapper.text()).not.toContain('update_component');
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
  });

  it('opens the section named by the URL', async () => {
    const { wrapper } = await render(
      '/settings/agent-capabilities?section=inventory',
    );
    expect(wrapper.text()).toContain('update_component');
    expect(wrapper.text()).not.toContain('list_storages');
  });

  it('falls back to the default section rather than showing a blank pane', async () => {
    // A link to a plugin that is disabled, uninstalled, or simply misspelled:
    // there is no literal union to guard the key here, the sections are data.
    const { wrapper } = await render(
      '/settings/agent-capabilities?section=nope',
    );
    expect(wrapper.text()).toContain('list_storages');
    expect(wrapper.findComponent(SectionNav).props('activeKey')).toBe(
      'storages',
    );
  });

  it('counts auto-running write tools on the picker, with what it counts', async () => {
    const { wrapper } = await render();
    const items = wrapper.findComponent(SectionNav).props('items');
    // READ tools auto-run by design and are not what an admin audits.
    expect(items[0].badge).toBe(0);
    expect(items[1].badge).toBe(1);
    // Phrased so it reads at one as well as at five (this repo has no
    // pluralization runtime), and it says which tools are counted: READ runs
    // without asking by design, which is exactly what made a bare count
    // unreadable the day it shipped.
    expect(items[1].badgeLabel).toBe(
      'Tools that change data and run without asking: 1. READ tools always run without asking and are not counted.',
    );
  });

  it('uses the styled Select for the execution policy, not a native <select>', async () => {
    const { wrapper } = await render();

    // Native selectboxes are forbidden — every dropdown must be the shared
    // styled Select component (see the AgentCapabilitiesView memory note).
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.findComponent(Select).exists()).toBe(true);
  });

  it('saves a switched tool and re-counts the badge without a refetch', async () => {
    const { wrapper } = await render(
      '/settings/agent-capabilities?section=inventory',
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/settings/agent-tools/update_component');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body)).isEnabled).toBe(false);

    // Turned off, it no longer runs anything — the count has to follow.
    const items = wrapper.findComponent(SectionNav).props('items');
    expect(items[1].badge).toBe(0);
  });

  it('puts a refused change back and says so', async () => {
    // This page IS the record of what the agent may do: a switch left showing
    // a permission the backend refused is a lie, and the badge is counted from
    // those very values.
    const { wrapper } = await render(
      '/settings/agent-capabilities?section=inventory',
    );
    vi.mocked(fetch).mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: 'boom',
      json: async () => ({}),
    }));

    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();

    const items = wrapper.findComponent(SectionNav).props('items');
    expect(items[1].badge).toBe(1);
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe(
      'true',
    );
    expect(useToastStore().toasts.at(-1)?.message).toBe(
      en.settings.agentCapabilities.saveFailed,
    );
  });
});
