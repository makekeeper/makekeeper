import { describe, it, expect } from 'vitest';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import router from '../router';
import { mount } from '@vue/test-utils';
import {
  useAvailabilityStore,
  useAgentDataChanged,
} from '@makekeeper/frontend-core';
import App from './App.vue';
import { i18n } from '../i18n';

describe('App', () => {
  it('renders properly', async () => {
    const wrapper = mount(App, {
      global: { plugins: [router, i18n, createPinia()] },
    });
    await router.isReady();
    expect(wrapper.text()).toContain('MakeKeeper');
  });

  // Regression for the "page reloads on reconnect" report (#64): once content
  // is live, a backend recovery must be a strict no-op — in particular it must
  // NOT bump the agent-data-changed signal, whose refetch storm wiped
  // in-progress edits.
  it('does nothing on a mid-session reconnect', async () => {
    mount(App, {
      global: { plugins: [router, i18n, createPinia()] },
    });
    await router.isReady();
    const availability = useAvailabilityStore();
    // Healthy first confirm reveals the content (contentReady = true).
    availability.status = 'online';
    await nextTick();
    const dataChanged = useAgentDataChanged();
    const before = dataChanged.value;
    // Outage + recovery.
    availability.status = 'offline';
    availability.recoveryTick += 1;
    availability.status = 'online';
    await nextTick();
    expect(dataChanged.value).toBe(before);
  });
});
