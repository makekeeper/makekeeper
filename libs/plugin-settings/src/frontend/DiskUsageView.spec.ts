import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { useConfirmStore, useToastStore } from '@makekeeper/frontend-core';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import type { DiskUsageReport } from '@makekeeper/plugin-contract';
import DiskUsageView from './DiskUsageView.vue';
import en from '../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const REPORT: DiskUsageReport = {
  root: '/data/uploads',
  total: { bytes: 3_145_728, files: 7 },
  originals: { bytes: 2_097_152, files: 2 },
  derivatives: { bytes: 524_288, files: 4 },
  unreferenced: { bytes: 524_288, files: 3 },
  unreferencedPurgeable: { bytes: 393_216, files: 2 },
  unreferencedRecent: { bytes: 131_072, files: 1 },
  reserved: { bytes: 41_943_040, files: 1 },
  reservedAreas: [
    { path: '_bin', pluginId: 'phone-bridge', bytes: 41_943_040, files: 1 },
  ],
  unowned: { bytes: 65_536, files: 2 },
  orphanGraceHours: 24,
  missingFiles: 2,
  byOwner: [
    {
      pluginId: 'projects',
      originals: { bytes: 2_097_152, files: 2 },
      derivatives: { bytes: 262_144, files: 2 },
    },
    {
      pluginId: 'inventory',
      originals: { bytes: 262_144, files: 1 },
      derivatives: { bytes: 0, files: 0 },
    },
    // Nothing said who wrote these — pre-declaration rows the backfill could
    // not reach.
    {
      pluginId: null,
      originals: { bytes: 131_072, files: 1 },
      derivatives: { bytes: 0, files: 0 },
    },
  ],
  byScope: [
    { scopeId: 'u1', bytes: 2_621_440, files: 6 },
    { scopeId: null, bytes: 524_288, files: 1 },
  ],
  generatedAt: '2026-07-26T18:00:00.000Z',
};

// The embedded browser keeps the current directory in the URL (§5.3), so the
// page needs a real router — mounting without one used to take the whole view
// down, which is exactly what a page test should catch.
const render = async () => {
  const pinia = createPinia();
  // The confirm/toast hosts are stores the component reaches for directly, so
  // the test needs the same active instance the mount uses.
  setActivePinia(pinia);
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:rest(.*)', component: DiskUsageView }],
  });
  // The page reads and writes route query, so the router must have resolved its
  // first navigation before anything mounts.
  await router.push('/settings/disk');
  await router.isReady();
  return mount(DiskUsageView, {
    global: { plugins: [i18n, pinia, router], stubs: { teleport: true } },
  });
};

// The page holds its loading state for a beat so the blur can finish and the
// spinner is legible; the tests drive that clock rather than waiting on it.
const MIN_REFRESH_MS = 800;

const settle = async (): Promise<void> => {
  await flushPromises();
  await vi.advanceTimersByTimeAsync(MIN_REFRESH_MS);
  await flushPromises();
};

