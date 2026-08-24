import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { useConfirmStore, useToastStore } from '@makekeeper/frontend-core';
import type { DiskBrowseResult } from '@makekeeper/plugin-contract';
import DiskBrowser from './DiskBrowser.vue';
import en from '../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

// A root holding one rolled-up directory, one plugin area and one loose file —
// the three cases the browser has to tell apart.
const ROOT: DiskBrowseResult = {
  path: '',
  parentPath: null,
  truncated: false,
  entries: [
    {
      name: 'projects',
      path: 'projects',
      isDirectory: true,
      kind: 'mixed',
      bytes: 3_145_728,
      files: 1412,
      deletableBytes: 1_048_576,
      deletableFiles: 40,
    },
    {
      name: '_bin',
      path: '_bin',
      isDirectory: true,
      kind: 'reserved',
      reservedBy: 'phone-bridge',
      bytes: 41_943_040,
      files: 1,
      deletableBytes: 0,
      deletableFiles: 0,
    },
    {
      name: 'leftover.tmp',
      path: 'leftover.tmp',
      isDirectory: false,
      kind: 'unowned',
      modifiedAt: '2026-06-01T10:00:00.000Z',
      bytes: 65_536,
      files: 1,
      deletableBytes: 65_536,
      deletableFiles: 1,
    },
  ],
};

const INSIDE: DiskBrowseResult = {
  path: 'projects',
  parentPath: '',
  truncated: false,
  entries: [
    {
      name: '2026',
      path: 'projects/2026',
      isDirectory: true,
      kind: 'claimed',
      bytes: 3_145_728,
      files: 1412,
      deletableBytes: 0,
      deletableFiles: 0,
    },
  ],
};

// The browsed directory lives in the URL (§5.3), so the component needs a real
// router rather than a stub — and the test can assert the drill-down landed there.
const makeRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/settings/disk', name: 'settings-disk', component: DiskBrowser },
    ],
  });

let router: ReturnType<typeof makeRouter>;

const render = async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  router = makeRouter();
  await router.push('/settings/disk');
  await router.isReady();
  return mount(DiskBrowser, {
    // No minimum hold here: the timing rule is covered where it lives
    // (use-resource.spec) and in the page spec; these cases are about content.
    props: { modelValue: true, graceHours: 24, minRefreshMs: 0 },
    // The dialog teleports to <body>; stubbing the teleport keeps its content
    // inside the wrapper so the assertions can see it.
    global: { plugins: [i18n, pinia, router], stubs: { teleport: true } },
  });
};

const checkboxes = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll('input[type="checkbox"]');

describe('DiskBrowser (#120)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes('path=projects') ? INSIDE : ROOT),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The reason the browser exists: a year of uploads is one row, not 1412.
  it('shows a directory as a single rolled-up row', async () => {
    const wrapper = await render();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('projects');
    expect(text).toContain('1412 files');
    expect(text).toContain('3.0 MiB');
  });

  // "Select everything deletable here" acts on the rows that are here. If the
  // level was cut short, saying so is what keeps that button honest.
  it('says when a level was cut short', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...ROOT, truncated: true }),
      })),
    );
    const wrapper = await render();
    await flushPromises();
    expect(wrapper.text()).toContain('Only the first 3 entries are shown');
  });

  it('drills in and offers the way back', async () => {
    const wrapper = await render();
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'projects')
      ?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.dir).toBe('projects');
    expect(wrapper.text()).toContain('2026');
    expect(wrapper.text()).toContain('Up one level');
  });

  // Claimed and plugin-owned rows are visible but unpickable; the server would
  // refuse them anyway, and offering the checkbox would promise otherwise.
  it('cannot select a plugin area', async () => {
    const wrapper = await render();
    await flushPromises();

    const boxes = checkboxes(wrapper);
    // Order follows the listing: projects, _bin, leftover.tmp.
    expect(boxes[0].attributes('disabled')).toBeUndefined();
    expect(boxes[1].attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('phone-bridge');
  });

  it('states the selected total, counting only what would go', async () => {
    const wrapper = await render();
    await flushPromises();

    // The directory holds 1412 files but only 40 are deletable.
    await checkboxes(wrapper)[0].setValue(true);
    await flushPromises();

    expect(wrapper.text()).toContain('Selected: 40 files (1.0 MiB)');
  });

  it('deletes the selection and reports what was kept', async () => {
    const wrapper = await render();
    await flushPromises();
    const confirmStore = useConfirmStore();
    vi.spyOn(confirmStore, 'ask').mockResolvedValue(true);

    await checkboxes(wrapper)[2].setValue(true);
    await flushPromises();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('/disk/delete')
            ? {
                deleted: { bytes: 65_536, files: 1 },
                skippedClaimed: 2,
                skippedReserved: 0,
                skippedRecent: 1,
                missing: 0,
                failed: 0,
              }
            : ROOT,
      })),
    );

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Delete selected'))
      ?.trigger('click');
    await flushPromises();

    const sent = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/disk/delete'));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      paths: ['leftover.tmp'],
    });

    const toasts = useToastStore().toasts.map((toast) => toast.message);
    expect(toasts).toContainEqual(
      expect.stringContaining('Deleted 1 files, freed 64.0 KiB'),
    );
    expect(toasts).toContainEqual(expect.stringContaining('2 in use'));
  });

  // The controls must not appear only once you have guessed the gesture, and
  // must not pop in and out under the pointer.
  it('always shows the controls, disabling what does not apply', async () => {
    const wrapper = await render();
    await flushPromises();

    const button = (label: string) =>
      wrapper.findAll('button').find((b) => b.text().includes(label));

    expect(wrapper.text()).toContain('Nothing selected');
    expect(button('Clear')?.attributes('disabled')).toBeDefined();
    expect(button('Delete selected')?.attributes('disabled')).toBeDefined();
    // This level does hold something deletable, so the bulk pick stays live.
    expect(button('Select everything')?.attributes('disabled')).toBeUndefined();

    await checkboxes(wrapper)[2].setValue(true);
    await flushPromises();

    expect(button('Clear')?.attributes('disabled')).toBeUndefined();
    expect(button('Delete selected')?.attributes('disabled')).toBeUndefined();
  });

  // "Clear" and "Delete" do opposite things; sitting them side by side is how a
  // misclick becomes a deletion, so they live at opposite ends of the panel.
  it('keeps the destructive button away from Clear', async () => {
    const wrapper = await render();
    await flushPromises();

    const header = wrapper.find('header');
    const footer = wrapper.find('footer');
    expect(header.text()).toContain('Clear');
    expect(header.text()).toContain('Select everything');
    expect(header.text()).not.toContain('Delete selected');
    expect(footer.text()).toContain('Delete selected');
    expect(footer.text()).not.toContain('Clear');
  });

  it('disables the bulk pick on a level with nothing deletable', async () => {
    const wrapper = await render();
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'projects')
      ?.trigger('click');
    await flushPromises();

    // Inside, the only row is claimed — nothing here can be picked.
    const selectAll = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Select everything'));
    expect(selectAll?.attributes('disabled')).toBeDefined();
  });

  it('sends nothing when the confirm is declined', async () => {
    const wrapper = await render();
    await flushPromises();
    vi.spyOn(useConfirmStore(), 'ask').mockResolvedValue(false);

    await checkboxes(wrapper)[2].setValue(true);
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Delete selected'))
      ?.trigger('click');
    await flushPromises();

    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.includes('/disk/delete'))).toBe(false);
  });
});
