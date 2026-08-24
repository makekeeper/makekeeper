import {
  formatObjectRef,
  parseObjectRef,
  isObjectRef,
  resolveEntityId,
  extractObjectRefs,
  type ObjectRef,
} from './object-ref';

describe('object-ref', () => {
  const valid: ObjectRef[] = [
    { pluginId: 'projects', entityType: 'project', entityId: 'abc123' },
    { pluginId: 'projects', entityType: 'task', entityId: 'ckxyz789' },
    { pluginId: 'inventory', entityType: 'component', entityId: 'c_1' },
    { pluginId: 'storages', entityType: 'storage', entityId: 's-1' },
    {
      pluginId: 'storages',
      entityType: 'storage',
      entityId: 's-1',
      fragment: 'B1',
    },
    {
      pluginId: 'storages',
      entityType: 'storage',
      entityId: 's-1',
      fragment: 'AB27',
    },
    { pluginId: 'logistics', entityType: 'order', entityId: 'o1' },
    { pluginId: 'chat', entityType: 'session', entityId: 'sess1' },
  ];

  describe('formatObjectRef', () => {
    it('builds the canonical URI shape', () => {
      expect(formatObjectRef(valid[0])).toBe('mk://projects/project/abc123');
      expect(formatObjectRef(valid[4])).toBe('mk://storages/storage/s-1#B1');
    });

    it('percent-encodes ids and fragments that contain delimiters', () => {
      expect(
        formatObjectRef({ pluginId: 'p', entityType: 't', entityId: 'a/b#c' }),
      ).toBe('mk://p/t/a%2Fb%23c');
    });

    it('returns null for a malformed ref', () => {
      expect(
        formatObjectRef({
          pluginId: 'Projects',
          entityType: 't',
          entityId: 'x',
        }),
      ).toBeNull();
      expect(
        formatObjectRef({ pluginId: '1p', entityType: 't', entityId: 'x' }),
      ).toBeNull();
      expect(
        formatObjectRef({ pluginId: 'p', entityType: 'Type', entityId: 'x' }),
      ).toBeNull();
      expect(
        formatObjectRef({ pluginId: 'p', entityType: 't', entityId: '' }),
      ).toBeNull();
      expect(
        formatObjectRef({
          pluginId: 'p',
          entityType: 't',
          entityId: 'x',
          fragment: '',
        }),
      ).toBeNull();
    });
  });

  describe('round-trip', () => {
    it.each(valid)('parse(format(%o)) deep-equals the input', (ref) => {
      const s = formatObjectRef(ref);
      expect(s).not.toBeNull();
      expect(parseObjectRef(s as string)).toEqual(ref);
    });

    it('round-trips ids and fragments needing encoding', () => {
      const ref: ObjectRef = {
        pluginId: 'storages',
        entityType: 'storage',
        entityId: 'weird/id#1',
        fragment: 'a b',
      };
      expect(parseObjectRef(formatObjectRef(ref) as string)).toEqual(ref);
    });
  });

  describe('parseObjectRef rejects invalid input', () => {
    it.each([
      'abc123',
      'mk://',
      'mk://projects/project/',
      'mk://projects//abc',
      'mk:///project/abc',
      'http://projects/project/abc',
      'mk://Projects/project/abc',
      'mk://projects/Project/abc',
      'mk://projects/project/abc#',
      'mk://projects/project/%',
    ])('rejects %p', (input) => {
      expect(parseObjectRef(input)).toBeNull();
    });

    it('rejects non-canonical (redundant) percent-encoding', () => {
      // "%41" decodes to "A"; the canonical spelling is a bare "A".
      expect(parseObjectRef('mk://projects/project/%41')).toBeNull();
    });
  });

  // The `diy://` scheme is intentionally NOT accepted: this is a greenfield project
  // with no pre-rename data, so `mk://` is the only recognized scheme (#80).
  it('rejects the retired diy:// scheme', () => {
    expect(parseObjectRef('diy://storages/storage/s-1#B1')).toBeNull();
    expect(parseObjectRef('diy://projects/project/abc123')).toBeNull();
    expect(
      extractObjectRefs(
        'a diy://projects/task/t9 and mk://projects/project/p1',
      ),
    ).toEqual([
      { pluginId: 'projects', entityType: 'project', entityId: 'p1' },
    ]);
  });

  describe('isObjectRef', () => {
    it('accepts a well-formed ref object', () => {
      expect(isObjectRef(valid[0])).toBe(true);
      expect(isObjectRef(valid[4])).toBe(true);
    });

    it('rejects non-refs', () => {
      expect(isObjectRef(null)).toBe(false);
      expect(isObjectRef('mk://projects/project/abc')).toBe(false);
      expect(isObjectRef({ pluginId: 'p', entityType: 't' })).toBe(false);
      expect(
        isObjectRef({
          pluginId: 'p',
          entityType: 't',
          entityId: 'x',
          fragment: 1,
        }),
      ).toBe(false);
      expect(
        isObjectRef({ pluginId: 'P', entityType: 't', entityId: 'x' }),
      ).toBe(false);
    });
  });

  describe('resolveEntityId', () => {
    const storage = { pluginId: 'storages', entityType: 'storage' };

    it('passes a bare (non-URI) id through as a raw id', () => {
      expect(resolveEntityId('ckx123', storage)).toEqual({ id: 'ckx123' });
    });

    it('extracts the id (and fragment) from a matching ORef', () => {
      expect(resolveEntityId('mk://storages/storage/s1', storage)).toEqual({
        id: 's1',
      });
      expect(resolveEntityId('mk://storages/storage/s1#B1', storage)).toEqual({
        id: 's1',
        fragment: 'B1',
      });
    });

    it('rejects an ORef of the wrong plugin or type', () => {
      expect(
        resolveEntityId('mk://inventory/component/c1', storage),
      ).toBeNull();
      expect(resolveEntityId('mk://storages/shelf/s1', storage)).toBeNull();
    });

    it('rejects a malformed ORef and an empty input', () => {
      expect(resolveEntityId('mk://storages/storage/', storage)).toBeNull();
      expect(resolveEntityId('', storage)).toBeNull();
    });
  });

  describe('extractObjectRefs', () => {
    it('returns [] for empty / non-string / ref-free input', () => {
      expect(extractObjectRefs('')).toEqual([]);
      expect(extractObjectRefs(undefined as unknown as string)).toEqual([]);
      expect(extractObjectRefs('nothing to see here')).toEqual([]);
    });

    it('pulls refs out of a JSON.stringify blob', () => {
      const blob = JSON.stringify({
        ref: 'mk://projects/project/p1',
        nested: { task: 'mk://projects/task/t9' },
      });
      expect(extractObjectRefs(blob)).toEqual([
        { pluginId: 'projects', entityType: 'project', entityId: 'p1' },
        { pluginId: 'projects', entityType: 'task', entityId: 't9' },
      ]);
    });

    it('trims trailing sentence punctuation before validating', () => {
      expect(extractObjectRefs('see mk://projects/project/p1.')).toEqual([
        { pluginId: 'projects', entityType: 'project', entityId: 'p1' },
      ]);
      expect(extractObjectRefs('(mk://storages/storage/s1#B1), done')).toEqual([
        {
          pluginId: 'storages',
          entityType: 'storage',
          entityId: 's1',
          fragment: 'B1',
        },
      ]);
    });

    it('de-duplicates repeated refs, preserving first-seen order', () => {
      const text =
        'mk://projects/task/t1 then mk://projects/project/p1 then mk://projects/task/t1';
      expect(extractObjectRefs(text)).toEqual([
        { pluginId: 'projects', entityType: 'task', entityId: 't1' },
        { pluginId: 'projects', entityType: 'project', entityId: 'p1' },
      ]);
    });

    it('ignores malformed mk:// tokens', () => {
      expect(extractObjectRefs('mk://Bad/Type/x mk://ok')).toEqual([]);
    });
  });
});
