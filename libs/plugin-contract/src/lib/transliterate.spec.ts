import {
  TransliterationCollisionError,
  createTransliterator,
} from './transliterate';

// Pure-logic tests only: the real tables are server data, read from the
// backend's asset folder at startup and covered by TransliterationService's
// own spec. Here the tables are tiny fixtures, because what this module owns
// is merging and case behaviour, not any particular script.

describe('createTransliterator', () => {
  const tr = createTransliterator([{ ж: 'zh', я: 'ya', ь: '' }]);

  it('maps letters through the supplied tables', () => {
    expect(tr('жья')).toBe('zhya');
  });

  it('preserves capitalisation, including multi-letter replacements', () => {
    expect(tr('Ж')).toBe('Zh');
    expect(tr('ж')).toBe('zh');
  });

  it('passes unknown characters through unchanged', () => {
    // The caller owns its charset policy; this utility only transliterates.
    expect(tr('gpt-4o v2.0 (β)')).toBe('gpt-4o v2.0 (β)');
  });

  it('merges several tables', () => {
    const merged = createTransliterator([{ а: 'a' }, { б: 'b' }]);
    expect(merged('аб')).toBe('ab');
  });

  it('fails loud when two tables claim the same letter', () => {
    let thrown: unknown;
    try {
      createTransliterator([{ а: 'a' }, { а: 'x' }]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TransliterationCollisionError);
    if (thrown instanceof TransliterationCollisionError) {
      expect(thrown.letter).toBe('а');
      expect(thrown.message).toBe('transliterate.errors.tableCollision');
    }
  });
});
