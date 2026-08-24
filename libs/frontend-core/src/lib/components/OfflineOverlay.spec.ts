import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import OfflineOverlay from './OfflineOverlay.vue';
import { useAvailabilityStore } from '../availability-store';

// The overlay is driven purely by availability-store state; the store's own
// probing is never started here (no `start()`), so its status refs are set
// directly and no HTTP/socket mocking is needed.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      offline: {
        startingTitle: 'Starting up',
        startingDescription: 'Waiting for the server.',
        title: 'Connection lost',
        description: 'Cannot reach the server.',
        waiting: 'Waiting for the server…',
        reconnecting: 'Trying to reconnect…',
        retryNow: 'Retry now',
        restoredTitle: 'Back online',
        restoredDescription: 'The server is responding again.',
        restored: 'Connection restored',
      },
    },
  },
});

let wrapper: VueWrapper | null = null;

const mountOverlay = (): VueWrapper => {
  wrapper = mount(OfflineOverlay, {
    global: { plugins: [i18n, createPinia()] },
    attachTo: document.body,
  });
  return wrapper;
};

// The store belongs to the pinia instance the component was mounted with; the
// component registered it, so useAvailabilityStore() resolves the same store.
const store = (): ReturnType<typeof useAvailabilityStore> =>
  useAvailabilityStore();

describe('OfflineOverlay', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows the offline card during an outage', async () => {
    mountOverlay();
    const availability = store();
    availability.everOnline = true;
    availability.status = 'offline';
    await nextTick();
    expect(document.body.textContent).toContain('Connection lost');
    expect(document.body.textContent).not.toContain('Connection restored');
  });

  it('hides immediately after the initial handshake (no restored linger)', async () => {
    mountOverlay();
    const availability = store();
    // connecting → online is the healthy first confirm, not a recovery.
    availability.everOnline = true;
    availability.status = 'online';
    await nextTick();
    expect(document.body.textContent).not.toContain('Connection restored');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('lingers in the restored state after a reconnect, then hides', async () => {
    mountOverlay();
    const availability = store();
    availability.everOnline = true;
    availability.status = 'offline';
    await nextTick();

    availability.status = 'online';
    await nextTick();
    // Success confirmation: availability wording + no retry button.
    expect(document.body.textContent).toContain('Back online');
    expect(document.body.textContent).toContain('Connection restored');
    expect(document.body.textContent).not.toContain('Retry now');

    await vi.advanceTimersByTimeAsync(2_000);
    await nextTick();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('falls back to the offline card when the connection drops mid-linger', async () => {
    mountOverlay();
    const availability = store();
    availability.everOnline = true;
    availability.status = 'offline';
    await nextTick();
    availability.status = 'online';
    await nextTick();
    expect(document.body.textContent).toContain('Connection restored');

    availability.status = 'offline';
    await nextTick();
    expect(document.body.textContent).toContain('Connection lost');
    expect(document.body.textContent).not.toContain('Connection restored');

    // The cancelled linger timer must not hide the overlay while offline.
    await vi.advanceTimersByTimeAsync(5_000);
    await nextTick();
    expect(document.body.textContent).toContain('Connection lost');
  });
});
