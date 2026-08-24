import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The schemas declare draft 2020-12, which lives in its own Ajv entry point.
import Ajv from 'ajv/dist/2020';
import {
  SUPPORTED_CONTRACT_MAJORS,
  validateExternalManifest,
} from './external-manifest';
import { sanitizeUiScreen } from './external-ui';

// Drift guard for the PUBLISHED contract artifacts (#187, decisions #2/#17 of
// #131): the JSON-Schema files under `schemas/` are what a non-TypeScript
// author validates against, and they must keep agreeing with the TypeScript
// validator/sanitizer that actually runs in the core. The schemas are
// deliberately structural-only — cross-reference rules (screen keys existing,
// en-bundle completeness, capability prefixes) live only in the validator, so
// the agreement asserted here is one-directional where it has to be:
//   * validator accepts  ⇒ schema accepts (a manifest the core installs must
//     never fail the published schema);
//   * schema rejects     ⇒ validator rejects (structurally broken input fools
//     neither);
// and for UI trees: schema accepts ⇒ the sanitizer keeps every node.

const loadSchema = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(__dirname, '../../../schemas', name), 'utf8'),
  ) as Record<string, unknown>;

const manifestSchema = loadSchema('external-manifest.schema.json');
const uiSchema = loadSchema('external-ui.schema.json');

const ajv = new Ajv({ allowUnionTypes: true });
const validManifest = ajv.compile(manifestSchema);
const validScreen = ajv.compile(uiSchema);

const manifest = (): Record<string, unknown> => ({
  contract: { major: SUPPORTED_CONTRACT_MAJORS[0], minor: 0 },
  pluginId: 'weather',
  version: '0.1.0',
  nameKey: 'weather.name',
  icon: 'CloudSun',
  scopeModel: 'per-scope',
  permissions: [
    'inventory:read',
    'inventory:destructive',
    'instance:logistics:read',
    'capability:chat.vision-completion',
  ],
  i18n: {
    en: {
      weather: {
        name: 'Weather',
        nav: 'Weather',
        tool: 'Reads the forecast',
        param: 'City name',
        widget: 'Now',
        feature: 'Forecast',
      },
    },
  },
  screens: ['home', 'settings'],
  nav: [{ screen: 'home', titleKey: 'weather.nav', icon: 'CloudSun' }],
  widgets: [
    {
      key: 'now',
      screen: 'home',
      titleKey: 'weather.widget',
      icon: 'CloudSun',
    },
  ],
  slots: [{ slot: 'storages.cell', screen: 'home' }],
  settingsScreen: 'settings',
  tools: [
    {
      name: 'forecast',
      descriptionKey: 'weather.tool',
      permission: 'READ',
      parameters: {
        properties: {
          city: { type: 'string', descriptionKey: 'weather.param' },
        },
        required: ['city'],
      },
    },
  ],
  capabilities: [{ id: 'weather.current-conditions', version: '1' }],
  objectRefs: [{ entityType: 'station', screen: 'home' }],
  events: ['core.scope-deleted'],
  exchange: true,
  purgeHook: true,
  publicPaths: ['', 'webhook/incoming'],
  uxFeatures: [{ key: 'weather.forecast', labelKey: 'weather.feature' }],
});

