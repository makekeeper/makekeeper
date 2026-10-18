import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import router from '../router';
import { i18n } from '../i18n';
import HelloBanner from './HelloBanner.vue';
import { useSessionStore, useTelemetryStore } from '@makekeeper/frontend-core';
import { useHelloStore } from '../stores/hello';

// The card asks every signed-in person once the server says it is due (#368),
// offers the ping only to whoever may act for the instance, and never offers to
// turn on a ping that is already on — the one detail that would make the ask
// dishonest.
let pinia = createPinia();

const mountBanner = () =>
  mount(HelloBanner, { global: { plugins: [router, i18n, pinia] } });

const dueState = {
  show: true,
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  dismissedAt: null,
};

// The settings routes are a plugin's, registered at runtime in the real app;
// the card links to two of them by name, so the bare test router needs both.
for (const [name, path] of [
  ['settings-about', '/settings/about'],
  ['settings-updates', '/settings/about/updates'],
] as const) {
  if (!router.hasRoute(name)) {
    router.addRoute({ name, path, component: { template: '<div />' } });
  }
}

describe('HelloBanner', () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => dueState,
      }),
    );
  });

  it('stays hidden until the server says the card is due', async () => {
    const wrapper = mountBanner();
    useHelloStore().state = { ...dueState, show: false };
    await nextTick();
    expect(wrapper.text()).toBe('');
  });

  it('asks a week-old single-user instance, offering every way to respond', async () => {
    const wrapper = mountBanner();
    useHelloStore().state = dueState;
    useTelemetryStore().state = {
      consent: 'unasked',
      instanceId: null,
      prompted: true,
      lastSentAt: null,
      lastStatus: 'never',
      endpointConfigured: true,
      endpoint: 'https://ping.example.invalid',
    };
    await nextTick();
    const text = wrapper.text();
    expect(text).toContain(i18n.global.t('hello.banner.title'));
    expect(text).toContain(i18n.global.t('hello.banner.star'));
    expect(text).toContain(i18n.global.t('hello.banner.follow'));
    expect(text).toContain(i18n.global.t('hello.banner.feedback'));
    expect(text).toContain(i18n.global.t('hello.banner.ping'));
  });

  it('does not offer the ping when it is already on', async () => {
    const wrapper = mountBanner();
    useHelloStore().state = dueState;
    useTelemetryStore().state = {
      consent: 'granted',
      instanceId: 'abc',
      prompted: true,
      lastSentAt: null,
      lastStatus: 'never',
      endpointConfigured: true,
      endpoint: 'https://ping.example.invalid',
    };
    await nextTick();
    expect(wrapper.text()).toContain(i18n.global.t('hello.banner.star'));
    expect(wrapper.text()).not.toContain(i18n.global.t('hello.banner.ping'));
  });

  it('asks a regular user in multi-user mode too, without the ping', async () => {
    const session = useSessionStore();
    session.multiuserEnabled = true;
    session.user = { id: 'u2', username: 'bob', isAdmin: false } as never;
    const wrapper = mountBanner();
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some((c) => String(c[0]).includes('/api/hello')),
      ).toBe(true),
    );
    useHelloStore().state = dueState;
    await nextTick();
    expect(wrapper.text()).toContain(i18n.global.t('hello.banner.star'));
    expect(wrapper.text()).toContain(i18n.global.t('hello.banner.follow'));
    // Wishes and complaints are everyone's to send, unlike the ping — and the
    // button must land on the About page's feedback block, not just render.
    const feedback = wrapper
      .findAll('a')
      .find((a) => a.text().includes(i18n.global.t('hello.banner.feedback')));
    expect(feedback?.attributes('href')).toBe('/settings/about');
    expect(wrapper.text()).not.toContain(i18n.global.t('hello.banner.ping'));
    // The telemetry state is instance consent: a regular user never reads it.
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((c) => String(c[0]).includes('/api/telemetry')),
    ).toBe(false);
  });

  it('asks nobody before there is a session to ask for', async () => {
    const session = useSessionStore();
    session.multiuserEnabled = true;
    mountBanner();
    await nextTick();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('closing it asks the server, and the card goes away', async () => {
    const wrapper = mountBanner();
    const hello = useHelloStore();
    hello.state = dueState;
    await nextTick();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...dueState,
        show: false,
        dismissedAt: '2026-10-18T00:00:00.000Z',
      }),
    } as never);
    await wrapper
      .get(`[aria-label="${i18n.global.t('hello.banner.dismiss')}"]`)
      .trigger('click');
    await vi.waitFor(() => expect(hello.show).toBe(false));
    expect(wrapper.text()).toBe('');
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((url) => url.includes('/api/hello/dismiss'))).toBe(true);
  });
});
