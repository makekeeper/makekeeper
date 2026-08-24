import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import type { PluginDashboardWidget } from '@makekeeper/plugin-contract';
import {
  bindDashboardWidgets,
  getConfigurableFeatures,
  getNavChildren,
  getPluginDashboardWidgets,
  registerPlugin,
  type RegisteredNavItem,
} from './registry';

const Stub = defineComponent({ template: '<div />' });
const OtherStub = defineComponent({ template: '<span />' });

const widget = (key: string, order?: number): PluginDashboardWidget => ({
  key,
  titleKey: `x.${key}`,
  icon: 'Box',
  order,
});

describe('bindDashboardWidgets', () => {
  it('binds each declared widget to its component by key', () => {
    const bound = bindDashboardWidgets([widget('a.one'), widget('a.two')], {
      'a.one': Stub,
      'a.two': OtherStub,
    });
    expect(bound).toHaveLength(2);
    expect(bound[0]).toMatchObject({ key: 'a.one', component: Stub });
    expect(bound[1]).toMatchObject({ key: 'a.two', component: OtherStub });
  });

  it('drops descriptors with no component and handles an absent declaration', () => {
    expect(bindDashboardWidgets([widget('a.one')], {})).toEqual([]);
    expect(bindDashboardWidgets(undefined, { 'a.one': Stub })).toEqual([]);
  });
});

// #269: the settings panel offers one switch per FEATURE, and a feature may
// surface twice — the stock timeline is a dashboard panel and a /stats chart
// under one key. Two rows would mean two switches writing the same override.
describe('getConfigurableFeatures', () => {
  it('offers one row per key when a widget and a chart share it', () => {
    registerPlugin({
      id: 'twice',
      nameKey: 'plugins.twice.name',
      navigation: [],
      routes: [],
      messages: {},
      uxFeatures: [{ key: 'twice.own', labelKey: 'twice.ux.own' }],
      statsCharts: [
        {
          kind: 'series',
          key: 'twice.timeline',
          titleKey: 'twice.timeline.title',
          form: 'area',
          series: [{ metricKey: 'twice.m', labelKey: 'twice.m.label' }],
          advanced: true,
        },
      ],
      dashboardWidgets: [
        {
          ...widget('twice.timeline'),
          titleKey: 'twice.timeline.title',
          advanced: true,
          component: Stub,
        },
      ],
    });

    const mine = getConfigurableFeatures().filter(
      (f) => f.pluginId === 'twice',
    );
    expect(mine.map((f) => f.key)).toEqual(['twice.own', 'twice.timeline']);
  });

  it('skips widgets and charts that are not advanced', () => {
    registerPlugin({
      id: 'plain',
      nameKey: 'plugins.plain.name',
      navigation: [],
      routes: [],
      messages: {},
      dashboardWidgets: [{ ...widget('plain.tile'), component: Stub }],
    });
    expect(getConfigurableFeatures().some((f) => f.pluginId === 'plain')).toBe(
      false,
    );
  });
});

describe('getPluginDashboardWidgets', () => {
  it('tags widgets with their plugin id and sorts by order (default 100)', () => {
    registerPlugin({
      id: 'wa',
      nameKey: 'plugins.wa.name',
      navigation: [],
      routes: [],
      messages: {},
      dashboardWidgets: [
        { ...widget('wa.late', 200), component: Stub },
        { ...widget('wa.default'), component: Stub },
      ],
    });
    registerPlugin({
      id: 'wb',
      nameKey: 'plugins.wb.name',
      navigation: [],
      routes: [],
      messages: {},
      dashboardWidgets: [{ ...widget('wb.first', 1), component: Stub }],
    });

    // Filtered to this test's own plugins: the registry is module-global, so
    // any other spec's widgets would otherwise ride along in the assertion.
    const keys = getPluginDashboardWidgets()
      .filter((w) => w.pluginId === 'wa' || w.pluginId === 'wb')
      .map((w) => w.key);
    expect(keys).toEqual(['wb.first', 'wa.default', 'wa.late']);
    expect(
      getPluginDashboardWidgets().find((w) => w.key === 'wb.first')?.pluginId,
    ).toBe('wb');
  });
});

// Runtime nav sub-items (#288). The shell asks the registry, so a fake plugin
// with a fake provider is the whole contract — nothing here (and nothing in the
// shell) knows what a project group is.
describe('getNavChildren', () => {
  const navItem = (
    pluginId: string,
    childrenProvider?: string,
  ): RegisteredNavItem => ({
    pluginId,
    path: `/${pluginId}`,
    titleKey: `nav.${pluginId}`,
    icon: 'Box',
    ...(childrenProvider ? { childrenProvider } : {}),
  });

  it('returns what the named provider returns', () => {
    registerPlugin({
      id: 'children-ok',
      nameKey: 'x',
      navigation: [],
      routes: [],
      messages: { en: {}, ru: {} },
      navChildrenProviders: {
        tree: () => [
          { id: 'a', path: '/children-ok?node=a', label: 'Alpha' },
          { id: 'b', path: '/children-ok?node=b', label: 'Beta' },
        ],
      },
    });
    expect(getNavChildren(navItem('children-ok', 'tree'))).toEqual([
      { id: 'a', path: '/children-ok?node=a', label: 'Alpha' },
      { id: 'b', path: '/children-ok?node=b', label: 'Beta' },
    ]);
  });

  it('is empty for an entry naming no provider, or an unknown one', () => {
    expect(getNavChildren(navItem('children-ok'))).toEqual([]);
    expect(getNavChildren(navItem('children-ok', 'nope'))).toEqual([]);
    expect(getNavChildren(navItem('never-registered', 'tree'))).toEqual([]);
  });

  // A provider that throws costs its own sub-items, never the sidebar.
  it('swallows a failing provider', () => {
    registerPlugin({
      id: 'children-boom',
      nameKey: 'x',
      navigation: [],
      routes: [],
      messages: { en: {}, ru: {} },
      navChildrenProviders: {
        tree: () => {
          throw new Error('nope');
        },
      },
    });
    expect(getNavChildren(navItem('children-boom', 'tree'))).toEqual([]);
  });
});
