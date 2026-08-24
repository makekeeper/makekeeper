import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A drift guard over the generic settings host (#266), modelled on
// `libs/plugin-external/src/frontend/external-view.spec.ts`.
//
// The host renders other plugins' components, so a mounted test of it can only
// assert the frame. What actually has to hold is structural: one write
// mechanism for the section, no leftover fold, and the deep link other
// surfaces already point at still landing somewhere.

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

const SOURCE = read('SettingsView.vue');
const TEMPLATE = SOURCE.slice(SOURCE.indexOf('<template>'));

// The one out-of-plugin call site of the deep link (§5.10 — it lives in
// frontend-core, which both sides may import).
const CALLER = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'frontend-core',
    'src',
    'lib',
    'components',
    'PhoneBridgeModal.vue',
  ),
  'utf8',
);

const en = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'en.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, string>>>>;
const ru = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'ru.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, string>>>>;

describe('plugin settings host (#266)', () => {
  it('splits the host into route-driven sections', () => {
    expect(SOURCE).toContain("useRouteQuery('section'");
    // One mechanism only: the picker links, nothing assigns the query ref.
    expect(SOURCE).not.toContain('sectionQuery.value =');
    expect(SOURCE).toContain('to: sectionRoute(');
    expect(TEMPLATE).toContain('<SectionNav');
  });

  it('keeps the open panel alive across a switch', () => {
    // A half-filled provider form must survive a look at another plugin.
    expect(TEMPLATE).toContain('<KeepAlive>');
    expect(TEMPLATE).toContain(':key="activePanel.pluginId"');
  });

  it('has no fold, no memory of one, and no scroll-to-hash', () => {
    expect(SOURCE).not.toContain('pluginSettings:collapsedGroups');
    expect(SOURCE).not.toContain('localStorage.getItem');
    expect(SOURCE).not.toContain('localStorage.setItem');
    expect(SOURCE).not.toContain('focusFromHash');
    expect(SOURCE).not.toContain('scrollIntoView');
    expect(TEMPLATE).not.toContain('aria-expanded');
  });

  it('keeps the shared deep link working, in its new form and its old one', () => {
    // The caller moved to the query form…
    expect(CALLER).toContain("query: { section: 'phone-bridge' }");
    expect(CALLER).not.toContain("hash: '#settings-phone-bridge'");
    // …and a bookmarked hash still lands on the right section rather than
    // silently doing nothing.
    expect(SOURCE).toContain("'#settings-'");
    expect(SOURCE).toContain('redirectLegacyHash');
  });

  it('keeps the empty state for an instance whose plugins declare nothing', () => {
    expect(TEMPLATE).toContain('<EmptyState');
    expect(SOURCE).toContain('settings.pluginSettings.empty');
  });

  it('puts the version chip in the section header, on the shared Badge', () => {
    // The picker carries identity; metadata belongs to the section that owns it.
    expect(TEMPLATE).toContain('<Badge');
    expect(TEMPLATE).toContain('settings.pluginSettings.version');
    expect(TEMPLATE).toContain('#actions');
  });

  it('defines every section key it uses, in both locales', () => {
    const used = [
      ...SOURCE.matchAll(/settings\.pluginSettings\.sections\.([A-Za-z]+)/g),
    ].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      expect(en['settings']['pluginSettings']['sections']).toHaveProperty(key);
      expect(ru['settings']['pluginSettings']['sections']).toHaveProperty(key);
    }
  });
});
