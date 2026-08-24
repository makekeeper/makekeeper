import { TransliterationService } from './transliteration.service';

// Instantiated for real: under Jest the service resolves the tables from its
// own sibling folder and reads the actual shipped files — which is the point.
// These tests pin that the SHIPPED tables load and map, not that some fixture
// would.

describe('TransliterationService', () => {
  const service = new TransliterationService();

  it('reads the asset folder and maps Cyrillic', () => {
    expect(service.transliterate('ремонт кухни')).toBe('remont kuhni');
  });

  it('preserves capitalisation', () => {
    expect(service.transliterate('Щи и Борщ')).toBe('Schi i Borsch');
  });

  it('drops the soft and hard signs', () => {
    expect(service.transliterate('подъезд дверь')).toBe('podezd dver');
  });

  it('passes unknown characters through unchanged', () => {
    expect(service.transliterate('gpt-4o v2.0 (β)')).toBe('gpt-4o v2.0 (β)');
  });
});
