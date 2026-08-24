import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useToastStore } from './toast-store';

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a toast with the given tone and a unique id', () => {
    const store = useToastStore();
    const idA = store.success('Saved');
    const idB = store.error('Failed');

    expect(store.toasts).toHaveLength(2);
    expect(idA).not.toBe(idB);
    expect(store.toasts[0]).toMatchObject({
      message: 'Saved',
      tone: 'success',
    });
    expect(store.toasts[1]).toMatchObject({ message: 'Failed', tone: 'error' });
  });

  it('auto-dismisses after the duration elapses', () => {
    const store = useToastStore();
    store.info('Heads up', 1000);
    expect(store.toasts).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(store.toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.toasts).toHaveLength(0);
  });

  it('does not auto-dismiss when duration is 0', () => {
    const store = useToastStore();
    store.show('Sticky', 'info', 0);
    vi.advanceTimersByTime(100000);
    expect(store.toasts).toHaveLength(1);
  });

  it('dismiss removes only the targeted toast', () => {
    const store = useToastStore();
    const id = store.success('One', 0);
    store.error('Two', 0);

    store.dismiss(id);
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].message).toBe('Two');
  });
});
