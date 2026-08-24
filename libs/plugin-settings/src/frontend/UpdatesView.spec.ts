import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { SectionNav } from '@makekeeper/frontend-core';
import type { DeployHookState, InstallInfo } from '@makekeeper/plugin-contract';
import UpdatesView from './UpdatesView.vue';
import en from '../i18n/en.json';

// A smoke test over the four panes (#267). Templates are the one part of a Vue
// change no quality gate here checks — build compiles them, nothing renders
// them — so each section is opened once and asked to draw.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const INSTALL_INFO: InstallInfo = {
  method: 'dokploy',
  container: true,
  confidence: 'declared',
};

const HOOK: DeployHookState = {
  hasUrl: true,
  hasToken: true,
  urlPreview: 'https://deploy.example/…cdef',
  method: 'POST',
  lastTriggeredAt: null,
  lastOutcome: 'never',
  lastStatusCode: null,
};

const CHECK_STATE = {
  currentVersion: '0.14.0',
  latestVersion: '0.15.0',
  updateAvailable: true,
  releaseUrl: 'https://example.invalid/releases/0.15.0',
  lastCheckedAt: '2026-08-01T10:00:00.000Z',
  lastCheckStatus: 'ok',
  autoCheckEnabled: true,
  checkHourUtc: 3,
};

const render = async (path = '/settings/updates') => {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/:rest(.*)', component: UpdatesView }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(UpdatesView, {
    global: {
      plugins: [i18n, createPinia(), router],
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  return wrapper;
};

describe('UpdatesView (#267)', () => {
  beforeEach(() => {
    // jsdom has no scroller; the reference link scrolls to the fold it opens.
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => {
          if (url.includes('install-info')) return INSTALL_INFO;
          if (url.includes('deploy-hook')) return HOOK;
          return CHECK_STATE;
        },
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens Version by default and lists all four sections', async () => {
    const wrapper = await render();
    const nav = wrapper.findComponent(SectionNav);
    expect(nav.props('items').map((item) => item.key)).toEqual([
      'version',
      'auto',
      'update',
      'install',
    ]);
    expect(wrapper.text()).toContain('0.14.0');
  });

  it('flags an available update on the picker, from any section', async () => {
    const wrapper = await render('/settings/updates?section=install');
    const items = wrapper.findComponent(SectionNav).props('items');
    expect(items[0].badge).toBe(1);
    expect(items[0].badgeLabel).toBe('An update is available');
    // …and the diagnostics pane is the one on screen.
    expect(wrapper.text()).toContain('Dokploy');
  });

  it('renders the schedule section', async () => {
    const wrapper = await render('/settings/updates?section=auto');
    expect(wrapper.find('#update-hour').exists()).toBe(true);
  });

  it('renders the update section with the form open and the reference folded', async () => {
    const wrapper = await render('/settings/updates?section=update');
    // The thing an admin came to do is on screen, unfolded.
    expect(wrapper.find('#deploy-hook-url').exists()).toBe(true);
    expect(wrapper.find('#deploy-hook-token').exists()).toBe(true);
    // The reference is mounted but closed, and announced from the heading
    // rather than left to be discovered (#272).
    const body = wrapper.get('#updates-reference');
    expect(body.attributes('style')).toContain('display: none');
    expect(body.text()).toContain(en.settings.updates.guide.title);
    // Two controls point at the region, and only one of them is a toggle: the
    // fold's own heading carries the state, the link by the section heading
    // only ever opens and so claims no `aria-expanded`.
    const pointing = wrapper
      .findAll('[aria-controls="updates-reference"]')
      .map((el) => el.attributes('aria-expanded'));
    expect(pointing).toEqual([undefined, 'false']);
  });

  it('opens the reference from the link by the heading', async () => {
    const wrapper = await render('/settings/updates?section=update');
    const link = wrapper
      .findAll('[aria-controls="updates-reference"]')
      .find((el) => el.text() === en.settings.updates.reference.link);
    if (!link) throw new Error('the reference link is missing');
    await link.trigger('click');
    await nextTick();
    await nextTick();
    expect(wrapper.get('#updates-reference').attributes('style')).not.toContain(
      'display: none',
    );
  });

  it('falls back to the default section for an unknown one', async () => {
    const wrapper = await render('/settings/updates?section=nope');
    expect(wrapper.findComponent(SectionNav).props('activeKey')).toBe(
      'version',
    );
  });
});
