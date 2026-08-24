import {
  parseExternalPermission,
  permissionSetCovers,
  publicPathCovers,
  validateExternalManifest,
  SUPPORTED_CONTRACT_MAJORS,
} from './external-manifest';
import { PermissionLevel } from '../agent-types';

// A minimal valid manifest the negative cases mutate. en bundle carries every
// referenced key, per the completeness rule.
const base = (): Record<string, unknown> => ({
  contract: { major: SUPPORTED_CONTRACT_MAJORS[0], minor: 0 },
  pluginId: 'weather',
  version: '0.1.0',
  nameKey: 'weather.name',
  icon: 'CloudSun',
  scopeModel: 'instance',
  permissions: [
    'inventory:read',
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
      },
    },
  },
  screens: ['home', 'settings'],
  nav: [{ screen: 'home', titleKey: 'weather.nav', icon: 'CloudSun' }],
  settingsScreen: 'settings',
});

describe('parseExternalPermission', () => {
  it('parses the three classes', () => {
    expect(parseExternalPermission('inventory:read')).toEqual({
      raw: 'inventory:read',
      class: 'scoped',
      target: 'inventory',
      access: 'read',
    });
    expect(parseExternalPermission('instance:logistics:read')?.class).toBe(
      'instance',
    );
    expect(
      parseExternalPermission('capability:chat.vision-completion')?.target,
    ).toBe('chat.vision-completion');
  });

  it('parses the destructive scoped access (1.11)', () => {
    expect(parseExternalPermission('inventory:destructive')).toEqual({
      raw: 'inventory:destructive',
      class: 'scoped',
      target: 'inventory',
      access: 'destructive',
    });
  });

  it('rejects grammar violations', () => {
    expect(parseExternalPermission('inventory:delete')).toBeNull();
    // The instance surface is read-only by design.
    expect(parseExternalPermission('instance:logistics:write')).toBeNull();
    expect(parseExternalPermission('capability:no-prefix')).toBeNull();
    expect(parseExternalPermission('Weird:read')).toBeNull();
  });
});

describe('permissionSetCovers', () => {
  it('detects expansion for the update diff policy', () => {
    expect(permissionSetCovers(['a:read', 'b:write'], ['a:read'])).toBe(true);
    expect(permissionSetCovers(['a:read'], ['a:read', 'a:write'])).toBe(false);
  });
});

