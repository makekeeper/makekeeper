import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useRouteQuery } from './use-route-query';

// Drive the composable through a real router so the route.query narrowing,
// query preservation, and redundant-navigation handling are exercised end to
// end rather than mocked.
async function withRouteQuery(
  key: string,
  options: Parameters<typeof useRouteQuery>[1],
  initialQuery: Record<string, string>,
): Promise<{ router: Router; model: { value: string } }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  });
  await router.push({ path: '/', query: initialQuery });
  await router.isReady();

  let model!: { value: string };
  const Host = defineComponent({
    setup() {
      model = useRouteQuery(key, options);
      return () => h('div');
    },
  });
  mount(Host, { global: { plugins: [router] } });
  return { router, model };
}

describe('useRouteQuery', () => {
  it('reads the current value, falling back to the default', async () => {
    const { model } = await withRouteQuery('tab', { default: 'dashboard' }, {});
    expect(model.value).toBe('dashboard');
  });

  it('maps aliased legacy values onto the canonical one', async () => {
    const { model } = await withRouteQuery(
      'tab',
      { default: 'dashboard', alias: { chat: 'ai' } },
      { tab: 'chat' },
    );
    expect(model.value).toBe('ai');
  });

  it('writes the value into the query and preserves other keys', async () => {
    const { router, model } = await withRouteQuery('q', {}, { page: '2' });
    model.value = 'drill';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ page: '2', q: 'drill' });
  });

  it('removes the key when set back to the default', async () => {
    const { router, model } = await withRouteQuery(
      'tab',
      { default: 'dashboard' },
      { tab: 'ai', keep: '1' },
    );
    model.value = 'dashboard';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
  });

  it('swallows a redundant navigation to the same value', async () => {
    const { router, model } = await withRouteQuery('q', {}, { q: 'same' });
    // Assigning the identical value would reject with NavigationDuplicated;
    // the composable catches it so this does not throw.
    model.value = 'same';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: 'same' });
  });
});
