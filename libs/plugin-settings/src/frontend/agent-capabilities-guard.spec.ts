import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A drift guard over the agent-capabilities page (#265), modelled on
// `libs/plugin-external/src/frontend/external-view.spec.ts`.
//
// Why a file-content test next to the mounted one: what it watches is not a
// rendering bug but a shape. The section layout has exactly one write
// mechanism — links built by `sectionRoute` — and a second one (assigning the
// query ref) would still pass every behavioural test while quietly breaking
// "open in a new tab" and the back button. Same for the fold this ticket
// removed: a leftover localStorage read compiles, lints and renders fine.

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

const templateOf = (source: string): string => {
  const at = source.indexOf('<template>');
  return at < 0 ? '' : source.slice(at);
};

const VIEWS = [
  'AgentCapabilitiesView.vue',
  'AgentToolsSection.vue',
  'SectionShell.vue',
];
const SOURCE = VIEWS.map(read).join('\n') + read('agent-tools.ts');
const TEMPLATE = VIEWS.map((name) => templateOf(read(name))).join('\n');

const en = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'en.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, string>>>>;
const ru = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'ru.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, string>>>>;

describe('agent capabilities view (#265)', () => {
  it('splits the page into route-driven sections', () => {
    expect(SOURCE).toContain("useRouteQuery('section'");
    // One mechanism only: every way into a section is a route the picker
    // links to, never a second writable ref.
    expect(SOURCE).not.toContain('sectionQuery.value =');
    expect(SOURCE).toContain('sectionRoute(');
    expect(TEMPLATE).toContain('<SectionNav');
    // The picker's items are links, so a section opens in a new tab.
    expect(SOURCE).toContain('to: sectionRoute(');
  });

  it('keeps the open section alive across a switch', () => {
    expect(TEMPLATE).toContain('<KeepAlive>');
    // Keyed per plugin, or every section shares one cached instance and the
    // KeepAlive silently does nothing.
    expect(TEMPLATE).toContain(':key="activeGroup.pluginId"');
  });

  it('has no fold and no memory of one', () => {
    // The page used to persist which groups were folded away — the layout's
    // own workaround, stored.
    expect(SOURCE).not.toContain('agentCapabilities:collapsedGroups');
    expect(SOURCE).not.toContain('localStorage.getItem');
    expect(SOURCE).not.toContain('localStorage.setItem');
    expect(TEMPLATE).not.toContain('aria-expanded');
  });

  it('carries the auto-run count on the picker, not only inside the pane', () => {
    expect(SOURCE).toContain('badge: auto');
    expect(SOURCE).toContain("t('settings.agentCapabilities.sections.autoRun'");
    expect(SOURCE).toContain('badgeLabel:');
  });

  it('defines every section key it uses, in both locales', () => {
    const used = [
      ...SOURCE.matchAll(/settings\.agentCapabilities\.sections\.([A-Za-z]+)/g),
    ].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      expect(en['settings']['agentCapabilities']['sections']).toHaveProperty(
        key,
      );
      expect(ru['settings']['agentCapabilities']['sections']).toHaveProperty(
        key,
      );
    }
  });
});
