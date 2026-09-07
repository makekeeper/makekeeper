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
//
// Since #342 the family is two pages, not one: About is a route of its own
// because it is the only part of this list that is NOT admin territory. The
// picker they share moved to `updates-sections.ts`, and the guard follows it —
// a page-shape guard that watched only one of the two would pass while the two
// drifted apart.

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

// The mirror's half of the feedback route lives outside this lib; the two
// halves only work if they agree, so the guard reads both.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const readRepo = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), 'utf8');

const templateOf = (source: string): string => {
  const at = source.indexOf('<template>');
  return at < 0 ? '' : source.slice(at);
};

// Named rather than globbed, for the same reason #262's guard is: a negative
// assertion over every `.vue` in the directory quietly starts covering
// unrelated components and then passes for the wrong reason.
const PAGES = ['UpdatesView.vue', 'AboutView.vue'];
const VIEWS = [
  ...PAGES,
  'VersionSection.vue',
  'AutoCheckSection.vue',
  'UpdateSection.vue',
  'InstallMethodSection.vue',
  'AboutSection.vue',
  'CountingSection.vue',
];
const SOURCE = VIEWS.map(read).join('\n');
const TEMPLATE = VIEWS.map((name) => templateOf(read(name))).join('\n');
const VIEW = read('UpdatesView.vue');
const NAV = read('updates-sections.ts');

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
    expect(NAV).toContain('to: updateSectionRoute(');
    expect(VIEW).toContain('isUpdateSection');
    expect(templateOf(VIEW)).toContain('<SectionNav');
    expect(templateOf(VIEW)).toContain('<KeepAlive>');
  });

  it('shows one picker on both pages of the family (#342)', () => {
    // Neither page builds a list of its own, and About leads it — the section
    // order is the reading order, wherever the reader entered.
    for (const page of PAGES) {
      expect(read(page)).toContain('buildUpdatesNav');
      expect(templateOf(read(page))).toContain('<SectionNav');
    }
    expect(NAV.indexOf("key: 'about'")).toBeLessThan(
      NAV.indexOf("key: 'version'"),
    );
    // About is reachable without the admin gate the rest of the page sits
    // behind — that is the whole reason it is a route.
    expect(read('index.ts')).toContain("name: 'settings-about'");
    const registration = read('index.ts');
    const about = registration.indexOf("name: 'settings-about'");
    const updates = registration.indexOf("name: 'settings-updates'");
    expect(registration.slice(about, updates)).not.toContain('adminOnly');
  });

  it('keeps the version check in the view, so the badge is right anywhere', () => {
    expect(VIEW).toContain('store.refresh()');
    expect(VIEW).toContain('store.refreshInstallInfo()');
    expect(VIEW).toContain('store.refreshDeployHook()');
    // …and the badge itself rides the picker, not the pane.
    expect(NAV).toContain('badge: updateAvailable ? 1 : 0');
    expect(NAV).toContain("t('settings.updates.sections.attention')");
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
    // Three folds now, and every one of them holds reference material read
    // once: the update recipes (#272), what a bug report will carry (#342), and
    // what the install report carries (#343). None of them hides an action.
    expect(SOURCE.match(/<Disclosure\b/g)).toHaveLength(3);
    expect(read('AboutSection.vue')).toContain(
      'const previewOpen = ref(false)',
    );
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

  it('leaves shared state in a store rather than threading props', () => {
    // A pane reads what it needs from a store — the update store for the four
    // that share the page's fetches, the telemetry store for the one whose
    // state is its own (#343). What none of them may do is take props: the
    // page would then own the panes' state and the panes would stop being
    // openable on their own.
    for (const name of VIEWS.filter((view) => !PAGES.includes(view))) {
      const source = read(name);
      expect(source).toMatch(/use(Update|Telemetry|Plugins|Version)Store/);
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

  // The prefill is a contract across two files that never import each other:
  // the app builds `?template=<file>&<field>=…`, GitHub matches those against
  // the template it finds on the mirror. Rename either side and the prefill
  // stops arriving with no error anywhere (#342).
  it('prefills a bug form that the published template actually defines', () => {
    const feedback = read('feedback.ts');
    const template = readRepo(
      '.forgejo/publish/github/ISSUE_TEMPLATE/bug_report.yml',
    );
    const file = /const BUG_TEMPLATE = '([^']+)'/.exec(feedback)?.[1];
    const field = /const ENVIRONMENT_FIELD = '([^']+)'/.exec(feedback)?.[1];
    expect(file).toBe('bug_report.yml');
    expect(field).toBeTruthy();
    expect(template).toContain(`id: ${field}`);
    // …and the snapshot plants it, or the mirror never sees the template.
    expect(readRepo('.forgejo/publish/snapshot.sh')).toContain(
      '.github/ISSUE_TEMPLATE',
    );
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

  // The shell's two feedback entries land on this one page and name the action
  // they came for in the query (#342). The two halves live in different
  // projects and cannot import each other, so the agreement is only checkable
  // from one of them: the shell sends `action=bug|idea`, and this page has to
  // read that key and mark the matching card.
  it('marks the action the shell sent the reader for', () => {
    const about = readRepo(
      'libs/plugin-settings/src/frontend/AboutSection.vue',
    );
    const shell = readRepo('apps/frontend/src/app/FeedbackLinks.vue');

    const sent = [...shell.matchAll(/action: '([a-z]+)'/g)].map((m) => m[1]);
    expect(sent).toEqual(['bug', 'idea']);

    expect(about).toContain("route.query['action']");
    expect(about).toContain('action.key === requested');
    // Every action the shell can ask for is a card that exists here.
    for (const key of sent) expect(about).toContain(`key: '${key}'`);
  });
});