const screen = (): Record<string, unknown> => ({
  title: { key: 't' },
  refs: ['mk://weather/station/1'],
  children: [
    { type: 'text', text: { key: 'k' }, variant: 'heading' },
    { type: 'badge', text: { key: 'k' }, tone: 'brand' },
    { type: 'stat', label: { key: 'k' }, value: '21', unit: { key: 'u' } },
    { type: 'callout', text: { key: 'k' }, tone: 'warning' },
    { type: 'divider' },
    {
      type: 'button',
      label: { key: 'k' },
      onClick: { action: 'go', params: { id: '1', force: true, n: 2 } },
      variant: 'danger',
      confirm: { key: 'sure' },
    },
    {
      type: 'detail',
      rows: [
        { label: { key: 'k' }, value: 'v', ref: 'mk://weather/station/1' },
      ],
    },
    {
      type: 'table',
      filterable: true,
      pageSize: 10,
      paging: {
        page: 0,
        pageSize: 10,
        hasMore: true,
        sort: { key: 'name', direction: 'asc' },
      },
      columns: [{ key: 'name', label: { key: 'k' }, sortable: true }],
      rows: [
        {
          cells: { name: { text: 'row', badge: { text: { key: 'k' } } } },
          onClick: { action: 'open' },
          action: {
            label: { key: 'k' },
            onClick: { action: 'del' },
            confirm: { key: 'sure' },
          },
        },
      ],
      empty: { key: 'none' },
    },
    {
      type: 'list',
      items: [
        {
          title: { key: 'k' },
          subtitle: 's',
          badge: { text: { key: 'k' }, tone: 'success' },
          onClick: { action: 'open' },
        },
      ],
      empty: { key: 'none' },
    },
    {
      type: 'form',
      fields: [
        {
          name: 'city',
          type: 'select',
          label: { key: 'k' },
          required: true,
          value: 'x',
          width: 'half',
          reloadOnChange: true,
          options: [{ value: 'x', label: { key: 'k' } }],
        },
        { name: 'token', type: 'password', label: { key: 'k' }, hintKey: 'h' },
      ],
      submit: { label: { key: 'k' }, onSubmit: { action: 'save' } },
    },
    {
      type: 'section',
      title: { key: 'k' },
      children: [{ type: 'text', text: { key: 'k' } }],
    },
  ],
});

describe('published JSON-Schema artifacts', () => {
  it('accepts a manifest the TypeScript validator accepts', () => {
    const value = manifest();
    expect(validateExternalManifest(value).ok).toBe(true);
    expect(validManifest(value)).toBe(true);
  });

  it('rejects structural breakage the validator also rejects', () => {
    const cases: Array<(m: Record<string, unknown>) => void> = [
      (m) => delete m['pluginId'],
      (m) => (m['pluginId'] = 'Weather Station'),
      (m) => (m['scopeModel'] = 'global'),
      (m) => (m['permissions'] = ['inventory:destroy']),
      (m) => (m['publicPaths'] = ['/leading-slash']),
      (m) => (m['publicPaths'] = ['mk/tool']),
      (m) => delete (m['i18n'] as Record<string, unknown>)['en'],
      (m) => (m['screens'] = ['Home!']),
      (m) => (m['contract'] = {}),
    ];
    for (const mutate of cases) {
      const value = manifest();
      mutate(value);
      expect(validManifest(value)).toBe(false);
      expect(validateExternalManifest(value).ok).toBe(false);
    }
  });

  it('accepts a screen the sanitizer keeps whole', () => {
    const value = screen();
    expect(validScreen(value)).toBe(true);
    const sanitized = sanitizeUiScreen(value);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.dropped).toEqual([]);
    // Nothing was silently reshaped either: same node count, same types.
    expect(sanitized?.screen.children).toHaveLength(
      (value['children'] as unknown[]).length,
    );
  });

  it('rejects trees whose nodes the sanitizer would drop', () => {
    const broken: unknown[] = [
      { title: { key: 't' }, children: [{ type: 'iframe', src: 'x' }] },
      {
        title: { key: 't' },
        children: [{ type: 'button', label: { key: 'k' } }],
      },
      { title: 't-not-a-UiText', children: [] },
    ];
    for (const value of broken) {
      expect(validScreen(value)).toBe(false);
    }
    // And the sanitizer agrees: unknown/malformed nodes are dropped…
    const dropped = sanitizeUiScreen({
      title: { key: 't' },
      children: [{ type: 'iframe', src: 'x' }],
    });
    expect(dropped?.screen.children).toEqual([]);
    expect(dropped?.dropped).toHaveLength(1);
    // …and a screen without a real title does not render at all.
    expect(sanitizeUiScreen({ title: 't', children: [] })).toBeNull();
  });

  it('validates action results (screen or commands)', () => {
    const validResult = ajv.compile({
      ...uiSchema,
      $id: 'https://makekeeper.app/schemas/external-ui-result.schema.json',
      $ref: '#/$defs/actionResult',
    });
    expect(validResult({ screen: screen() })).toBe(true);
    expect(
      validResult({
        commands: [
          { command: 'toast', tone: 'success', text: { key: 'k' } },
          { command: 'navigate', ref: 'mk://weather/station/1' },
          { command: 'refresh', toast: { tone: 'error', text: { key: 'k' } } },
        ],
      }),
    ).toBe(true);
    expect(validResult({ commands: [{ command: 'alert' }] })).toBe(false);
  });
});
