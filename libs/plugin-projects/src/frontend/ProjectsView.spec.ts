import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { Select } from '@makekeeper/frontend-core';
import ProjectsView from './ProjectsView.vue';
import en from '../i18n/en.json';

// The spec asserts the URL, never the copy, so the plugin's own bundle is
// enough; unresolved core keys render as their key.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

const listProject = {
  id: 'p1',
  title: 'Robot arm',
  description: '',
  status: 'IN_PROGRESS',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  startDate: null,
  dueDate: null,
  completedAt: null,
  position: 0,
  groupId: 'g1',
  coverUrl: null,
  tasksCount: 2,
  completedTasksCount: 1,
  componentsCount: 0,
  actualBudget: 0,
};

async function makeRouter(path: string): Promise<Router> {
  const blank = { render: () => null };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/projects', component: blank },
      { path: '/projects/:id', component: blank },
      { path: '/settings', component: blank },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

async function mountView(router: Router): Promise<VueWrapper> {
  const wrapper = mount(ProjectsView, { global: { plugins: [i18n, router] } });
  // The filter bar renders once the list has loaded.
  await flushPromises();
  return wrapper;
}

// The filter pickers are told apart by the value they currently hold rather
// than by their position in the template.
function picker(wrapper: VueWrapper, value: string): VueWrapper {
  const found = wrapper
    .findAllComponents(Select)
    .find((s) => s.props('modelValue') === value);
  if (!found) throw new Error(`no picker holding "${value}"`);
  return found;
}

beforeEach(() => {
  setActivePinia(createPinia());
  // Sort sits behind the advanced list-filters lens.
  localStorage.setItem('uxMode', 'advanced');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const body = /\/api\/projects(\?|$)/.test(String(input))
        ? [listProject]
        : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
});

// #375: every key used to build its replace from the same not-yet-replaced
// `route.query`, so keys changed in one tick kept only the last one written.
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('ProjectsView query state', () => {
  it('keeps the search, two filters and the view changed in one tick', async () => {
    const router = await makeRouter('/projects?keep=1');
    const wrapper = await mountView(router);
    const status = picker(wrapper, '');
    const sort = picker(wrapper, 'created');
    const boardToggle = wrapper.findAll('[role="group"] button')[1];

    // No await in between: all four writes happen in one tick.
    void wrapper.find('input[type="search"]').setValue('arm');
    status.vm.$emit('update:modelValue', 'IN_PROGRESS');
    sort.vm.$emit('update:modelValue', 'due');
    void boardToggle.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({
      keep: '1',
      q: 'arm',
      status: 'IN_PROGRESS',
      sort: 'due',
      view: 'board',
    });
  });

  it('drops the keys of filters reset to their defaults in one tick', async () => {
    const router = await makeRouter(
      '/projects?keep=1&q=arm&status=IN_PROGRESS&sort=due',
    );
    const wrapper = await mountView(router);
    const status = picker(wrapper, 'IN_PROGRESS');
    const sort = picker(wrapper, 'due');

    void wrapper.find('input[type="search"]').setValue('');
    status.vm.$emit('update:modelValue', '');
    sort.vm.$emit('update:modelValue', 'created');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
  });
});
