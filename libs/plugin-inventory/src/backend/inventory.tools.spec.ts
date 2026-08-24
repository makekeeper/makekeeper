import {
  getInventoryTools,
  isManualMovementType,
  readImageUrls,
  stringifyCustomFields,
  stringifyLinks,
} from './inventory.tools';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';

describe('isManualMovementType', () => {
  it('accepts the four manual movement types', () => {
    for (const type of ['ADJUSTMENT', 'PURCHASE', 'USED', 'RETURN']) {
      expect(isManualMovementType(type)).toBe(true);
    }
  });

  it('rejects RESERVED (project-managed) and any non-type value', () => {
    expect(isManualMovementType('RESERVED')).toBe(false);
    expect(isManualMovementType('adjustment')).toBe(false);
    expect(isManualMovementType(undefined)).toBe(false);
    expect(isManualMovementType(5)).toBe(false);
  });
});

describe('stringifyLinks', () => {
  it('serializes complete links to the persisted JSON shape', () => {
    expect(
      stringifyLinks([{ label: 'Datasheet', url: 'https://x/y.pdf' }]),
    ).toBe(JSON.stringify([{ label: 'Datasheet', url: 'https://x/y.pdf' }]));
  });

  it('drops rows missing a label or url, and blank-only rows', () => {
    expect(
      stringifyLinks([
        { label: 'ok', url: 'https://a' },
        { label: '', url: 'https://b' },
        { label: 'c', url: '   ' },
      ]),
    ).toBe(JSON.stringify([{ label: 'ok', url: 'https://a' }]));
  });

  it('returns undefined for a non-array, an empty array, or all-invalid rows', () => {
    expect(stringifyLinks(undefined)).toBeUndefined();
    expect(stringifyLinks('nope')).toBeUndefined();
    expect(stringifyLinks([])).toBeUndefined();
    expect(stringifyLinks([{ label: '', url: '' }, 42, null])).toBeUndefined();
  });

  it('coerces non-string values instead of throwing', () => {
    expect(stringifyLinks([{ label: 1, url: 2 }])).toBe(
      JSON.stringify([{ label: '1', url: '2' }]),
    );
  });
});

describe('stringifyCustomFields', () => {
  it('serializes complete key/value pairs', () => {
    expect(stringifyCustomFields([{ key: 'Package', value: 'SOP-8' }])).toBe(
      JSON.stringify([{ key: 'Package', value: 'SOP-8' }]),
    );
  });

  it('drops incomplete pairs and returns undefined when none remain', () => {
    expect(
      stringifyCustomFields([{ key: 'Pitch', value: '' }, { value: '2mm' }]),
    ).toBeUndefined();
  });
});

// Guards the descriptionKeys every tool exposes — those `defineTools` DERIVES
// for the migrated READ tools, plus each hand-written tool's own key, its
// parameter keys, and one level of array-`items` key. A key that isn't present
// in a locale would render the raw key to the LLM; this turns that into a test
// failure instead of a runtime warning. (Nested object-array item properties
// are not walked — no tool relies on them today; extend the flatMap if one does.)
describe('inventory agent-tool i18n keys resolve', () => {
  const resolve = (bundle: unknown, dotted: string): unknown =>
    dotted
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        bundle,
      );

  // Handlers never run here — the stub services satisfy the factory's shape.
  const tools = getInventoryTools(
    {} as never,
    {} as never,
    { list: () => Promise.resolve([]) } as never,
    {
      t: (key: string): string => key,
    } as never,
  );

  const keys = tools.flatMap((tool) => [
    tool.descriptionKey,
    ...Object.values(tool.parameters.properties).flatMap((p) => [
      p.descriptionKey,
      ...(p.items ? [p.items.descriptionKey] : []),
    ]),
  ]);

  it.each(['en', 'ru'] as const)('has every key present in %s', (locale) => {
    const bundle = locale === 'en' ? en : ru;
    const missing = keys.filter(
      (key) => typeof resolve(bundle, key) !== 'string',
    );
    expect(missing).toEqual([]);
  });
});

// The agent's photograph parameter is a SET (#218). The three things a model can
// mean have to stay distinguishable: leave them alone, replace them, clear them.
describe('readImageUrls', () => {
  it('reads a list of stored URLs in order', () => {
    expect(readImageUrls(['/api/uploads/att_a', '/api/uploads/att_b'])).toEqual(
      ['/api/uploads/att_a', '/api/uploads/att_b'],
    );
  });

  // An EMPTY list is a real instruction — clear them — which is what an empty
  // `imageUrl` string used to mean.
  it('treats an empty list as "clear the set"', () => {
    expect(readImageUrls([])).toEqual([]);
  });

  // Absent means "leave the pictures alone"; a lost distinction here would let
  // a rename wipe an item's photographs.
  it('treats an absent argument as "leave them alone"', () => {
    expect(readImageUrls(undefined)).toBeUndefined();
    expect(readImageUrls(null)).toBeUndefined();
  });

  it('ignores a non-list argument rather than guessing', () => {
    expect(readImageUrls('/api/uploads/att_a')).toBeUndefined();
  });

  it('drops blank entries and caps the set', () => {
    expect(readImageUrls(['/api/uploads/att_a', '', '   '])).toEqual([
      '/api/uploads/att_a',
    ]);
    expect(
      readImageUrls(
        Array.from({ length: 9 }, (_, i) => `/api/uploads/att_${i}`),
      ),
    ).toHaveLength(5);
  });
});

// A tool that calls one of five pictures "the photo" invites the model to
// replace the set while believing it replaced one image.
describe('the photograph parameter is declared as a list', () => {
  const tools = getInventoryTools(
    {} as never,
    {} as never,
    { list: () => Promise.resolve([]) } as never,
    { t: (key: string): string => key } as never,
  );

  it.each(['create_component', 'update_component'])(
    '%s takes imageUrls, never imageUrl',
    (name) => {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool?.parameters.properties.imageUrl).toBeUndefined();
      expect(tool?.parameters.properties.imageUrls?.type).toBe('array');
    },
  );
});
