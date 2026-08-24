// The interface language, and how it travels to a phone (#211).
//
// The language is a browser-local value (`localStorage['locale']`), so a phone —
// a different browser, and an installed app a different storage again — has no
// way of knowing what the desktop is set to. Nothing is stored server-side for
// it; instead the two ephemeral "show a QR to a phone" handoffs carry the
// language of the desktop that produced them, in the URL the QR encodes.
//
// The URL and not the response to the redeem/claim call: the screen a phone
// opens on is painted BEFORE it asks the server anything, so a language that
// arrives with a response is too late for the words the person is reading.
//
// Lives here rather than in `frontend-core` because both plugin BACKENDS append
// the parameter and the app shell reads it, and a backend cannot import the Vue
// layer.

// Every locale the app ships a bundle for. The order is the display order.
export const APP_LOCALES = ['en', 'ru'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

// What every surface falls back to when nothing else is known — the one locale
// guaranteed to be complete, since `en` is also vue-i18n's `fallbackLocale`.
export const DEFAULT_APP_LOCALE: AppLocale = 'en';

// Query parameter carrying the language into a phone-facing URL.
export const LOCALE_PARAM = 'lang';

export function isAppLocale(value: unknown): value is AppLocale {
  return APP_LOCALES.some((locale): boolean => locale === value);
}

// A locale we ship, or null. Accepts what a browser actually reports — an
// `Accept-Language`/`navigator.languages` entry is a BCP-47 tag (`ru-RU`,
// `en-GB`), and the region is not ours to care about; case is not either.
export function parseAppLocale(
  value: string | null | undefined,
): AppLocale | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isAppLocale(primary) ? primary : null;
}

// Append the language to a phone-facing URL. ONE builder, because the pairing QR
// and the phone-bridge QR are the same gesture and must not drift on the
// parameter name — and because a locale that failed to parse must leave the URL
// untouched rather than put junk in a QR nobody can edit afterwards.
export function withLocaleParam(
  url: string,
  locale: string | null | undefined,
): string {
  const parsed = parseAppLocale(locale);
  if (!parsed) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${LOCALE_PARAM}=${parsed}`;
}
