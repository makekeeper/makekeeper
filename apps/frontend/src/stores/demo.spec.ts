import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DEMO_CLEAR_INCOMPLETE, useDemoStore } from './demo';

// The removal runs on the server with scope enforcement suspended, and a delete
// that matched nothing would still stamp the instance as cleared. So "the
// request succeeded" and "the data is gone" are different claims, and the store
// re-reads the status rather than believing the first one.
describe('demo store', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => vi.unstubAllGlobals());

  const respond = (...bodies: unknown[]) => {
    const fetchMock = vi.fn();
    for (const body of bodies) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    }
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('reports removal once the server says the data is gone', async () => {
    respond({ removed: 54 }, { active: false, seededAt: 'x', clearedAt: 'y' });
    const demo = useDemoStore();

    const result = await demo.clear();

    expect(result.removed).toBe(54);
    expect(demo.active).toBe(false);
    expect(demo.clearing).toBe(false);
  });

  it('fails loudly when the data is still there afterwards', async () => {
    // The dangerous shape: a cheerful zero and a status that never changed.
    respond({ removed: 0 }, { active: true, seededAt: 'x', clearedAt: null });
    const demo = useDemoStore();

    await expect(demo.clear()).rejects.toThrow(DEMO_CLEAR_INCOMPLETE);
    expect(demo.active).toBe(true);
    expect(demo.clearing).toBe(false);
  });
});
