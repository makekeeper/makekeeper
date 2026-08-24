import { defineStore } from 'pinia';
import { ref, computed, type ComputedRef } from 'vue';
import { usePluginsStore } from './plugins-store';
import { isUxFeatureAdvancedByDefault } from './registry';

// Client-side UI preferences: the simple/advanced UX mode plus per-feature
// overrides. localStorage-backed (same lifetime as the theme toggle) — the
// backend is mode-unaware, so switching modes never touches data or API
// behavior; it is purely a display lens over the same state.
export type UxMode = 'simple' | 'advanced';

// Three-position theme control. `system` follows the OS `prefers-color-scheme`
// live; `light`/`dark` pin a fixed appearance. `system` is the default for a
// fresh install (no stored key), matching the marketing site's behaviour.
export type ThemeMode = 'light' | 'dark' | 'system';

// Colour schemes (#236) — the second, orthogonal appearance axis: a scheme
// re-tints the accent (`brand.*`) and the dark surface ramp (`dark.*`) via
// CSS variables (themes.css) while light/dark keeps meaning what it means.
// `default` is the pre-#236 palette and renders with NO data-scheme attribute,
// so markup saved by older tooling stays byte-identical.
export const COLOR_SCHEMES = [
  'default',
  'violet',
  'teal',
  'sunset',
  'orchid',
  'graphite',
] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export function isColorScheme(value: unknown): value is ColorScheme {
  return COLOR_SCHEMES.some((scheme) => scheme === value);
}

const MODE_KEY = 'uxMode';
const OVERRIDES_KEY = 'uxFeatureOverrides';
const THEME_KEY = 'theme';
const SCHEME_KEY = 'colorScheme';
const SIDEBAR_KEY = 'sidebar';
const OVERFLOW_COACH_KEY = 'headerOverflowCoached';
const CHAT_WIDTH_KEY = 'chatWidth';
const NAV_EXPANDED_KEY = 'navExpanded';

// The chat column's width (#283). The default is today's `w-96` to the pixel —
// an instance that never touches the handle must look exactly as it did.
export const CHAT_WIDTH_DEFAULT = 384;
// The floor is about the chat staying a chat: below this the message bubbles,
// the composer's toolbar and the session switcher stop fitting side by side.
// The ceiling is about the panel staying a panel — past ~2× the default it is
// no longer a column beside the app, and the content area is the loser.
export const CHAT_WIDTH_MIN = 320;
export const CHAT_WIDTH_MAX = 768;
// What the content area keeps whatever the stored width says. A narrower
// viewport clamps the column for DISPLAY only (see `chatWidth`), so coming back
// to a wide screen restores the width the user chose.
const CONTENT_MIN = 360;

function clampChatWidth(value: number): number {
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(value)));
}

// Anything unreadable — missing, non-numeric, a value from a future version with
// different bounds — resolves to the default rather than failing the boot.
function readStoredChatWidth(): number {
  const raw = Number(localStorage.getItem(CHAT_WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0
    ? clampChatWidth(raw)
    : CHAT_WIDTH_DEFAULT;
}

// Legacy stored values (`'light'` / `'dark'`) stay valid — no migration; only a
// missing/foreign value falls through to `system`.
function readStoredTheme(): ThemeMode {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

// Guarded so the store stays usable where `matchMedia` is absent (jsdom/tests):
// a null query resolves `system` to light rather than throwing.
function prefersDarkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'system') return prefersDarkQuery()?.matches ?? false;
  return mode === 'dark';
}

// The single place `.dark` is toggled at runtime; the inline anti-FOUC script in
// index.html performs the same resolution once before Vue mounts.
function applyHtmlTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark);
}

// Unknown/missing stored value falls back to `default` — same tolerance as
// `readStoredTheme`, so a value written by a future version never breaks boot.
function readStoredScheme(): ColorScheme {
  const raw = localStorage.getItem(SCHEME_KEY);
  return isColorScheme(raw) ? raw : 'default';
}