describe('validateExternalManifest', () => {
  it('accepts a well-formed manifest', () => {
    const res = validateExternalManifest(base());
    expect(res.ok).toBe(true);
  });

  it('accepts a slot contribution with a labelKey (#277)', () => {
    const m = base();
    m['slots'] = [
      { slot: 'app.header.scan', screen: 'home', labelKey: 'weather.nav' },
    ];
    expect(validateExternalManifest(m).ok).toBe(true);
  });

  it('rejects a non-string slot labelKey', () => {
    const m = base();
    m['slots'] = [{ slot: 'app.header.scan', screen: 'home', labelKey: 7 }];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('i18n-key-missing');
    }
  });

  it('rejects a slot labelKey absent from the en bundle', () => {
    const m = base();
    m['slots'] = [
      { slot: 'app.header.scan', screen: 'home', labelKey: 'weather.nope' },
    ];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('i18n-key-unresolved');
    }
  });

  it('rejects an unsupported contract major with a single error', () => {
    const m = base();
    m['contract'] = { major: 999, minor: 0 };
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].code).toBe('contract-unsupported');
    }
  });

  it('rejects a missing en bundle', () => {
    const m = base();
    m['i18n'] = { ru: { weather: { name: 'Погода' } } };
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('i18n-en-missing');
    }
  });

  it('rejects a referenced key absent from the en bundle', () => {
    const m = base();
    m['nameKey'] = 'weather.missing';
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('i18n-key-unresolved');
    }
  });

  it('rejects a nav item pointing at an undeclared screen', () => {
    const m = base();
    m['nav'] = [{ screen: 'ghost', titleKey: 'weather.nav', icon: 'CloudSun' }];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('screen-unknown');
    }
  });

  // #269: an entry hidden in simple mode must be reachable from the settings
  // panel, which means naming a feature the manifest actually declares.
  it('rejects an advanced nav item with no uxFeatureKey', () => {
    const m = base();
    m['nav'] = [
      {
        screen: 'home',
        titleKey: 'weather.nav',
        icon: 'CloudSun',
        advanced: true,
      },
    ];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain(
        'nav-ux-feature-key-missing',
      );
    }
  });

  it('rejects a nav item keyed to an undeclared ux feature', () => {
    const m = base();
    m['nav'] = [
      {
        screen: 'home',
        titleKey: 'weather.nav',
        icon: 'CloudSun',
        advanced: true,
        uxFeatureKey: 'weather.ghost',
      },
    ];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('nav-ux-feature-unknown');
    }
  });

  it('accepts an advanced nav item keyed to a declared ux feature', () => {
    const m = base();
    m['nav'] = [
      {
        screen: 'home',
        titleKey: 'weather.nav',
        icon: 'CloudSun',
        advanced: true,
        uxFeatureKey: 'weather.page',
      },
    ];
    // `defaultAdvanced: false` — a simple-tier surface the user may demote.
    m['uxFeatures'] = [
      {
        key: 'weather.page',
        labelKey: 'weather.nav',
        defaultAdvanced: false,
      },
    ];
    expect(validateExternalManifest(m).ok).toBe(true);
  });

  it('rejects a non-boolean defaultAdvanced', () => {
    const m = base();
    m['uxFeatures'] = [
      { key: 'weather.page', labelKey: 'weather.nav', defaultAdvanced: 'yes' },
    ];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('ux-feature-invalid');
    }
  });

  it('rejects a capability declared under a foreign prefix', () => {
    const m = base();
    m['capabilities'] = [{ id: 'chat.hijack', version: '1' }];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain(
        'capability-foreign-prefix',
      );
    }
  });

  it('rejects an invalid permission string', () => {
    const m = base();
    m['permissions'] = ['inventory:read', 'everything'];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain('permission-invalid');
    }
  });

  it('validates tool declarations', () => {
    const m = base();
    m['tools'] = [
      {
        name: 'get_forecast',
        descriptionKey: 'weather.tool',
        permission: PermissionLevel.READ,
        parameters: {
          properties: {
            city: { type: 'string', descriptionKey: 'weather.param' },
          },
          required: ['city'],
        },
      },
    ];
    expect(validateExternalManifest(m).ok).toBe(true);

    m['tools'] = [
      {
        name: 'get_forecast',
        descriptionKey: 'weather.tool',
        permission: 'ROOT',
        parameters: { properties: {} },
      },
    ];
    const res = validateExternalManifest(m);
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors.map((e) => e.code)).toContain(
        'tool-permission-invalid',
      );
    }
  });

  it('accepts declared public paths, including the whole-surface root (1.10)', () => {
    const m = base();
    m['publicPaths'] = ['', 'webhook', 'ingest/devices'];
    expect(validateExternalManifest(m).ok).toBe(true);
  });

  it('rejects malformed and reserved public paths', () => {
    for (const [value, code] of [
      [['/webhook'], 'public-path-invalid'], // leading slash
      [['webhook/'], 'public-path-invalid'], // trailing slash
      [['../mk'], 'public-path-invalid'],
      [['mk'], 'public-path-reserved'],
      [['mk/tool'], 'public-path-reserved'],
      ['webhook', 'public-paths-invalid'], // not an array
    ] as const) {
      const m = base();
      m['publicPaths'] = value;
      const res = validateExternalManifest(m);
      expect(res.ok).toBe(false);
      if (res.ok === false) {
        expect(res.errors.map((e) => e.code)).toContain(code);
      }
    }
  });
});

describe('publicPathCovers', () => {
  it('covers by exact segment prefix, with the empty string covering all', () => {
    expect(publicPathCovers([''], 'anything/at/all')).toBe(true);
    expect(publicPathCovers(['webhook'], 'webhook')).toBe(true);
    expect(publicPathCovers(['webhook'], 'webhook/incoming')).toBe(true);
    // A prefix is a SEGMENT prefix, not a string prefix.
    expect(publicPathCovers(['webhook'], 'webhooks')).toBe(false);
    expect(publicPathCovers(['webhook'], 'other')).toBe(false);
    expect(publicPathCovers([], 'anything')).toBe(false);
  });
});
