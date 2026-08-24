import {
  codePrefixForRef,
  extractDeepLinkCode,
  isLabelCode,
  normalizeCode,
} from './code-format';
import type { ObjectRef } from '@makekeeper/plugin-contract';

const ref = (over: Partial<ObjectRef>): ObjectRef => ({
  pluginId: 'inventory',
  entityType: 'component',
  entityId: 'x',
  ...over,
});

describe('code-format', () => {
  describe('codePrefixForRef', () => {
    it('derives a component prefix from the entity type', () => {
      expect(codePrefixForRef(ref({}))).toBe('COM');
    });
    it('derives a whole-storage prefix from the entity type', () => {
      expect(
        codePrefixForRef(ref({ pluginId: 'storages', entityType: 'storage' })),
      ).toBe('STO');
    });
    it('maps any fragment (grid-cell) sub-entity to CEL', () => {
      expect(
        codePrefixForRef(
          ref({ pluginId: 'storages', entityType: 'storage', fragment: 'B1' }),
        ),
      ).toBe('CEL');
    });
    it('derives a prefix for any other plugin entity without codes changes', () => {
      expect(
        codePrefixForRef(ref({ pluginId: 'projects', entityType: 'project' })),
      ).toBe('PRO');
    });
    it('falls back to OBJ when the entity type has too few letters', () => {
      expect(codePrefixForRef(ref({ entityType: 'x' }))).toBe('OBJ');
    });
  });

  describe('isLabelCode', () => {
    it('accepts a canonical code', () => {
      expect(isLabelCode('CMP-4Z9QX')).toBe(true);
    });
    it('accepts case-insensitively (normalized)', () => {
      expect(isLabelCode('cmp-4z9qx')).toBe(true);
    });
    it('rejects ambiguous Crockford letters (I/L/O/U)', () => {
      expect(isLabelCode('CMP-ILOU5')).toBe(false);
    });
    it('rejects a bare id / arbitrary string', () => {
      expect(isLabelCode('just-some-sku')).toBe(false);
      expect(isLabelCode('CMP4Z9QX')).toBe(false);
    });
  });

  describe('extractDeepLinkCode', () => {
    it('extracts a code from a full deep-link URL', () => {
      expect(extractDeepLinkCode('https://host.example/c/CMP-4Z9QX')).toBe(
        'CMP-4Z9QX',
      );
    });
    it('extracts from a bare path with a trailing slash', () => {
      expect(extractDeepLinkCode('/c/cmp-4z9qx/')).toBe('CMP-4Z9QX');
    });
    it('returns null for a non-deep-link string', () => {
      expect(extractDeepLinkCode('CMP-4Z9QX')).toBeNull();
      expect(
        extractDeepLinkCode('https://host.example/inventory/1'),
      ).toBeNull();
    });
    it('returns null when the extracted segment is not a valid code', () => {
      expect(extractDeepLinkCode('/c/not-a-code')).toBeNull();
    });
  });

  describe('normalizeCode', () => {
    it('trims and uppercases', () => {
      expect(normalizeCode('  cmp-4z9qx  ')).toBe('CMP-4Z9QX');
    });
  });
});
