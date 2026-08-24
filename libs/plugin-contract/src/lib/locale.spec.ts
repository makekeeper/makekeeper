import {
  DEFAULT_APP_LOCALE,
  LOCALE_PARAM,
  parseAppLocale,
  withLocaleParam,
} from './locale';

// What a browser reports and what a QR may carry are both untrusted strings, and
// the URL side is the unforgiving one: a QR is printed on a screen and scanned as
// is, so anything wrong in it cannot be corrected afterwards.

describe('parseAppLocale', () => {
  it('accepts a bare locale', () => {
    expect(parseAppLocale('ru')).toBe('ru');
    expect(parseAppLocale('en')).toBe('en');
  });

  it('accepts what a browser actually reports', () => {
    // `navigator.languages` and Accept-Language carry a region we do not model.
    expect(parseAppLocale('ru-RU')).toBe('ru');
    expect(parseAppLocale('en_GB')).toBe('en');
    expect(parseAppLocale(' RU ')).toBe('ru');
  });

  it('refuses anything we ship no bundle for', () => {
    expect(parseAppLocale('de')).toBeNull();
    expect(parseAppLocale('')).toBeNull();
    expect(parseAppLocale(null)).toBeNull();
    expect(parseAppLocale(undefined)).toBeNull();
  });
});

describe('withLocaleParam', () => {
  it('appends to a URL that already carries a query', () => {
    expect(
      withLocaleParam('https://mk.example.com/m/pair?code=abc', 'ru'),
    ).toBe(`https://mk.example.com/m/pair?code=abc&${LOCALE_PARAM}=ru`);
  });

  it('opens the query on a URL that has none', () => {
    expect(withLocaleParam('https://mk.example.com/d/tok', 'en')).toBe(
      `https://mk.example.com/d/tok?${LOCALE_PARAM}=en`,
    );
  });

  it('normalizes before embedding', () => {
    expect(withLocaleParam('https://mk.example.com/d/tok', 'ru-RU')).toBe(
      `https://mk.example.com/d/tok?${LOCALE_PARAM}=ru`,
    );
  });

  it('leaves the URL alone when the locale is unusable', () => {
    // Silence beats a junk parameter: the surface then resolves the language the
    // way it would have without any handoff at all.
    const url = 'https://mk.example.com/m/pair?code=abc';
    expect(withLocaleParam(url, 'klingon')).toBe(url);
    expect(withLocaleParam(url, undefined)).toBe(url);
  });
});

describe('DEFAULT_APP_LOCALE', () => {
  it('is a locale we ship', () => {
    expect(parseAppLocale(DEFAULT_APP_LOCALE)).toBe(DEFAULT_APP_LOCALE);
  });
});