describe('DiskUsageView (#120)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        // The multiuser plugin is disabled in this pinia store, so the users
        // request must never fire; answer it anyway to catch it if it does.
        json: async () =>
          url.includes('/disk/usage')
            ? REPORT
            : url.includes('/disk/browse')
              ? { path: '', parentPath: null, entries: [] }
              : [],
      })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the total in binary units, matching what du -h prints', async () => {
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('3.0 MiB');
    expect(wrapper.text()).toContain('/data/uploads');
  });

  // The originals/derivatives split is the distinction the retention decision
  // turns on; unreferenced bytes are what a cleanup would take first.
  it('breaks the total into originals, previews and unreferenced', async () => {
    const wrapper = await render();
    await settle();
    const text = wrapper.text();
    expect(text).toContain('Originals');
    expect(text).toContain('2.0 MiB');
    expect(text).toContain('Previews');
    expect(text).toContain('Unreferenced');
    expect(text).toContain('512.0 KiB');
  });

  // The regression this rule exists for: the phone-bridge keeps its downloaded
  // tunnel client under the uploads root, and it must read as that plugin's
  // area rather than as an orphan waiting to be swept.
  it('names the plugin behind a reserved area', async () => {
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('Plugin areas');
    expect(wrapper.text()).toContain('_bin');
    expect(wrapper.text()).toContain('phone-bridge');
    expect(wrapper.text()).toContain('40.0 MiB');
  });

  // The browser is a dialog now: the page must offer a way in, and must not
  // fetch a directory listing until it is actually opened.
  it('opens the file browser from the card, not before', async () => {
    const wrapper = await render();
    await settle();

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes('/disk/browse')),
    ).toBe(false);

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Browse files'))
      ?.trigger('click');
    await settle();

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).includes('/disk/browse')),
    ).toBe(true);
  });

  // Browsing is how you find out what is on disk, so it cannot depend on there
  // being something to sweep; the sweep itself greys out instead of vanishing.
  it('keeps both actions on the page when there is nothing to sweep', async () => {
    const nothingToSweep: DiskUsageReport = {
      ...REPORT,
      unreferenced: { bytes: 0, files: 0 },
      unreferencedPurgeable: { bytes: 0, files: 0 },
      unreferencedRecent: { bytes: 0, files: 0 },
      unowned: { bytes: 0, files: 0 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('/disk/usage')
            ? nothingToSweep
            : url.includes('/disk/browse')
              ? { path: '', parentPath: null, entries: [] }
              : [],
      })),
    );

    const wrapper = await render();
    await settle();

    const button = (label: string) =>
      wrapper.findAll('button').find((b) => b.text().includes(label));

    expect(button('Browse files')?.attributes('disabled')).toBeUndefined();
    expect(button('Delete unreferenced')?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Nothing to sweep');
  });

  // A refresh must not tear the figures off screen: they stay, dimmed, under a
  // spinner, so the page holds its layout instead of blinking.
  it('dims the loaded report during a refresh instead of blanking it', async () => {
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('3.0 MiB');

    // Hold the refresh open so the intermediate state can be observed.
    let release: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                ok: true,
                json: async () =>
                  url.includes('/disk/usage')
                    ? REPORT
                    : { path: '', parentPath: null, entries: [] },
              });
          }),
      ),
    );

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Refresh'))
      ?.trigger('click');
    await settle();

    // Still there, just dimmed — and the spinner says why.
    expect(wrapper.text()).toContain('3.0 MiB');
    expect(wrapper.find('.blur-sm').exists()).toBe(true);

    release?.();
    await flushPromises();
    expect(wrapper.find('.blur-sm').exists()).toBe(false);
  });

  it('warns about rows whose file is gone', async () => {
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('2 records point at a file');
  });

  // Each row is named by the OWNING plugin's manifest, so the page never keeps
  // its own list of surfaces; a plugin with no manifest loaded shows its id.
  it('names each owner by its plugin, undetermined rows apart', async () => {
    const wrapper = await render();
    await settle();
    const text = wrapper.text();
    expect(text.indexOf('projects')).toBeLessThan(text.indexOf('inventory'));
    expect(text).toContain('Undetermined');
  });

  // The pair is the point: an original cannot be regenerated, a preview can, so
  // "how much of this is originals" has to be readable per plugin.
  it('splits each owner into originals and previews', async () => {
    const wrapper = await render();
    await settle();
    const text = wrapper.text();
    // Inventory: 256 KiB of originals and no previews at all.
    expect(text).toContain('256.0 KiB');
    expect(text).toContain('0 B');
  });

  // Naming users belongs to the multiuser plugin; with it disabled the raw
  // scope id is shown rather than a broken lookup.
  it('falls back to the scope id, and names unowned rows', async () => {
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('u1');
    expect(wrapper.text()).toContain('No owner');
  });

  // A fresh instance would otherwise render a wall of zeros and three empty
  // bars — a report about nothing.
  it('says so plainly when nothing has been uploaded yet', async () => {
    const empty: DiskUsageReport = {
      ...REPORT,
      total: { bytes: 0, files: 0 },
      originals: { bytes: 0, files: 0 },
      derivatives: { bytes: 0, files: 0 },
      unreferenced: { bytes: 0, files: 0 },
      unreferencedPurgeable: { bytes: 0, files: 0 },
      unreferencedRecent: { bytes: 0, files: 0 },
      reserved: { bytes: 0, files: 0 },
      reservedAreas: [],
      unowned: { bytes: 0, files: 0 },
      missingFiles: 0,
      byScope: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes('/disk/usage') ? empty : []),
      })),
    );
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('Nothing stored yet');
    expect(wrapper.text()).not.toContain('Total on disk');
  });

  // The only destructive control on the page: it must ask first, and it must
  // report a sweep that skipped everything as skipped, not as "nothing to do".
  describe('unreferenced cleanup', () => {
    const confirmWith = (answer: boolean) => {
      const confirmStore = useConfirmStore();
      // The dialog resolves through the shared host; stand in for the user.
      vi.spyOn(confirmStore, 'ask').mockResolvedValue(answer);
      return confirmStore;
    };

    it('does nothing until the confirm is accepted', async () => {
      const wrapper = await render();
      await settle();
      confirmWith(false);

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Delete unreferenced'))
        ?.trigger('click');
      await settle();

      const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(calls.some((url) => url.includes('/disk/unreferenced'))).toBe(
        false,
      );
    });

    // The dialog must promise what the sweep will actually do: the purgeable
    // figure, not the whole unreferenced total, and the kept remainder aloud.
    it('states exact counts in the confirm, and what stays behind', async () => {
      const wrapper = await render();
      await settle();
      const confirmStore = confirmWith(false);

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Delete unreferenced'))
        ?.trigger('click');
      await settle();

      const asked = vi.mocked(confirmStore.ask).mock.calls[0][0];
      expect(asked.message).toContain('2 files (384.0 KiB) will be deleted');
      expect(asked.message).toContain('1 more (128.0 KiB)');
      expect(asked.tone).toBe('danger');
    });

    it('sweeps and reports what was freed and what was left', async () => {
      const wrapper = await render();
      await settle();
      confirmWith(true);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => ({
          ok: true,
          json: async () =>
            url.includes('/disk/unreferenced')
              ? {
                  deleted: { bytes: 1_048_576, files: 3 },
                  skippedRecent: 2,
                  failed: 0,
                }
              : url.includes('/disk/browse')
                ? { path: '', parentPath: null, entries: [] }
                : REPORT,
        })),
      );

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Delete unreferenced'))
        ?.trigger('click');
      await settle();

      const toasts = useToastStore().toasts.map((toast) => toast.message);
      expect(toasts).toContainEqual(
        expect.stringContaining('Deleted 3 files, freed 1.0 MiB'),
      );
      expect(toasts).toContainEqual(
        expect.stringContaining('2 files were left alone'),
      );
    });
  });

  it('surfaces a server failure instead of an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Uploads root unreadable' }),
      })),
    );
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('Uploads root unreadable');
  });

  // An unreachable server carries no message of its own — that is what the
  // localized fallback is for.
  it('falls back to a localized message when the request never lands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const wrapper = await render();
    await settle();
    expect(wrapper.text()).toContain('Could not read disk usage');
  });
});
