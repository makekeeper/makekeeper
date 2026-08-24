import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { useResource, type Resource } from './use-resource';
import { notifyAgentDataChanged } from './data-events';
import { useSessionStore } from './session-store';
import { useToastStore } from './toast-store';
import { ApiError } from './api';

// Let queued microtasks (the fetcher promise) AND the Vue watch queue settle.
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
};

describe('useResource', () => {
  let scope: EffectScope;

  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  // Run useResource inside an effect scope so its watches and onScopeDispose
  // behave exactly as they would inside a component's setup.
  const run = <T>(...args: Parameters<typeof useResource<T>>): Resource<T> =>
    scope.run(() => useResource<T>(...args)) as Resource<T>;

  it('transitions loading → ready and exposes the data projections', async () => {
    const onData = vi.fn();
    const r = run(async () => ['a', 'b'], { onData });
    expect(r.state.value).toEqual({ status: 'loading' });
    expect(r.loading.value).toBe(true);

    await flush();

    expect(r.state.value).toEqual({ status: 'ready', data: ['a', 'b'] });
    expect(r.data.value).toEqual(['a', 'b']);
    expect(r.loading.value).toBe(false);
    expect(onData).toHaveBeenCalledWith(['a', 'b']);
  });

  it('surfaces an ApiError message and toasts when asked', async () => {
    const r = run(
      async () => {
        throw new ApiError(500, {}, 'boom from server');
      },
      { toastOnError: true },
    );
    await flush();

    expect(r.state.value).toEqual({
      status: 'error',
      message: 'boom from server',
    });
    expect(r.error.value).toBe('boom from server');
    expect(useToastStore().toasts.at(-1)?.message).toBe('boom from server');
  });

  it('falls back to the provided message for a non-ApiError failure', async () => {
    const r = run(
      async () => {
        throw new Error('network down');
      },
      { errorFallback: () => 'Could not load' },
    );
    await flush();
    expect(r.error.value).toBe('Could not load');
  });

  it('aborts the in-flight request on refetch and drops the stale response', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: Array<(v: string) => void> = [];
    const fetcher = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>((resolve) => resolvers.push(resolve));
    });

    const r = run<string>(fetcher);
    await flush(); // first request in flight

    void r.refetch(); // supersedes the first
    await flush();

    expect(signals[0].aborted).toBe(true); // first request was aborted
    expect(fetcher).toHaveBeenCalledTimes(2);

    resolvers[1]('second'); // newest resolves first
    await flush();
    expect(r.data.value).toBe('second');

    resolvers[0]('first'); // stale resolves late — must NOT overwrite
    await flush();
    expect(r.data.value).toBe('second');
  });

  it('refetches when the agent-data signal fires', async () => {
    const fetcher = vi.fn(async () => 'x');
    run<string>(fetcher, { refetchOn: ['agent-data'] });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    notifyAgentDataChanged();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches when the active scope changes', async () => {
    const fetcher = vi.fn(async () => 'x');
    run<string>(fetcher, { refetchOn: ['scope'] });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    useSessionStore().activeScopeId = 'other-scope';
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('holds the initial fetch until enabled flips true', async () => {
    const enabled = ref(false);
    const fetcher = vi.fn(async () => 'x');
    run<string>(fetcher, { enabled });
    await flush();
    expect(fetcher).not.toHaveBeenCalled();

    enabled.value = true;
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // A refresh that blanks the screen reads as a navigation; keeping the last
  // value is what lets a view dim in place instead of blinking.
  describe('keepPreviousData', () => {
    it('holds the last value through a refetch and flags it as refreshing', async () => {
      let call = 0;
      const r = run(async () => `page ${++call}`, { keepPreviousData: true });
      await flush();
      expect(r.data.value).toBe('page 1');
      expect(r.refreshing.value).toBe(false);

      const pending = r.refetch();
      expect(r.loading.value).toBe(true);
      // The old value is still on screen, and the view knows it is stale.
      expect(r.data.value).toBe('page 1');
      expect(r.refreshing.value).toBe(true);

      await pending;
      expect(r.data.value).toBe('page 2');
      expect(r.refreshing.value).toBe(false);
    });

    it('is off by default, so existing views still blank while loading', async () => {
      const r = run(async () => 'x');
      await flush();
      const pending = r.refetch();
      expect(r.data.value).toBeUndefined();
      expect(r.refreshing.value).toBe(false);
      await pending;
    });

    // Yesterday's numbers under an error message are worse than the error alone.
    it('drops the stale value when the refresh fails', async () => {
      let call = 0;
      const r = run(
        async () => {
          if (++call > 1) throw new ApiError(500, {}, 'boom');
          return 'first';
        },
        { keepPreviousData: true },
      );
      await flush();
      await r.refetch();

      expect(r.data.value).toBeUndefined();
      expect(r.error.value).toBe('boom');
    });
  });

  describe('setData', () => {
    it('applies pushed data and reports ready', async () => {
      const r = run(async () => 'fetched');
      await flush();
      r.setData('pushed');
      expect(r.state.value).toEqual({ status: 'ready', data: 'pushed' });
      expect(r.data.value).toBe('pushed');
    });

    // A mutation response is newer than whatever a pending read would return —
    // the late resolution must not roll the resource back.
    it('supersedes an in-flight fetch', async () => {
      const resolvers: Array<(v: string) => void> = [];
      const r = run<string>(
        (signal) =>
          new Promise<string>((resolve) => {
            void signal;
            resolvers.push(resolve);
          }),
      );
      await flush(); // first request in flight

      r.setData('pushed');
      expect(r.data.value).toBe('pushed');

      resolvers[0]('stale'); // the read resolves late — must NOT overwrite
      await flush();
      expect(r.data.value).toBe('pushed');
    });
  });

  describe('minLoadingMs', () => {
    it('holds a fast answer until the loading state has been legible', async () => {
      const r = run(async () => 'quick', { minLoadingMs: 60 });
      await flush();
      // The fetcher already resolved; the state is held on purpose.
      expect(r.loading.value).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 80));
      await flush();
      expect(r.data.value).toBe('quick');
      expect(r.loading.value).toBe(false);
    });

    // An error that flashes past is as unreadable as a spinner that does.
    it('holds a fast failure for the same minimum', async () => {
      const r = run(
        async () => {
          throw new ApiError(500, {}, 'boom');
        },
        { minLoadingMs: 60 },
      );
      await flush();
      expect(r.error.value).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 80));
      await flush();
      expect(r.error.value).toBe('boom');
    });

    it('adds nothing when the request already took longer', async () => {
      const started = Date.now();
      const r = run(
        async () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('slow'), 70),
          ),
        { minLoadingMs: 20 },
      );
      await new Promise((resolve) => setTimeout(resolve, 90));
      await flush();
      expect(r.data.value).toBe('slow');
      expect(Date.now() - started).toBeLessThan(200);
    });
  });
});
