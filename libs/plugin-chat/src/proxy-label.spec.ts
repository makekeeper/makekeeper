import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTransliterator,
  type TransliterationTable,
} from '@makekeeper/plugin-contract';
import {
  DEFAULT_PROXY_LABEL_SEGMENTS,
  PROXY_LABEL_SEGMENT_MAX,
  checkProxyHeaderName,
  composeNormalizedProxyLabel,
  composeProxyLabel,
  formatProxyLabelSegments,
  isProxyEndpoint,
  normalizeProxyLabelSegment,
  parseProxyLabelSegments,
} from './proxy-label';

// The real shipped tables, loaded the same way the server loads them at
// startup: every JSON in backend-core's table folder. No table content is
// restated here.
const TABLES_DIR = join(
  __dirname,
  '../../backend-core/src/lib/transliteration-tables',
);
const tr = createTransliterator(
  readdirSync(TABLES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(
      (name) =>
        JSON.parse(
          readFileSync(join(TABLES_DIR, name), 'utf8'),
        ) as TransliterationTable,
    ),
);

describe('checkProxyHeaderName', () => {
  it('accepts a plain token name', () => {
    expect(checkProxyHeaderName('x-my-proxy-tag')).toBe('ok');
  });

  it('accepts a name without the x- prefix', () => {
    // RFC 6648 deprecates the prefix, and the name belongs to the tailnet admin
    // — the product is not entitled to reject their choice.
    expect(checkProxyHeaderName('tailnet-tag')).toBe('ok');
  });

  it.each(['x tag', 'x:tag', 'x@tag', 'tag\n', 'Кухня', ''])(
    'rejects %p as malformed',
    (name) => {
      expect(checkProxyHeaderName(name)).toBe('malformed');
    },
  );

  it.each([
    'Authorization',
    'authorization',
    'X-Api-Key',
    'anthropic-version',
    'User-Agent',
  ])('refuses %p, which the client sets itself', (name) => {
    expect(checkProxyHeaderName(name)).toBe('reserved');
  });
});

describe('parseProxyLabelSegments', () => {
  it('reads NULL as the default single segment, not as the full set', () => {
    // `user` and `project` carry the operator's own data to a third party and
    // stay opt-in — a default including them would make the opt-in a fiction.
    expect(parseProxyLabelSegments(null)).toEqual(DEFAULT_PROXY_LABEL_SEGMENTS);
    expect(parseProxyLabelSegments(undefined)).toEqual(['label']);
  });

  it('preserves the stored order, which belongs to the operator', () => {
    expect(parseProxyLabelSegments('project,label')).toEqual([
      'project',
      'label',
    ]);
  });

  it('reads an empty string as an empty selection', () => {
    expect(parseProxyLabelSegments('')).toEqual([]);
  });

  it('drops unknown and duplicated entries', () => {
    expect(parseProxyLabelSegments('label,bogus,label,user')).toEqual([
      'label',
      'user',
    ]);
  });

  it('tolerates whitespace and case', () => {
    expect(parseProxyLabelSegments(' Label , USER ')).toEqual([
      'label',
      'user',
    ]);
  });
});

describe('formatProxyLabelSegments', () => {
  it('round-trips through parse', () => {
    const stored = formatProxyLabelSegments(['project', 'user']);
    expect(stored).toBe('project,user');
    expect(parseProxyLabelSegments(stored)).toEqual(['project', 'user']);
  });

  it('keeps the empty selection distinguishable from NULL', () => {
    const stored = formatProxyLabelSegments([]);
    expect(stored).toBe('');
    expect(parseProxyLabelSegments(stored)).toEqual([]);
    expect(parseProxyLabelSegments(null)).toEqual(['label']);
  });
});

describe('normalizeProxyLabelSegment', () => {
  it('transliterates Cyrillic instead of dropping or escaping it', () => {
    expect(normalizeProxyLabelSegment('Ремонт кухни', tr)).toBe('remont-kuhni');
  });

  it('strips the separator out of segment content', () => {
    // `.` joins segments; leaving it inside one would make the boundaries
    // unreadable, and project names carry it often.
    expect(normalizeProxyLabelSegment('Ремонт кухни v2.0', tr)).toBe(
      'remont-kuhni-v2-0',
    );
  });

  it('produces a header-safe value for a Cyrillic name', () => {
    // The real constraint: a header value is a ByteString, so an untransliterated
    // name throws at request-build time and takes the whole turn down.
    const value = normalizeProxyLabelSegment('Кухня', tr);
    expect(() => new Headers({ 'x-t': value })).not.toThrow();
    expect(() => new Headers({ 'x-t': 'Кухня' })).toThrow();
  });

  it('collapses runs and trims the ends', () => {
    expect(normalizeProxyLabelSegment('  --Hello   World!!  ', tr)).toBe(
      'hello-world',
    );
  });

  it('truncates to the per-segment limit without a trailing dash', () => {
    const value = normalizeProxyLabelSegment('a'.repeat(40) + ' tail', tr);
    expect(value).toHaveLength(PROXY_LABEL_SEGMENT_MAX);
    expect(value.endsWith('-')).toBe(false);
  });

  it('returns empty when nothing survives', () => {
    expect(normalizeProxyLabelSegment('!!! ???', tr)).toBe('');
  });
});

describe('composeProxyLabel', () => {
  const sources = {
    label: 'makekeeper-prod',
    user: 'Иван',
    project: 'Ремонт кухни v2.0',
  };

  it('joins the enabled segments in the stored order', () => {
    expect(
      composeProxyLabel(['label', 'user', 'project'], sources, tr).value,
    ).toBe('makekeeper-prod.ivan.remont-kuhni-v2-0');
  });

  it('follows a reordered selection — the order belongs to the operator', () => {
    expect(composeProxyLabel(['project', 'label'], sources, tr).value).toBe(
      'remont-kuhni-v2-0.makekeeper-prod',
    );
  });

  it('substitutes the placeholder for a missing source, keeping the position', () => {
    // Spend made outside any project must be its own row in the proxy's report,
    // not merged into the bucket above it.
    expect(
      composeProxyLabel(['label', 'project'], { ...sources, project: null }, tr)
        .value,
    ).toBe('makekeeper-prod.none');
  });

  it('substitutes the placeholder for a name that normalises away', () => {
    expect(
      composeProxyLabel(
        ['label', 'project'],
        { ...sources, project: '!!!' },
        tr,
      ).value,
    ).toBe('makekeeper-prod.none');
  });

  it('reports no content when every segment is a placeholder', () => {
    const composed = composeProxyLabel(
      ['label', 'user'],
      { label: null, user: null, project: null },
      tr,
    );
    expect(composed.hasContent).toBe(false);
  });

  it('reports content when at least one segment is real', () => {
    expect(
      composeProxyLabel(['label', 'user'], { ...sources, user: null }, tr)
        .hasContent,
    ).toBe(true);
  });

  it('is empty for an empty selection', () => {
    const composed = composeProxyLabel([], sources, tr);
    expect(composed.value).toBe('');
    expect(composed.hasContent).toBe(false);
  });
});

describe('isProxyEndpoint', () => {
  const OPENAI = 'https://api.openai.com/v1';

  it('is false while the endpoint is the vendor’s own', () => {
    expect(isProxyEndpoint(OPENAI, OPENAI)).toBe(false);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isProxyEndpoint(`${OPENAI}/`, OPENAI)).toBe(false);
    expect(isProxyEndpoint(OPENAI, `${OPENAI}/`)).toBe(false);
  });

  it('is false for a blank endpoint — the vendor default is in force', () => {
    // The form PREFILLS the vendor URL, so "non-empty" would have been the
    // wrong test; blank simply means nothing was chosen.
    expect(isProxyEndpoint(null, OPENAI)).toBe(false);
    expect(isProxyEndpoint('   ', OPENAI)).toBe(false);
  });

  it('is true once the endpoint is the operator’s own', () => {
    expect(isProxyEndpoint('https://llm.example.internal/v1', OPENAI)).toBe(
      true,
    );
  });

  it('is true for any endpoint when the provider has no vendor of its own', () => {
    expect(isProxyEndpoint('https://gateway.example.internal', '')).toBe(true);
    expect(isProxyEndpoint('https://gateway.example.internal', undefined)).toBe(
      true,
    );
  });
});

describe('composeNormalizedProxyLabel', () => {
  it('composes from server-normalised parts without any tables', () => {
    const composed = composeNormalizedProxyLabel(['label', 'project'], {
      label: 'makekeeper-prod',
      project: 'remont-kuhni',
    });
    expect(composed.value).toBe('makekeeper-prod.remont-kuhni');
    expect(composed.hasContent).toBe(true);
  });

  it('substitutes the placeholder for a missing or empty part', () => {
    const composed = composeNormalizedProxyLabel(['label', 'user'], {
      label: '',
    });
    expect(composed.value).toBe('none.none');
    expect(composed.hasContent).toBe(false);
  });
});
