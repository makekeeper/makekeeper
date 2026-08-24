import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useConfirmStore } from './confirm-store';

describe('useConfirmStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens with the given options and resolves true on confirm', async () => {
    const store = useConfirmStore();
    const pending = store.ask({ message: 'Delete this?', tone: 'danger' });

    expect(store.state.open).toBe(true);
    expect(store.state.message).toBe('Delete this?');
    expect(store.state.tone).toBe('danger');

    store.respond(true);
    await expect(pending).resolves.toBe(true);
    expect(store.state.open).toBe(false);
  });

  it('resolves false on cancel', async () => {
    const store = useConfirmStore();
    const pending = store.ask({ message: 'Sure?' });
    store.respond(false);
    await expect(pending).resolves.toBe(false);
    expect(store.state.open).toBe(false);
  });
});
