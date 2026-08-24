import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A drift guard over the Updates page (#267), modelled on
// `libs/plugin-external/src/frontend/external-view.spec.ts`.
//
// The page was 815 lines in one scroll; what this watches is that it stays
// four panes: one write mechanism for the section, no fold creeping back, the
// update badge on the picker rather than only inside the Version pane, and the
// fetches staying in the view (a badge fed from a section is wrong on every
// page that did not open at that section).

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

const templateOf = (source: string): string => {
  const at = source.indexOf('<template>');
  return at < 0 ? '' : source.slice(at);
};

// Named rather than globbed, for the same reason #262's guard is: a negative
// assertion over every `.vue` in the directory quietly starts covering
// unrelated components and then passes for the wrong reason.
const VIEWS = [
  'UpdatesView.vue',
  'VersionSection.vue',
  'AutoCheckSection.vue',
  'UpdateSection.vue',
  'InstallMethodSection.vue',
];
const SOURCE = VIEWS.map(read).join('\n');
const TEMPLATE = VIEWS.map((name) => templateOf(read(name))).join('\n');
const VIEW = read('UpdatesView.vue');

// Every section component of this page must be listed above, or the guard
// silently stops watching the one that was added. Sections belonging to other
// pages of the epic are matched by name and excluded.
const OTHER_PAGES = ['AgentToolsSection.vue', 'ApiSection.vue'];
const SECTION_FILES = readdirSync(__dirname).filter(
  (name) => name.endsWith('Section.vue') && !OTHER_PAGES.includes(name),
);

const en = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'en.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
const ru = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'ru.json'), 'utf8'),
) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

describe('updates view (#267)', () => {
  it('watches every section component of the page', () => {
    for (const name of SECTION_FILES) expect(VIEWS).toContain(name);
  });

  it('splits the page into route-driven sections, keyed by a literal union', () => {
    expect(VIEW).toContain("useRouteQuery('section'");
    expect(VIEW).not.toContain('sectionQuery.value =');
    expect(VIEW).toContain('to: sectionRoute(');
    expect(VIEW).toContain('isSection');
    expect(templateOf(VIEW)).toContain('<SectionNav');
    expect(templateOf(VIEW)).toContain('<KeepAlive>');
  });

  it('keeps the version check in the view, so the badge is right anywhere', () => {
    expect(VIEW).toContain('store.refresh()');
    expect(VIEW).toContain('store.refreshInstallInfo()');
    expect(VIEW).toContain('store.refreshDeployHook()');
    // …and the badge itself rides the picker, not the pane.
    expect(VIEW).toContain('badge: store.updateAvailable ? 1 : 0');
    expect(VIEW).toContain("t('settings.updates.sections.attention')");
  });

  it('folds what is read, never what is done (#272)', () => {
    // #267's two folds were workarounds for a scroll and are not coming back:
    // no per-card toggles, and nothing hand-rolls a disclosure.
    expect(SOURCE).not.toContain('toggleGuide');
    expect(SOURCE).not.toContain('toggleSource');
    expect(SOURCE).not.toContain('guideOpen');
    expect(SOURCE).not.toContain('sourceOpen');
    expect(SOURCE).not.toContain('<details');
    // The one fold that exists is the shared primitive, holds the reference
    // material only, and is closed on arrival.
    const UPDATE = read('UpdateSection.vue');
    expect(SOURCE.match(/<Disclosure\b/g)).toHaveLength(1);
    expect(UPDATE).toContain('const referenceOpen = ref(false)');
    // The action half stays above it, open, in the card the fold cannot reach.
    const action = UPDATE.indexOf('settings.updates.hook.save');
    const fold = UPDATE.indexOf('<Disclosure');
    expect(action).toBeGreaterThan(0);
    expect(action).toBeLessThan(fold);
    // …and the pane says the fold is there rather than leaving it to be found,
    // from the section's action row — the link is a control, and it does not
    // crowd the heading to prove it.
    const actions = templateOf(UPDATE).split('</template>')[0];
    expect(actions).toContain('#actions');
    expect(actions).toContain('aria-controls="updates-reference"');
    // The `SegmentedControl`s stay — they pick a value, not a pane.
    expect(TEMPLATE).toContain('<SegmentedControl');
  });

  it('keeps the recipe panel from resizing when the manager changes', () => {
    // Recipes differ in step count: render one and the fold — plus every
    // pixel under it — jumps under the cursor. All four are laid into one
    // grid cell, the inactive ones invisible.
    const UPDATE = templateOf(read('UpdateSection.vue'));
    expect(UPDATE).toContain('v-for="entry in recipes"');
    expect(UPDATE).toContain('col-start-1 row-start-1');
    expect(UPDATE).toContain("'invisible'");
  });

  it('leaves shared update state in the store rather than threading props', () => {
    for (const name of VIEWS.slice(1)) {
      const source = read(name);
      expect(source).toContain('useUpdateStore');
      expect(source).not.toContain('defineProps');
    }
  });

  it('puts each action in the section that owns it', () => {
    // "Check now" belongs to Version, "Update now" to Update; the page header
    // keeps only what is page-wide.
    expect(read('VersionSection.vue')).toContain('settings.updates.checkNow');
    expect(read('UpdateSection.vue')).toContain('onUpdateNow');
    expect(templateOf(VIEW)).not.toContain('<Button');
  });

  it('defines every section key it uses, in both locales', () => {
    const used = [
      ...SOURCE.matchAll(/settings\.updates\.sections\.([A-Za-z]+)/g),
    ].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      expect(en['settings']['updates']['sections']).toHaveProperty(key);
      expect(ru['settings']['updates']['sections']).toHaveProperty(key);
    }
  });
});
