import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePreferencesStore } from './preferences-store';
import { registerPlugin } from './registry';

// Controllable `matchMedia` double: exposes a setter that flips `matches` and
// notifies registered `change` listeners, so the "system follows the OS live"
// path is testable in jsdom (which ships no matchMedia).
function stubMatchMedia(initialDark: boolean): {
  setSystemDark: (dark: boolean) => void;
} {
  // The store's `change` handler only reads `.matches`, so the double narrows the
  // listener to that field — this keeps the fabricated event honest (`satisfies`,
  // no naked `as`) instead of pretending to be a full MediaQueryListEvent.
  type SystemChange = Pick<MediaQueryListEvent, 'matches'>;
  const listeners = new Set<(e: SystemChange) => void>();
  const mql = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: SystemChange) => void): void => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: (e: SystemChange) => void): void => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    setSystemDark: (dark: boolean): void => {
      mql.matches = dark;
      listeners.forEach((cb) => cb({ matches: dark } satisfies SystemChange));
    },
  };
}

const htmlIsDark = (): boolean =>
  document.documentElement.classList.contains('dark');

describe('preferences store — theme', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to system and follows the OS preference when nothing is stored', () => {
    stubMatchMedia(true);
    const store = usePreferencesStore();
    expect(store.themeMode).toBe('system');
    expect(store.resolvedIsDark).toBe(true);
    expect(htmlIsDark()).toBe(true);
  });

  it('honours a legacy stored "light" value without migration', () => {
    stubMatchMedia(true);
    localStorage.setItem('theme', 'light');
    const store = usePreferencesStore();
    expect(store.themeMode).toBe('light');
    expect(store.resolvedIsDark).toBe(false);
    expect(htmlIsDark()).toBe(false);
  });

  it('honours a legacy stored "dark" value regardless of the OS preference', () => {
    stubMatchMedia(false);
    localStorage.setItem('theme', 'dark');
    const store = usePreferencesStore();
    expect(store.resolvedIsDark).toBe(true);
    expect(htmlIsDark()).toBe(true);
  });

  it('setTheme persists the choice and re-applies the html class', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setTheme('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(htmlIsDark()).toBe(true);
    store.setTheme('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(htmlIsDark()).toBe(false);
  });

  it('re-applies live when the OS theme flips while in system mode', () => {
    const media = stubMatchMedia(false);
    const store = usePreferencesStore();
    expect(htmlIsDark()).toBe(false);
    media.setSystemDark(true);
    expect(store.resolvedIsDark).toBe(true);
    expect(htmlIsDark()).toBe(true);
  });

  it('ignores OS theme changes once a fixed mode is pinned', () => {
    const media = stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setTheme('light');
    media.setSystemDark(true);
    expect(store.resolvedIsDark).toBe(false);
    expect(htmlIsDark()).toBe(false);
  });
});

describe('preferences store — colour scheme (#236)', () => {
  const htmlScheme = (): string | undefined =>
    document.documentElement.dataset['scheme'];

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete document.documentElement.dataset['scheme'];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to `default` and sets NO data-scheme attribute', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    expect(store.colorScheme).toBe('default');
    expect(htmlScheme()).toBeUndefined();
  });

  it('restores a stored scheme onto <html> at boot', () => {
    stubMatchMedia(false);
    localStorage.setItem('colorScheme', 'teal');
    const store = usePreferencesStore();
    expect(store.colorScheme).toBe('teal');
    expect(htmlScheme()).toBe('teal');
  });

  it('falls back to `default` on an unknown stored value', () => {
    stubMatchMedia(false);
    localStorage.setItem('colorScheme', 'aurora-borealis');
    const store = usePreferencesStore();
    expect(store.colorScheme).toBe('default');
    expect(htmlScheme()).toBeUndefined();
  });

  it('setColorScheme persists and toggles the attribute both ways', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setColorScheme('violet');
    expect(localStorage.getItem('colorScheme')).toBe('violet');
    expect(htmlScheme()).toBe('violet');
    // Back to default: the attribute must be REMOVED, not set to 'default',
    // so the :root block in themes.css applies unshadowed.
    store.setColorScheme('default');
    expect(localStorage.getItem('colorScheme')).toBe('default');
    expect(htmlScheme()).toBeUndefined();
  });

  it('previews a scheme on <html> without choosing it', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setColorScheme('violet');

    store.previewColorScheme('sunset');
    expect(htmlScheme()).toBe('sunset');
    // The stored choice is untouched — this is a look, not a decision.
    expect(store.colorScheme).toBe('violet');
    expect(localStorage.getItem('colorScheme')).toBe('violet');

    store.previewColorScheme(null);
    expect(htmlScheme()).toBe('violet');
  });

  it('ends a preview of `default` back on the stored scheme', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setColorScheme('teal');
    // Previewing the default REMOVES the attribute, exactly as choosing it
    // would — otherwise the preview shows a palette the choice would not.
    store.previewColorScheme('default');
    expect(htmlScheme()).toBeUndefined();
    store.previewColorScheme(null);
    expect(htmlScheme()).toBe('teal');
  });

  it('scheme and theme are independent axes', () => {
    stubMatchMedia(false);
    const store = usePreferencesStore();
    store.setColorScheme('sunset');
    store.setTheme('dark');
    expect(htmlScheme()).toBe('sunset');
    expect(htmlIsDark()).toBe(true);
    store.setTheme('light');
    expect(htmlScheme()).toBe('sunset');
  });
});

