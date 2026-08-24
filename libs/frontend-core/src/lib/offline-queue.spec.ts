import { describe, expect, it } from 'vitest';
import { recoverQueue, type QueuedOp } from './offline-queue';

// What survives a phone being killed mid-drain (#202).

const op = (over: Partial<QueuedOp> & Pick<QueuedOp, 'id'>): QueuedOp => ({
  label: 'shot',
  path: '/api/components/intake/drafts',
  method: 'POST',
  body: {},
  state: 'pending',
  error: null,
  queuedAt: 0,
  ...over,
});

describe('recoverQueue', () => {
  it('re-sends an operation that was in flight when the tab died', () => {
    // It may or may not have reached the server. Re-sending is safe — the
    // server deduplicates on the op id — while dropping it would lose the work.
    const recovered = recoverQueue([op({ id: 'a', state: 'sending' })]);
    expect(recovered[0].state).toBe('pending');
  });

  it('leaves a refused operation refused', () => {
    // A 4xx verdict does not become truer by retrying; it waits for a human.
    const recovered = recoverQueue([
      op({ id: 'a', state: 'failed', error: 'not enough stock' }),
    ]);
    expect(recovered[0]).toMatchObject({
      state: 'failed',
      error: 'not enough stock',
    });
  });

  it('restores the order the operations were counted in', () => {
    const recovered = recoverQueue([
      op({ id: 'b', queuedAt: 20 }),
      op({ id: 'a', queuedAt: 10 }),
      op({ id: 'c', queuedAt: 30 }),
    ]);
    expect(recovered.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
});
