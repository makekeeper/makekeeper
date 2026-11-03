import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { Select } from '@makekeeper/frontend-core';
import LogisticsView from './LogisticsView.vue';
import en from '../i18n/en.json';

// Unresolved core keys render as their key; the spec asserts the URL, never
// the copy, so the plugin's own bundle is enough.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

const project = {
  id: 'p1',
  title: 'Robot arm',
  budgetPlanned: null,
  budgetCurrency: null,
};

async function makeRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/logistics', component: { render: () => null } }],
  });
  await router.push('/logistics?keep=1');
  await router.isReady();
  return router;
}

async function mountView(router: Router): Promise<VueWrapper> {
  const wrapper = mount(LogisticsView, {
    global: { plugins: [i18n, router] },
  });
  // The filter bar renders once the initial fetches settle.
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  // The filter bar is an advanced surface.
  localStorage.setItem('uxMode', 'advanced');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const body = /\/api\/projects(\?|$)/.test(String(input)) ? [project] : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
});

// #375: every filter used to build its replace from the same not-yet-replaced
// `route.query`, so two filters changed in one tick kept only the last one.
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('LogisticsView filters', () => {
  it('keeps every filter changed in the same tick', async () => {
    const router = await makeRouter();
    const wrapper = await mountView(router);
    const [status, projectPicker] = wrapper.findAllComponents(Select);

    // No await in between: all three writes happen in one tick.
    void wrapper.find('input[type="search"]').setValue('dhl');
    status.vm.$emit('update:modelValue', 'SHIPPED');
    projectPicker.vm.$emit('update:modelValue', 'p1');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({
      keep: '1',
      q: 'dhl',
      status: 'SHIPPED',
      project: 'p1',
    });
  });

  it('drops a filter key when it is cleared', async () => {
    const router = await makeRouter();
    await router.replace('/logistics?keep=1&status=SHIPPED&project=p1');
    const wrapper = await mountView(router);
    const [status, projectPicker] = wrapper.findAllComponents(Select);

    status.vm.$emit('update:modelValue', '');
    projectPicker.vm.$emit('update:modelValue', '');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
  });
});
