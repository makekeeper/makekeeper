import { detectExpansion } from './manifest-diff';
import {
  ExternalPluginManifest,
  PermissionLevel,
} from '@makekeeper/plugin-contract';

const manifest = (
  over: Partial<ExternalPluginManifest>,
): ExternalPluginManifest => ({
  contract: { major: 1, minor: 0 },
  pluginId: 'demo',
  version: '1.0.0',
  nameKey: 'demo.name',
  icon: 'Blocks',
  scopeModel: 'instance',
  permissions: ['inventory:read'],
  i18n: { en: { demo: { name: 'Demo' } } },
  screens: ['home'],
  ...over,
});

describe('detectExpansion (update diff policy, decision #15)', () => {
  it('treats an identical manifest as non-expanding', () => {
    const cur = manifest({});
    expect(detectExpansion(cur, cur.permissions, manifest({})).expansion).toBe(
      false,
    );
  });

  it('flags a new permission', () => {
    const cur = manifest({});
    const next = manifest({
      permissions: ['inventory:read', 'inventory:write'],
    });
    const diff = detectExpansion(cur, cur.permissions, next);
    expect(diff.expansion).toBe(true);
    expect(diff.reasons).toEqual([
      { code: 'permission-added', detail: 'inventory:write' },
    ]);
  });

  it('treats permission narrowing as non-expanding', () => {
    const cur = manifest({
      permissions: ['inventory:read', 'inventory:write'],
    });
    const next = manifest({ permissions: ['inventory:read'] });
    expect(detectExpansion(cur, cur.permissions, next).expansion).toBe(false);
  });

  it('flags a scope-model change', () => {
    const cur = manifest({});
    const next = manifest({ scopeModel: 'per-scope' });
    const diff = detectExpansion(cur, cur.permissions, next);
    expect(diff.reasons[0].code).toBe('scope-model-changed');
  });

  it('flags a new mutating tool but not a new READ tool', () => {
    const cur = manifest({});
    const read = manifest({
      tools: [
        {
          name: 'peek',
          descriptionKey: 'demo.peek',
          permission: PermissionLevel.READ,
          parameters: { properties: {} },
        },
      ],
    });
    expect(detectExpansion(cur, cur.permissions, read).expansion).toBe(false);

    const write = manifest({
      tools: [
        {
          name: 'poke',
          descriptionKey: 'demo.poke',
          permission: PermissionLevel.WRITE,
          parameters: { properties: {} },
        },
      ],
    });
    const diff = detectExpansion(cur, cur.permissions, write);
    expect(diff.reasons).toEqual([
      { code: 'mutating-tool-added', detail: 'poke' },
    ]);
  });

  it('flags a newly offered capability', () => {
    const cur = manifest({});
    const next = manifest({
      capabilities: [{ id: 'demo.stream', version: '1' }],
    });
    const diff = detectExpansion(cur, cur.permissions, next);
    expect(diff.reasons).toEqual([
      { code: 'capability-added', detail: 'demo.stream' },
    ]);
  });

  it('flags a new public path and tolerates dropping one (#250)', () => {
    const cur = manifest({ publicPaths: ['webhook'] });
    const next = manifest({ publicPaths: ['webhook', ''] });
    const diff = detectExpansion(cur, cur.permissions, next);
    expect(diff.reasons).toEqual([{ code: 'public-path-added', detail: '' }]);

    const narrowed = manifest({ publicPaths: [] });
    expect(detectExpansion(cur, cur.permissions, narrowed).expansion).toBe(
      false,
    );
  });
});
