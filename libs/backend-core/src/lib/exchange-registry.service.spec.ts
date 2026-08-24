import type { PluginExchangeSection } from '@makekeeper/plugin-contract';
import {
  DeclaredExchangeSection,
  orderExchangeSections,
  validateExchangeDeclarations,
} from './exchange-registry.service';

function section(
  key: string,
  overrides: Partial<PluginExchangeSection> = {},
): DeclaredExchangeSection {
  return {
    pluginId: key.split('.')[0],
    section: {
      key,
      labelKey: `${key}.label`,
      roots: ['project'],
      ...overrides,
    },
  };
}

describe('orderExchangeSections', () => {
  it('orders dependencies before their dependents', () => {
    const ordered = orderExchangeSections([
      section('tags.links', {
        dependsOn: ['projects.project', 'inventory.components'],
      }),
      section('inventory.components', { dependsOn: ['projects.project'] }),
      section('projects.project', { isRoot: true }),
    ]);
    const keys = ordered.map((s) => s.section.key);
    expect(keys.indexOf('projects.project')).toBeLessThan(
      keys.indexOf('inventory.components'),
    );
    expect(keys.indexOf('inventory.components')).toBeLessThan(
      keys.indexOf('tags.links'),
    );
  });

  it('ignores dependencies on sections outside the given set', () => {
    const ordered = orderExchangeSections([
      section('projects.tasks', { dependsOn: ['logistics.orders'] }),
    ]);
    expect(ordered.map((s) => s.section.key)).toEqual(['projects.tasks']);
  });

  it('throws on a dependency cycle', () => {
    expect(() =>
      orderExchangeSections([
        section('a.one', { dependsOn: ['b.two'] }),
        section('b.two', { dependsOn: ['a.one'] }),
      ]),
    ).toThrow(/exchangeCycle/);
  });
});

describe('validateExchangeDeclarations', () => {
  const projectRoot = {
    kind: 'entity' as const,
    entityType: 'project',
    labelKey: 'x',
    icon: 'Box',
  };

  it('accepts a consistent declaration/provider set', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'projects.project',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                },
                {
                  key: 'projects.tasks',
                  labelKey: 'x',
                  roots: ['project'],
                  dependsOn: ['projects.project'],
                },
              ],
            },
          },
        ],
        providerKeys: new Set(['projects.project', 'projects.tasks']),
      }),
    ).not.toThrow();
  });

  it('rejects a declared section without a provider', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'projects.project',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                },
              ],
            },
          },
        ],
        providerKeys: new Set(),
      }),
    ).toThrow(/exchangeProviderMissing/);
  });

  it('rejects a provider without a declaration', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'projects.project',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                },
              ],
            },
          },
        ],
        providerKeys: new Set(['projects.project', 'ghost.section']),
      }),
    ).toThrow(/exchangeDeclarationMissing/);
  });

  it('rejects a section not namespaced by its plugin', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'inventory.sneaky',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                },
              ],
            },
          },
        ],
        providerKeys: new Set(['inventory.sneaky']),
      }),
    ).toThrow(/exchangeSectionNamespace/);
  });

  it('rejects an unknown dependsOn target', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'projects.project',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                  dependsOn: ['nope.section'],
                },
              ],
            },
          },
        ],
        providerKeys: new Set(['projects.project']),
      }),
    ).toThrow(/exchangeUnknownDependency/);
  });

  it('rejects a section targeting an undeclared root', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                {
                  key: 'projects.project',
                  labelKey: 'x',
                  roots: ['project'],
                  isRoot: true,
                },
                { key: 'projects.other', labelKey: 'x', roots: ['warehouse'] },
              ],
            },
          },
        ],
        providerKeys: new Set(['projects.project', 'projects.other']),
      }),
    ).toThrow(/exchangeUnknownRoot/);
  });

  it('rejects a root without exactly one isRoot section', () => {
    expect(() =>
      validateExchangeDeclarations({
        declarations: [
          {
            pluginId: 'projects',
            declaration: {
              roots: [projectRoot],
              sections: [
                { key: 'projects.tasks', labelKey: 'x', roots: ['project'] },
              ],
            },
          },
        ],
        providerKeys: new Set(['projects.tasks']),
      }),
    ).toThrow(/exchangeRootSectionCount/);
  });
});
