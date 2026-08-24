import {
  DEFAULT_APP_LOCALE,
  LOCALE_PARAM,
  parseAppLocale,
  type AppLocale,
} from '@makekeeper/plugin-contract';
import { readStoredLocale, writeStoredLocale } from '@makekeeper/frontend-core';

// Which language this browser starts in (#211).
//
// Three sources, in this order, and the order is the whole design:
//
// 1. **The URL.** A phone reaches this app through a QR its owner produced on
//    the desktop, and that QR carries the desktop's language. It wins because it
//    is the only source that knows anything about the person rather than about
//    the device — and it is read HERE, before the app mounts, so the first frame
//    is already right. It is also PERSISTED: an installed app relaunches at `/m`
//    with no parameter, and the stored value is all that survives.
// 2. **What this browser stored** — the switcher's own value, or a previous
//    handoff. A later handoff overwrites it deliberately: someone scanning a QR
//    is holding the phone and means it.
// 3. **The browser's own languages.** Better than a hardcoded English for a
//    phone nobody ever told anything, and for a fresh instance whose operator
//    never touched the switcher.
//
// Its own module because it is the one piece here with branches, and none of
// them are visible to a type checker.

// Everything about the browser this needs, so the rules above can be exercised
// without one. The real call site passes the globals.
export interface LocaleEnvironment {
  search: string;
  readStored(): AppLocale | null;
  writeStored(locale: AppLocale): void;
  languages: readonly string[];
}

export function resolveInitialLocale(env: LocaleEnvironment): AppLocale {
  const handed = parseAppLocale(
    new URLSearchParams(env.search).get(LOCALE_PARAM),
  );
  if (handed) {
    // Remember it, or the next launch of the installed app — which starts from
    // its `start_url`, without the parameter — is back to square one.
    env.writeStored(handed);
    return handed;
  }

  const stored = env.readStored();
  if (stored) return stored;

  for (const language of env.languages) {
    const preferred = parseAppLocale(language);
    if (preferred) return preferred;
  }
  return DEFAULT_APP_LOCALE;
}

// The real browser. Storage goes through `frontend-core` because the scan path
// on the phone writes the very same value (#211) and the two must not drift.
export function browserLocaleEnvironment(): LocaleEnvironment {
  return {
    search: window.location.search,
    readStored: readStoredLocale,
    writeStored: writeStoredLocale,
    languages: navigator.languages ?? [navigator.language],
  };
}
