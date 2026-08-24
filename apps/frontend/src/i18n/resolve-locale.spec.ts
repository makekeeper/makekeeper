import { describe, expect, it } from 'vitest';
import type { AppLocale } from '@makekeeper/plugin-contract';
import { resolveInitialLocale, type LocaleEnvironment } from './resolve-locale';

// The precedence IS the feature (#211): a phone knows nothing about the person
// until a QR tells it, and what it is told has to outlive the visit — an
// installed app relaunches without the parameter.

function env(options: {
  search?: string;
  stored?: AppLocale | null;
  languages?: string[];
}): LocaleEnvironment & { written: AppLocale[] } {
  const written: AppLocale[] = [];
  return {
    written,
    search: options.search ?? '',
    readStored: () => options.stored ?? null,
    writeStored(locale) {
      written.push(locale);
    },
    languages: options.languages ?? [],
  };
}

describe('resolveInitialLocale', () => {
  it('takes the language handed over in the URL', () => {
    expect(resolveInitialLocale(env({ search: '?code=abc&lang=ru' }))).toBe(
      'ru',
    );
  });

  it('persists the handed-over language', () => {
    // Without this the installed app, which starts at /m with no query, forgets
    // everything it was told at pairing time.
    const environment = env({ search: '?lang=ru' });
    resolveInitialLocale(environment);
    expect(environment.written).toEqual(['ru']);
  });

  it('lets a later handover override what was stored', () => {
    expect(
      resolveInitialLocale(env({ search: '?lang=en', stored: 'ru' })),
    ).toBe('en');
  });

  it('ignores a language we ship no bundle for', () => {
    // Falls through as if the parameter were absent, rather than showing keys.
    const environment = env({ search: '?lang=de', stored: 'ru' });
    expect(resolveInitialLocale(environment)).toBe('ru');
    expect(environment.written).toEqual([]);
  });

  it('uses the stored value when no language was handed over', () => {
    expect(resolveInitialLocale(env({ stored: 'ru' }))).toBe('ru');
  });

  it('follows the browser when nothing is stored', () => {
    expect(resolveInitialLocale(env({ languages: ['ru-RU', 'en-US'] }))).toBe(
      'ru',
    );
  });

  it('skips browser languages it does not ship', () => {
    expect(
      resolveInitialLocale(env({ languages: ['de-DE', 'fr', 'ru'] })),
    ).toBe('ru');
  });

  it('falls back to English when nothing matches', () => {
    expect(resolveInitialLocale(env({ languages: ['de-DE'] }))).toBe('en');
    expect(resolveInitialLocale(env({}))).toBe('en');
  });

  it('does not write anything when no language was handed over', () => {
    // A visit that only READ a preference must not look like a decision.
    const environment = env({ stored: 'ru', languages: ['en'] });
    resolveInitialLocale(environment);
    expect(environment.written).toEqual([]);
  });
});
