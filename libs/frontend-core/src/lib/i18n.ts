import {
  parseAppLocale,
  type AppLocale,
  type PluginLocaleMessages,
} from '@makekeeper/plugin-contract';
import { getActivePlugins } from './registry';

type LocaleTree = Record<string, unknown>;

// Where every surface keeps the interface language (#211). It lives here rather
// than in the app shell because a phone can be handed a language by a QR it
// scans from INSIDE a plugin view, and a plugin cannot import the shell.
export const LOCALE_STORAGE_KEY = 'locale';

// Reading and writing it are a pair, and both are wrapped once: storage throws
// in Safari's private mode, and a language is not worth taking the app down for.
export function readStoredLocale(): AppLocale | null {
  try {
    return parseAppLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Nothing to do — the language still applies to this visit.
  }
}

// Recursively merges plugin locale trees into the base tree. Objects merge
// deeply so several plugins may each contribute keys to a shared section
// (e.g. `nav`, `routeTitles`); leaf values from later sources win.
function deepMerge(base: LocaleTree, incoming: LocaleTree): LocaleTree {
  for (const [key, value] of Object.entries(incoming)) {
    const existing = base[key];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      base[key] = deepMerge(existing as LocaleTree, value as LocaleTree);
    } else {
      base[key] = value;
    }
  }
  return base;
}

// Builds the full vue-i18n `messages` map by folding every registered plugin's
// locale bundle onto the app's core messages. Call AFTER the plugin loader has
// run so all plugins are registered.
export function buildMessages(
  coreMessages: Record<string, LocaleTree>,
): Record<string, LocaleTree> {
  const merged: Record<string, LocaleTree> = {};
  for (const [locale, tree] of Object.entries(coreMessages)) {
    merged[locale] = deepMerge({}, tree);
  }
  for (const plugin of getActivePlugins()) {
    mergePluginMessages(merged, plugin.messages);
  }
  return merged;
}

function mergePluginMessages(
  target: Record<string, LocaleTree>,
  messages: PluginLocaleMessages,
): void {
  for (const [locale, tree] of Object.entries(messages)) {
    target[locale] = deepMerge(target[locale] ?? {}, tree as LocaleTree);
  }
}