// The single place `data-scheme` is toggled at runtime; the inline anti-FOUC
// script in index.html performs the same resolution once before Vue mounts.
// `default` REMOVES the attribute instead of naming itself, so the :root block
// in themes.css applies without a matching selector per scheme.
function applyHtmlScheme(scheme: ColorScheme): void {
  const root = document.documentElement;
  if (scheme === 'default') {
    delete root.dataset['scheme'];
  } else {
    root.dataset['scheme'] = scheme;
  }
  syncThemeColorMeta();
}

// The browser-chrome colour (<meta name="theme-color">) follows the active
// scheme's accent. Read back from the cascade rather than a TS copy of the
// palette — themes.css stays the only place a scheme's values live. Guarded:
// jsdom has no meta / no real cascade, and an unresolved var yields ''.
function syncThemeColorMeta(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!(meta instanceof HTMLMetaElement)) return;
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue('--mk-brand-500')
    .trim();
  if (!channels) return;
  meta.content = `rgb(${channels})`;
}

// Deliberately NOT synced here: the favicon (#260). The browser chrome above is
// the app's surface bleeding outward, so it follows the scheme; the tab icon is
// the product's identity among other products' identities, and it stays on the
// brand's own colour whatever accent this user picked. It is a static file,
// generated by tools/brand/generate-brand-assets.mjs.

// The rail's open/collapsed state (#268), stored by name rather than as a
// boolean string so the key reads for itself in devtools. Anything else —
// missing, foreign, a value from a future version — means the default: open.
function readStoredSidebarOpen(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) !== 'collapsed';
}

// Which nav entries the user has explicitly opened or closed (#288), keyed by
// the entry's path. An entry the user never touched is ABSENT rather than
// false — the sidebar then decides from the active route, so landing on a
// group opens its parent on a fresh install.
function readStoredNavExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_EXPANDED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

function readStoredMode(): UxMode | null {
  const raw = localStorage.getItem(MODE_KEY);
  return raw === 'simple' || raw === 'advanced' ? raw : null;
}

function readStoredOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  // Simple is the product's default posture — a missing key means a fresh
  // install (or first run after the mode shipped), which starts simple.
  const storedMode = readStoredMode();
  const uxMode = ref<UxMode>(storedMode ?? 'simple');
  // True only on the very first run, so the shell can show a one-time hint
  // about where the toggle lives.
  const isFirstRun = ref(storedMode === null);

  const featureOverrides = ref<Record<string, boolean>>(readStoredOverrides());

  // Theme lives here (§5.3) instead of an App.vue ref. `resolvedIsDark` is the
  // effective appearance after collapsing `system` against the OS preference.
  const themeMode = ref<ThemeMode>(readStoredTheme());
  const resolvedIsDark = ref<boolean>(resolveIsDark(themeMode.value));
  applyHtmlTheme(resolvedIsDark.value);

  // While in `system`, re-apply live when the OS theme flips — the omission most
  // hand-rolled toggles make. The listener lives for the store's lifetime (a
  // singleton), so there is nothing to tear down per component.
  const systemQuery = prefersDarkQuery();
  systemQuery?.addEventListener('change', (e: MediaQueryListEvent): void => {
    if (themeMode.value !== 'system') return;
    resolvedIsDark.value = e.matches;
    applyHtmlTheme(resolvedIsDark.value);
  });

  // Scheme lives beside the theme (#236): same lifetime (localStorage), same
  // apply seam (<html> attributes), independent axis.
  const colorScheme = ref<ColorScheme>(readStoredScheme());
  applyHtmlScheme(colorScheme.value);

  const setColorScheme = (scheme: ColorScheme): void => {
    colorScheme.value = scheme;
    localStorage.setItem(SCHEME_KEY, scheme);
    applyHtmlScheme(scheme);
  };

  // Show a scheme WITHOUT choosing it: the picker repaints the whole app while
  // the pointer (or the keyboard highlight) travels its list, so the choice is
  // made on the real UI rather than on a 20px swatch. Deliberately touches only
  // the <html> attribute — `colorScheme` and localStorage keep holding what the
  // user actually picked, which is what makes `null` a complete undo, and what
  // keeps the picker's own check mark on the chosen row while another previews.
  const previewColorScheme = (scheme: ColorScheme | null): void => {
    applyHtmlScheme(scheme ?? colorScheme.value);
  };

  // The sidebar's state belongs with the theme for the same reason (§5.3): it
  // is a display preference that outlives the session. Read at store setup, so
  // the shell's FIRST render already has the stored width — resolving it later
  // (an onMounted read) would animate the rail shut in front of the user, the
  // `aside` carrying a 300ms width transition.
  const isSidebarOpen = ref<boolean>(readStoredSidebarOpen());

  const setSidebarOpen = (open: boolean): void => {
    isSidebarOpen.value = open;
    localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'collapsed');
  };

  // Expansion state of the nav entries that have runtime sub-items (#288).
  // Read at store setup for the same reason the rail's own state is: the first
  // render must already be right, not corrected a frame later.
  const navExpanded = ref<Record<string, boolean>>(readStoredNavExpanded());

  const setNavExpanded = (path: string, expanded: boolean): void => {
    navExpanded.value = { ...navExpanded.value, [path]: expanded };
    localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify(navExpanded.value));
  };

  // Persisted at every width on purpose: below `md` the header's burger is the
  // control (the rail's own is hidden while open), so a stored "collapsed" is
  // never a state a phone user cannot undo.
  const toggleSidebar = (): void => setSidebarOpen(!isSidebarOpen.value);

  // The chat column's width (#283) — same lifetime and same setup-time read as
  // the rail above, and for the same reason: the panel carries a 300ms
  // transition, so a width resolved after mount would slide the column across
  // the screen in front of the user.
  const storedChatWidth = ref<number>(readStoredChatWidth());

  // The viewport is the other half of the answer. Tracked as state rather than
  // read per call so the clamp below is reactive; the listener lives for the
  // store's lifetime (a singleton), like the `prefers-color-scheme` one.
  const viewportWidth = ref<number>(
    typeof window !== 'undefined' ? window.innerWidth : 0,
  );
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      viewportWidth.value = window.innerWidth;
    });
  }

  // How wide the column may be RIGHT NOW: the stored ceiling, further limited by
  // what the current viewport can spare. Never below the floor — on a viewport
  // too narrow for both, the chat wins and the content area scrolls, which is
  // what the panel already did at a fixed 384px.
  const chatWidthMax = computed<number>(() =>
    viewportWidth.value > 0
      ? Math.max(
          CHAT_WIDTH_MIN,
          Math.min(CHAT_WIDTH_MAX, viewportWidth.value - CONTENT_MIN),
        )
      : CHAT_WIDTH_MAX,
  );

  // The width to render. A stored value too big for this screen is clamped for
  // display only — the stored number is a preference, not a promise, and going
  // back to a wide screen must restore it rather than a shrunken souvenir.
  const chatWidth = computed<number>(() =>
    Math.min(storedChatWidth.value, chatWidthMax.value),
  );

  const setChatWidth = (px: number): void => {
    const next = clampChatWidth(px);
    storedChatWidth.value = next;
    localStorage.setItem(CHAT_WIDTH_KEY, String(next));
  };

  // One-time coachmark for the header's overflow (#274): shown the first time
  // a control ever collapses into the avatar menu, then never again — the
  // permanent affordance from then on is the counter badge. Persisted, so a
  // reload does not re-teach.
  const headerOverflowCoached = ref<boolean>(
    localStorage.getItem(OVERFLOW_COACH_KEY) === '1',
  );
  const markHeaderOverflowCoached = (): void => {
    headerOverflowCoached.value = true;
    localStorage.setItem(OVERFLOW_COACH_KEY, '1');
  };

  const setTheme = (mode: ThemeMode): void => {
    themeMode.value = mode;
    localStorage.setItem(THEME_KEY, mode);
    resolvedIsDark.value = resolveIsDark(mode);
    applyHtmlTheme(resolvedIsDark.value);
  };

  const setMode = (mode: UxMode): void => {
    uxMode.value = mode;
    isFirstRun.value = false;
    localStorage.setItem(MODE_KEY, mode);
  };

  // Marks the first-run hint as consumed without changing the mode.
  const acknowledgeFirstRun = (): void => {
    if (!isFirstRun.value) return;
    isFirstRun.value = false;
    localStorage.setItem(MODE_KEY, uxMode.value);
  };

  // `true` shows the feature inside simple mode, `false` hides it there;
  // `null` clears the override back to the manifest default (#269).
  const setFeatureOverride = (key: string, value: boolean | null): void => {
    if (value === null) {
      const next = { ...featureOverrides.value };
      delete next[key];
      featureOverrides.value = next;
    } else {
      featureOverrides.value = { ...featureOverrides.value, [key]: value };
    }
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(featureOverrides.value));
  };

  const clearFeatureOverrides = (): void => {
    featureOverrides.value = {};
    localStorage.removeItem(OVERRIDES_KEY);
  };

  // The single visibility rule every gated surface reads: pro (advanced) shows
  // all; simple shows a feature by the user's override, falling back to the
  // manifest's declared default — so the split ships as INITIAL settings only,
  // and every feature can be pulled into simple mode or pushed out (#269).
  // With the `uxmode` plugin disabled the mode machinery is off entirely and
  // every surface is visible — nothing may be hidden the user has no toggle
  // for.
  const isFeatureVisible = (key: string): boolean => {
    if (!usePluginsStore().isEnabled('uxmode')) return true;
    if (uxMode.value === 'advanced') return true;
    return featureOverrides.value[key] ?? !isUxFeatureAdvancedByDefault(key);
  };

  // "The simple lens is actually in force" — the mode alone is not enough,
  // because with the `uxmode` plugin disabled the machinery is off and nothing
  // may be hidden. Surfaces that hide whole entries (nav, hub tabs, dashboard
  // sections) read this instead of re-deriving the pair, so they can't drift.
  const isSimpleModeActive = computed<boolean>(
    () => usePluginsStore().isEnabled('uxmode') && uxMode.value === 'simple',
  );

  return {
    uxMode,
    isSimpleModeActive,
    isFirstRun,
    featureOverrides,
    themeMode,
    resolvedIsDark,
    colorScheme,
    isSidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    navExpanded,
    setNavExpanded,
    chatWidth,
    chatWidthMax,
    setChatWidth,
    headerOverflowCoached,
    markHeaderOverflowCoached,
    setMode,
    setTheme,
    setColorScheme,
    previewColorScheme,
    acknowledgeFirstRun,
    setFeatureOverride,
    clearFeatureOverrides,
    isFeatureVisible,
  };
});

// Convenience composable for views: computed mode flags plus the visibility
// predicate. Views gate strictly on `isFeatureVisible('<pluginId>.<feature>')`
// — never on the raw mode — so per-feature overrides always apply.
export function useUxMode(): {
  isSimple: ComputedRef<boolean>;
  isAdvanced: ComputedRef<boolean>;
  setMode: (mode: UxMode) => void;
  isFeatureVisible: (key: string) => boolean;
  setFeatureOverride: (key: string, value: boolean | null) => void;
} {
  const store = usePreferencesStore();
  return {
    isSimple: computed(() => store.uxMode === 'simple'),
    isAdvanced: computed(() => store.uxMode === 'advanced'),
    setMode: store.setMode,
    isFeatureVisible: store.isFeatureVisible,
    setFeatureOverride: store.setFeatureOverride,
  };
}
