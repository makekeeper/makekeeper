import { describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { useRouteQuery } from './use-route-query';

type QuerySpec = [key: string, options?: Parameters<typeof useRouteQuery>[1]];

async function makeRouter(
  initialQuery: Record<string, string>,
): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  });
  await router.push({ path: '/', query: initialQuery });
  await router.isReady();
  return router;
}

// Several `useRouteQuery` instances in ONE component, the way CalendarView
// holds `view` and `date`: the bug this guards against (#331) only shows up
// across instances, so a single-key harness could never catch it.
function mountQueries(
  router: Router,
  specs: QuerySpec[],
): { models: { value: string }[]; wrapper: VueWrapper } {
  const models: { value: string }[] = [];
  const Host = defineComponent({
    setup() {
      for (const [key, options] of specs)
        models.push(useRouteQuery(key, options));
      return () => h('div');
    },
  });
  const wrapper = mount(Host, { global: { plugins: [router] } });
  return { models, wrapper };
}

// Drive the composable through a real router so the route.query narrowing,
// query preservation, and redundant-navigation handling are exercised end to
// end rather than mocked.
async function withRouteQuery(
  key: string,
  options: Parameters<typeof useRouteQuery>[1],
  initialQuery: Record<string, string>,
): Promise<{ router: Router; model: { value: string } }> {
  const router = await makeRouter(initialQuery);
  const { models } = mountQueries(router, [[key, options]]);
  return { router, model: models[0] };
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
    // Assigning the identical value is a no-op navigation; it must neither
    // throw nor disturb the query.
    model.value = 'same';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: 'same' });
  });

  it('reads an empty value in the URL as the default', async () => {
    const { model } = await withRouteQuery(
      'sort',
      { default: 'created' },
      {
        sort: '',
      },
    );
    expect(model.value).toBe('created');
  });

  it('reads reflect a navigation made elsewhere', async () => {
    const { router, model } = await withRouteQuery('q', {}, { q: 'a' });
    await router.replace({ query: { q: 'b' } });
    expect(model.value).toBe('b');
  });

  describe('several set() calls in one tick (#331)', () => {
    it('adds no history entry, so Back still leaves the batched page', async () => {
      const router = await makeRouter({ step: 'first' });
      await router.push({ query: { step: 'second' } });
      const {
        models: [a, b],
      } = mountQueries(router, [['a'], ['b']]);
      a.value = '1';
      b.value = '2';
      await flushPromises();
      router.back();
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ step: 'first' });
    });

    it('keeps every key when two instances are set in the same tick', async () => {
      const router = await makeRouter({ keep: '1' });
      const {
        models: [view, date],
      } = mountQueries(router, [['view', { default: 'month' }], ['date']]);
      date.value = '2026-11-02';
      view.value = 'agenda';
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        keep: '1',
        view: 'agenda',
        date: '2026-11-02',
      });
    });

    it('collapses N set() calls in one tick into one replace, never a push', async () => {
      const router = await makeRouter({});
      const replace = vi.spyOn(router, 'replace');
      const push = vi.spyOn(router, 'push');
      const { models } = mountQueries(router, [['a'], ['b'], ['c']]);
      models[0].value = '1';
      models[1].value = '2';
      models[2].value = '3';
      models[0].value = '4';
      await flushPromises();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(router.currentRoute.value.query).toEqual({
        a: '4',
        b: '2',
        c: '3',
      });
    });

    it('lets a set() back to the current value cancel itself within the batch', async () => {
      const router = await makeRouter({ view: 'week' });
      const {
        models: [view, date],
      } = mountQueries(router, [['view', { default: 'month' }], ['date']]);
      view.value = 'agenda';
      view.value = 'week';
      date.value = '2026-11-02';
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        view: 'week',
        date: '2026-11-02',
      });
    });

    it('does not navigate when the batch nets out to the current query', async () => {
      const router = await makeRouter({ view: 'week' });
      const replace = vi.spyOn(router, 'replace');
      const {
        models: [view],
      } = mountQueries(router, [['view', { default: 'month' }]]);
      view.value = 'agenda';
      view.value = 'week';
      await flushPromises();
      expect(replace).not.toHaveBeenCalled();
      expect(view.value).toBe('week');
    });

    it('reads its own pending write before the flush, from every instance', async () => {
      const router = await makeRouter({ q: 'old' });
      const {
        models: [first, second],
      } = mountQueries(router, [['q'], ['q', { default: 'none' }]]);
      first.value = 'new';
      // The route has not moved yet; the read already answers with the write.
      expect(router.currentRoute.value.query).toEqual({ q: 'old' });
      expect(first.value).toBe('new');
      expect(second.value).toBe('new');
      second.value = 'none';
      // A pending removal reads as each instance's own default.
      expect(first.value).toBe('');
      expect(second.value).toBe('none');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({});
      expect(second.value).toBe('none');
    });

    it('still applies a write whose component unmounted before the flush', async () => {
      const router = await makeRouter({});
      // Unmount a CHILD, not the app: unmounting the last app resets the
      // router to its start location, which is not what a closing panel does.
      const shown = ref(true);
      let q!: { value: string };
      const Child = defineComponent({
        setup() {
          q = useRouteQuery('q');
          return () => h('span');
        },
      });
      const Host = defineComponent({
        setup() {
          return () => h('div', shown.value ? [h(Child)] : []);
        },
      });
      mount(Host, { global: { plugins: [router] } });
      q.value = 'kept';
      shown.value = false;
      await nextTick();
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ q: 'kept' });
    });

    it('keeps a write made while the previous flush is still landing', async () => {
      const router = await makeRouter({ q: 'a' });
      const {
        models: [q, other],
      } = mountQueries(router, [['q'], ['other']]);
      q.value = 'b';
      // Let the first flush start but not settle, then write again.
      await Promise.resolve();
      q.value = 'a';
      other.value = 'x';
      expect(q.value).toBe('a');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ q: 'a', other: 'x' });
      expect(q.value).toBe('a');
    });

    it('does not skip a set-back while an earlier flush is in flight', async () => {
      const router = await makeRouter({ q: 'a' });
      const {
        models: [q],
      } = mountQueries(router, [['q']]);
      q.value = 'b';
      await Promise.resolve();
      q.value = 'a';
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ q: 'a' });
      expect(q.value).toBe('a');
    });

    it('keeps instances on different routers independent', async () => {
      const one = await makeRouter({});
      const two = await makeRouter({});
      const {
        models: [a],
      } = mountQueries(one, [['a']]);
      const {
        models: [b],
      } = mountQueries(two, [['b']]);
      a.value = '1';
      b.value = '2';
      await flushPromises();
      expect(one.currentRoute.value.query).toEqual({ a: '1' });
      expect(two.currentRoute.value.query).toEqual({ b: '2' });
    });
  });
});
