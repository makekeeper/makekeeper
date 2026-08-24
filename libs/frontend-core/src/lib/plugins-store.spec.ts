import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePluginsStore } from './plugins-store';
import { registerPlugin } from './registry';

// The instance toggle must invoke the toggled plugin's frontend lifecycle hook
// (the mechanism the multiuser plugin uses for its mode-transition effect) —
// and only after a successful PATCH; a hook failure must not roll the
// persisted toggle back.
describe('plugins store — frontend lifecycle hooks on instance toggle', () => {
  const onInstanceEnabled = vi.fn();
  const onInstanceDisabled = vi.fn();

  // Module-level registry — register once for the whole file.
  registerPlugin({
    id: 'magic',
    nameKey: 'plugins.magic.name',
    navigation: [],
    routes: [],
    messages: { en: {}, ru: {} },
    onInstanceEnabled,
    onInstanceDisabled,
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    onInstanceEnabled.mockReset();
    onInstanceDisabled.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (patchOk: boolean) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          return { ok: patchOk, status: patchOk ? 200 : 403 } as Response;
        }
        return {
          ok: true,
          json: async () => [
            {
              id: 'magic',
              core: false,
              isEnabled: true,
              instanceEnabled: true,
            },
          ],
        } as Response;
      }),
    );
  };

  it('fires onInstanceEnabled after a successful enable', async () => {
    stubFetch(true);
    const store = usePluginsStore();

    await store.setEnabled('magic', true);

    expect(onInstanceEnabled).toHaveBeenCalledTimes(1);
    expect(onInstanceDisabled).not.toHaveBeenCalled();
  });

  it('fires onInstanceDisabled after a successful disable', async () => {
    stubFetch(true);
    const store = usePluginsStore();

    await store.setEnabled('magic', false);

    expect(onInstanceDisabled).toHaveBeenCalledTimes(1);
    expect(onInstanceEnabled).not.toHaveBeenCalled();
  });

  it('skips the hook entirely when the PATCH fails', async () => {
    stubFetch(false);
    const store = usePluginsStore();

    await store.setEnabled('magic', true);

    expect(onInstanceEnabled).not.toHaveBeenCalled();
  });

  it('a throwing hook does not roll the toggle back', async () => {
    stubFetch(true);
    onInstanceEnabled.mockRejectedValueOnce(new Error('boom'));
    const store = usePluginsStore();
    await store.fetchPlugins();

    await store.setEnabled('magic', true);

    expect(store.byId['magic']?.isEnabled).toBe(true);
  });
});