// The simple/pro lens (#269): the manifests set INITIAL defaults only; the
// user's per-feature override wins in both directions, and pro mode (or a
// disabled uxmode plugin) shows everything regardless.
describe('preferences store — ux feature visibility (#269)', () => {
  registerPlugin({
    id: 'lens',
    nameKey: 'plugins.lens.name',
    routes: [],
    messages: {},
    navigation: [],
    uxFeatures: [
      // Absent `defaultAdvanced` = a pro surface — pre-#269 declarations keep
      // their meaning unchanged.
      { key: 'lens.pro', labelKey: 'lens.ux.pro' },
      { key: 'lens.basic', labelKey: 'lens.ux.basic', defaultAdvanced: false },
    ],
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    stubMatchMedia(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('simple mode falls back to the manifest default', () => {
    const store = usePreferencesStore();
    expect(store.uxMode).toBe('simple');
    expect(store.isFeatureVisible('lens.pro')).toBe(false);
    expect(store.isFeatureVisible('lens.basic')).toBe(true);
  });

  it('treats an undeclared key as a pro surface (pre-#269 semantics)', () => {
    expect(usePreferencesStore().isFeatureVisible('ghost.key')).toBe(false);
  });

  it('an override wins over the default, in both directions', () => {
    const store = usePreferencesStore();
    store.setFeatureOverride('lens.pro', true);
    store.setFeatureOverride('lens.basic', false);
    expect(store.isFeatureVisible('lens.pro')).toBe(true);
    expect(store.isFeatureVisible('lens.basic')).toBe(false);
    // Clearing the override restores the manifest default.
    store.setFeatureOverride('lens.pro', null);
    expect(store.isFeatureVisible('lens.pro')).toBe(false);
  });

  it('pro mode shows everything, overrides included', () => {
    const store = usePreferencesStore();
    store.setFeatureOverride('lens.basic', false);
    store.setMode('advanced');
    expect(store.isFeatureVisible('lens.basic')).toBe(true);
    expect(store.isFeatureVisible('lens.pro')).toBe(true);
  });
});

describe('preferences store — sidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    stubMatchMedia(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts open when nothing is stored', () => {
    expect(usePreferencesStore().isSidebarOpen).toBe(true);
  });

  it('comes back collapsed after a reload', () => {
    usePreferencesStore().toggleSidebar();
    expect(localStorage.getItem('sidebar')).toBe('collapsed');

    // A fresh store instance is what a reload amounts to: the value has to be
    // there at SETUP time, before the first render, or the rail animates shut
    // in front of the user.
    setActivePinia(createPinia());
    expect(usePreferencesStore().isSidebarOpen).toBe(false);
  });

  it('comes back open after being expanded again', () => {
    const store = usePreferencesStore();
    store.setSidebarOpen(false);
    store.setSidebarOpen(true);
    expect(localStorage.getItem('sidebar')).toBe('open');

    setActivePinia(createPinia());
    expect(usePreferencesStore().isSidebarOpen).toBe(true);
  });

  it('falls back to open on a value it does not recognise', () => {
    localStorage.setItem('sidebar', 'half');
    expect(usePreferencesStore().isSidebarOpen).toBe(true);
  });
});

describe('preferences store — chat column width (#283)', () => {
  // jsdom reports 1024px, which leaves room for the full 768 ceiling only if
  // the content floor allows it — the viewport clamp is exercised explicitly
  // below by moving `innerWidth`.
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    stubMatchMedia(false);
    window.innerWidth = 1600;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to exactly the width the panel shipped with', () => {
    expect(usePreferencesStore().chatWidth).toBe(384);
  });

  it('comes back at the chosen width after a reload', () => {
    usePreferencesStore().setChatWidth(520);
    expect(localStorage.getItem('chatWidth')).toBe('520');

    // Read at SETUP, like the sidebar — a width resolved later slides the
    // column across the screen (the panel carries a 300ms transition).
    setActivePinia(createPinia());
    expect(usePreferencesStore().chatWidth).toBe(520);
  });

  it('holds the bounds against a value from anywhere', () => {
    const store = usePreferencesStore();
    store.setChatWidth(10);
    expect(store.chatWidth).toBe(320);
    store.setChatWidth(5000);
    expect(store.chatWidth).toBe(768);
  });

  it('falls back to the default on an unreadable stored value', () => {
    localStorage.setItem('chatWidth', 'wide');
    expect(usePreferencesStore().chatWidth).toBe(384);
  });

  it('clamps to the viewport for display without spending the stored width', () => {
    const store = usePreferencesStore();
    store.setChatWidth(760);

    // 900px viewport − a 360px content floor = 540px is all the column may take
    // here; the stored number stays 760.
    window.innerWidth = 900;
    window.dispatchEvent(new Event('resize'));
    expect(store.chatWidthMax).toBe(540);
    expect(store.chatWidth).toBe(540);
    expect(localStorage.getItem('chatWidth')).toBe('760');

    // Back on a wide screen the chosen width returns — a preference, not a
    // promise the small screen got to overwrite.
    window.innerWidth = 1600;
    window.dispatchEvent(new Event('resize'));
    expect(store.chatWidth).toBe(760);
  });

  it('keeps the floor even when the viewport cannot afford it', () => {
    const store = usePreferencesStore();
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));
    expect(store.chatWidthMax).toBe(320);
  });
});
