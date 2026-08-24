import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import {
  setStoredToken,
  useSessionStore,
  usePluginsStore,
} from '@makekeeper/frontend-core';
import type { ApiInfo, PluginPublic } from '@makekeeper/plugin-contract';
import ApiSection from './ApiSection.vue';
import en from '../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const INFO: ApiInfo = {
  baseUrl: 'https://mk.example.com',
  baseUrlSource: 'override',
  tokenTtlSeconds: 7 * 24 * 3600,
};

// The one row the plugins store needs for the "other tokens" gate: the
// external-plugins host, switched off.
const DISABLED_EXTERNAL: PluginPublic = {
  id: 'external',
  nameKey: 'plugins.external.name',
  descriptionKey: 'plugins.external.description',
  version: '1.0.0',
  icon: 'Blocks',
  navigation: [],
  isEnabled: false,
  instanceEnabled: false,
};

const render = async (
  setup: (options: {
    session: ReturnType<typeof useSessionStore>;
    plugins: ReturnType<typeof usePluginsStore>;
  }) => void = () => undefined,
) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  setup({ session: useSessionStore(), plugins: usePluginsStore() });
  const wrapper = mount(ApiSection, {
    global: { plugins: [i18n, pinia], stubs: { RouterLink: RouterLinkStub } },
  });
  await flushPromises();
  return wrapper;
};

// The section exists so an owner never has to read the source to script
// against their own instance (#282): the address the SERVER publishes, the
// docs, and the token — the last one only when asked for, and only when there
// is one.
describe('ApiSection (#282)', () => {
  beforeEach(() => {
    setStoredToken('jwt-value');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => INFO })),
    );
  });

  afterEach(() => {
    setStoredToken(null);
    vi.unstubAllGlobals();
  });

  // The browser is the only party that knows the address intact, port and all,
  // so the section tells the server rather than letting it guess (#282).
  it('sends the address this browser is on', async () => {
    await render();
    const url = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(url)).toContain(
      `origin=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it('shows the server-resolved base URL and where it came from', async () => {
    const wrapper = await render();
    expect(wrapper.text()).toContain('https://mk.example.com');
    expect(wrapper.text()).toContain(en.settings.api.endpoint.source.override);
  });

  it('names the request headers as the source when there is no override', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...INFO, baseUrlSource: 'request' }),
      })),
    );
    const wrapper = await render();
    expect(wrapper.text()).toContain(en.settings.api.endpoint.source.request);
  });

  it('links the docs on the published origin, not the browser origin', async () => {
    const wrapper = await render();
    const docs = wrapper
      .findAll('a')
      .find((a) => a.attributes('href')?.endsWith('/api/docs'));
    expect(docs?.attributes('href')).toBe('https://mk.example.com/api/docs');
  });

  // Never rendered unasked — it must not ride along into a screenshot.
  it('keeps the token hidden until it is asked for', async () => {
    const wrapper = await render(({ session }) => {
      session.multiuserEnabled = true;
    });
    expect(wrapper.text()).not.toContain('jwt-value');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === en.settings.api.token.reveal)
      ?.trigger('click');
    expect(wrapper.text()).toContain('jwt-value');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === en.settings.api.token.hide)
      ?.trigger('click');
    expect(wrapper.text()).not.toContain('jwt-value');
  });

  // Only the address comes from the endpoint: a failed request must not take
  // the token — which the browser holds by itself — down with it.
  it('keeps the token block when the address cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    const wrapper = await render(({ session }) => {
      session.multiuserEnabled = true;
    });
    expect(wrapper.text()).toContain(en.settings.api.token.reveal);
    expect(wrapper.text()).toContain(en.settings.api.token.facts.sessionKey);
    // The command cannot be written without the address, so it stays away.
    expect(wrapper.text()).not.toContain('/api/auth/login');
  });

  it('states the lifetime and the caveats that cost an hour of debugging', async () => {
    const wrapper = await render(({ session }) => {
      session.multiuserEnabled = true;
    });
    expect(wrapper.text()).toContain('7 days');
    expect(wrapper.text()).toContain(en.settings.api.token.facts.sessionKey);
  });

  // With the overlay off there is no token to look for, and telling someone to
  // find one they cannot have is the confusion this page exists to end.
  it('replaces the token block with "no token needed" when auth is off', async () => {
    const wrapper = await render();
    expect(wrapper.text()).toContain(en.settings.api.token.noAuth);
    expect(wrapper.text()).not.toContain(en.settings.api.token.reveal);
    expect(wrapper.text()).not.toContain(en.settings.api.obtain.title);
    // The address and the docs still belong to everyone.
    expect(wrapper.text()).toContain('https://mk.example.com');
  });

  it('interpolates this instance into the login command', async () => {
    const wrapper = await render(({ session }) => {
      session.multiuserEnabled = true;
    });
    expect(wrapper.text()).toContain('https://mk.example.com/api/auth/login');
    expect(wrapper.text()).toContain('YOUR_LOGIN');
  });

  it('points at the other family of tokens only while that plugin is on', async () => {
    const on = await render();
    expect(on.text()).toContain(en.settings.api.otherTokens.title);

    const off = await render(({ plugins }) => {
      plugins.plugins = [DISABLED_EXTERNAL];
    });
    expect(off.text()).not.toContain(en.settings.api.otherTokens.title);
  });
});
