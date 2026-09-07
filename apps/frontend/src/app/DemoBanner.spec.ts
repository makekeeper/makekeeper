import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import router from '../router';
import { i18n } from '../i18n';
import DemoBanner from './DemoBanner.vue';
import { useSessionStore } from '@makekeeper/frontend-core';
import { useDemoStore } from '../stores/demo';

// The banner is what tells a first-time user that the workshop they are looking
// at was written for them. Two things must hold: it appears exactly while the
// demo rows exist, and dismissing it is remembered — a notice that comes back
// on every navigation is worse than no notice.
// One pinia per test, created in `beforeEach` and made active there, so a test
// can drive the session store the component actually reads.
let pinia = createPinia();

const mountBanner = () =>
  mount(DemoBanner, {
    global: { plugins: [router, i18n, pinia] },
  });

describe('DemoBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          active: true,
          seededAt: '2026-09-06T00:00:00.000Z',
          clearedAt: null,
        }),
      }),
    );
  });

  // Regression: the banner used to ask once, on mount. On a multiuser instance
  // that call happens before anyone has signed in, comes back 401, and the
  // notice never appeared again for the session that followed.
  it('asks the server only once there is a session to ask for', async () => {
    const session = useSessionStore();
    session.multiuserEnabled = true;
    mountBanner();
    await nextTick();
    expect(fetch).not.toHaveBeenCalled();

    session.user = { id: 'u1', username: 'admin', isAdmin: true } as never;
    await nextTick();
    await nextTick();
    expect(fetch).toHaveBeenCalled();
  });

  it('stays hidden while the instance holds no demo data', async () => {
    const wrapper = mountBanner();
    const demo = useDemoStore();
    demo.status = { active: false, seededAt: null, clearedAt: null };
    await nextTick();
    expect(wrapper.text()).toBe('');
  });

  // The install this feature exists for has no accounts at all: gating the
  // clear action on an admin ROLE hid it from everyone in single-user mode.
  it('offers the removal on a single-user instance, where nobody is "admin"', async () => {
    const wrapper = mountBanner();
    const demo = useDemoStore();
    demo.status = { active: true, seededAt: 'now', clearedAt: null };
    await nextTick();
    expect(wrapper.text()).toContain(i18n.global.t('demo.banner.clear'));
  });

  it('announces the demo data and remembers being dismissed', async () => {
    const wrapper = mountBanner();
    const demo = useDemoStore();
    demo.status = { active: true, seededAt: 'now', clearedAt: null };
    await nextTick();
    expect(wrapper.text()).toContain(i18n.global.t('demo.banner.title'));

    demo.dismiss();
    await nextTick();
    expect(wrapper.text()).toBe('');
    expect(localStorage.getItem('demoBannerDismissed')).toBe('1');

    // A fresh store in a new page load reads that back.
    setActivePinia(createPinia());
    expect(useDemoStore().showBanner).toBe(false);
  });
});
