import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A drift guard over the admin surface's TEMPLATES (#147).
//
// Why a file-content test and not a mounted component: the failure this
// catches is not a rendering bug, it is a whole feature going missing. The
// discovery controls were added to the script half of this view and silently
// never reached the template — an exact-match edit that no longer matched
// after the file had been reformatted. Everything still compiled, lint was
// clean, the endpoints were verified live, and the page shipped without the
// controls. A test that reads the template would have caught it in seconds.
//
// It also checks i18n completeness for those keys in both locales, which is
// the other half of "the button exists but says nothing".
//
// The page is four section components now (#262), so the guard reads all of
// them: which file a control lives in is exactly the kind of thing this test
// must not care about.

const read = (name: string): string =>
  readFileSync(join(__dirname, name), 'utf8');

const templateOf = (source: string): string => {
  const at = source.indexOf('<template>');
  return at < 0 ? '' : source.slice(at);
};

// The four sections plus the card and the view that hosts them. Named rather
// than globbed: a negative assertion ("this shape must be gone") over every
// `.vue` in the directory quietly starts covering unrelated components, and
// then passes for the wrong reason.
const VIEWS = [
  'ExternalPluginsView.vue',
  'ConnectSection.vue',
  'ConnectedSection.vue',
  'BudgetsSection.vue',
  'TokensSection.vue',
  'PluginCard.vue',
  'SectionShell.vue',
];
const SOURCE = VIEWS.map(read).join('\n') + read('external-admin.ts');
const TEMPLATE = VIEWS.map((name) => templateOf(read(name))).join('\n');

// Every section component must be listed above, or the guard silently stops
// watching the one that was added.
const SECTION_FILES = readdirSync(__dirname).filter((name) =>
  name.endsWith('Section.vue'),
);

const en = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'en.json'), 'utf8'),
) as Record<string, Record<string, Record<string, string>>>;
const ru = JSON.parse(
  readFileSync(join(__dirname, '..', 'i18n', 'ru.json'), 'utf8'),
) as Record<string, Record<string, Record<string, string>>>;

describe('external plugins admin view', () => {
  it('offers pairing, not only the install token', () => {
    // The token path is for headless installs; an admin sitting in front of
    // the UI must be offered the pairing window.
    expect(TEMPLATE).toContain('openPairing');
    expect(TEMPLATE).toContain('closePairing');
    expect(TEMPLATE).toContain('external.discovery.open');
  });

  it('renders the candidate list with a code field and both actions', () => {
    expect(TEMPLATE).toContain('external.discovery.title');
    expect(TEMPLATE).toContain('candidate in admin.candidates.value');
    expect(TEMPLATE).toContain('external.discovery.codeLabel');
    expect(TEMPLATE).toContain('pair(candidate)');
  });

  it('offers ignore rather than a dismiss the container would undo', () => {
    // Containers re-announce every ~20s, so a deleted card comes straight
    // back; ignoring is what actually sticks.
    expect(TEMPLATE).toContain('setIgnored(candidate, true)');
    expect(TEMPLATE).toContain('external.discovery.ignore');
    // …and it must be reversible, or a mis-click is permanent.
    expect(TEMPLATE).toContain('setIgnored(candidate, false)');
    expect(TEMPLATE).toContain('external.discovery.filterIgnored');
  });

  it('labels a candidate as self-asserted and flags an id conflict', () => {
    // Both are what keep a candidate card honest about what it does and does
    // not prove.
    expect(TEMPLATE).toContain('external.discovery.selfAsserted');
    expect(TEMPLATE).toContain('conflictsWithInstalled');
  });

  it('tells the admin when a container is knocking with the window shut', () => {
    expect(TEMPLATE).toContain('external.discovery.knocking');
    expect(TEMPLATE).toContain('external.discovery.openKnocking');
  });

  it('offers a plugin its settings inside its own card', () => {
    // Settings used to be a guest tab of the Settings hub, one per plugin,
    // which shreds that hub as soon as a few are installed. They belong to the
    // card the admin already manages the plugin from.
    expect(TEMPLATE).toContain('external.card.settings');
    expect(TEMPLATE).toContain('<ExternalScreen');
    // Collapsed by default: rendering is a round trip to the container.
    expect(TEMPLATE).toContain('settingsOpen = !settingsOpen');
    expect(TEMPLATE).toContain('aria-expanded');
  });

  it('collapses a card to a strip, keeping the decisions on it', () => {
    // The strip is what an admin scrolling a list of plugins actually needs:
    // which plugin, what state, and the switches that do not require reading
    // anything to be safe.
    expect(TEMPLATE).toContain('@click="toggleCard"');
    expect(TEMPLATE).toContain('v-if="isOpen"');
    // Enable/disable and uninstall stay on the collapsed row…
    const strip = TEMPLATE.slice(
      TEMPLATE.indexOf('@click="toggleCard"'),
      TEMPLATE.indexOf('external.card.baseUrl'),
    );
    expect(strip).toContain('admin.setEnabled(plugin, v)');
    expect(strip).toContain("emit('uninstall', plugin)");
    expect(strip).toContain('admin.approve(plugin)');
  });

  it('shows each plugin its own icon, on the row with its name', () => {
    // Three rows starting with the same fallback box are read as three copies
    // of the same thing; the icon is how a list of plugins is scanned.
    expect(TEMPLATE).toContain('admin.iconOf(plugin.manifest)');
    expect(TEMPLATE).toContain('admin.iconOf(candidate.manifest)');
  });

  it('offers no settings and no consent for a plugin that is off', () => {
    // A switch reading "on" under a disabled plugin describes a permission
    // nothing can use — its tools are unregistered the moment it goes off.
    // Asserted here because the first attempt at this silently did not apply.
    expect(SOURCE).toContain("plugin.status === 'active'");
    expect(TEMPLATE).toContain('external.card.disabledNoSettings');
    expect(TEMPLATE).not.toContain(
      "plugin.status !== 'pending' && (plugin.manifest.tools ?? []).length > 0",
    );
  });

  it('never hides a decision behind a chevron', () => {
    // Consenting to permissions you cannot see is not consent: a pending
    // install and a parked update open themselves and have no toggle.
    expect(TEMPLATE).toContain('v-if="!needsDecision"');
    expect(SOURCE).toContain('if (needsDecision.value) return;');
  });

  it('gives a public plugin its connection address, copyable, with its own hint', () => {
    // A plugin whose product IS an endpoint (mk-plugin-mcp) is configured
    // elsewhere — in an MCP client — so the address has to be takeable from
    // here, and the line explaining it comes from the plugin's own bundles.
    expect(TEMPLATE).toContain('external.card.publicUrl');
    expect(TEMPLATE).toContain('v-if="publicUrl"');
    expect(TEMPLATE).toContain('v-if="publicHint"');
    expect(TEMPLATE).toContain('<CopyField');
  });

  it('lets both token windows be closed by taking the token', () => {
    // The token is shown exactly once: the exit from the window must be the
    // same click that puts it on the clipboard, not a separate one.
    expect(TEMPLATE).toContain('external.installToken.copyAndClose');
    expect(SOURCE).toContain('installOpen.value = false');
    expect(SOURCE).toContain('issuedOpen.value = false');
    // …and the value itself is a copy row, not a block of text to select.
    expect(TEMPLATE).toContain(':value="issuedValue"');
    expect(TEMPLATE).toContain(':value="installValue"');
  });

  it('keeps the install token with connecting a plugin, explained (#262)', () => {
    // It installs a PLUGIN; the connection tokens authenticate an outside
    // CLIENT. Filed together, the two get handed out for the wrong job — and a
    // bare "Generate" button says nothing about which is which.
    const connect = read('ConnectSection.vue');
    const tokens = read('TokensSection.vue');
    expect(connect).toContain('external.installToken.generate');
    expect(connect).toContain('external.installToken.purpose');
    for (const step of ['step1', 'step2', 'step3']) {
      expect(connect).toContain(`external.installToken.${step}`);
    }
    // Not issued from Tokens — but Tokens is where #262 said it would be, so
    // the section that does not have it must point at the one that does.
    expect(tokens).not.toContain('external.installToken.generate');
    expect(tokens).toContain('external.connectionTokens.installTokenElsewhere');
    expect(tokens).toContain(':to="connectTo"');
  });

  it('watches every section component that exists (#262)', () => {
    // The guard reads a NAMED list; a section added without being listed would
    // be unwatched, and this assertion is what says so out loud.
    for (const name of SECTION_FILES) expect(VIEWS).toContain(name);
  });

  it('splits the page into route-driven sections (#262)', () => {
    // The section is route state, not a local ref: reload, back/forward and a
    // pasted link must all land on the same section.
    expect(SOURCE).toContain("useRouteQuery('section'");
    // One mechanism only: every way into a section is a route the picker and
    // the in-page buttons both link to, never a second writable ref.
    expect(SOURCE).not.toContain('sectionQuery.value =');
    expect(SOURCE).toContain('sectionRoute(');
    expect(TEMPLATE).toContain('<SectionNav');
    // Sections are kept alive: switching away used to discard a half-edited
    // budget form and refetch everything on the way back.
    expect(TEMPLATE).toContain('<KeepAlive>');
    for (const name of ['connect', 'settings', 'tokens', 'connected']) {
      expect(SOURCE).toContain(`external.sections.${name}.title`);
    }
  });

  it('lets a closed section still ask for attention', () => {
    // An install waiting for consent, or a container knocking, is invisible
    // while another section is open — unless the picker carries the count.
    expect(SOURCE).toContain(
      'badge: admin.pairing.value.knocking + admin.awaitingApproval.value.length',
    );
    expect(SOURCE).toContain('badge: admin.pendingUpdates.value');
    // …and the count has to say what it counts: on its own it is announced as
    // "Connect 2".
    expect(SOURCE).toContain("t('external.sections.attention'");
    expect(SOURCE).toContain('badgeLabel: attention(');
  });

  it('keeps a refused pairing code in the field', () => {
    // Wiping it on every attempt makes one mistyped digit cost the whole code,
    // which expires while it is retyped.
    expect(SOURCE).toContain('if (paired) setCode(candidate');
  });

  it('defines every card key it uses, in both locales', () => {
    const used = [...TEMPLATE.matchAll(/external\.card\.([A-Za-z]+)/g)].map(
      (match) => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      expect(en['external']['card'][key]).toBeDefined();
      expect(ru['external']['card'][key]).toBeDefined();
    }
  });

  it('defines every discovery key it uses, in both locales', () => {
    const used = [
      ...TEMPLATE.matchAll(/external\.discovery\.([A-Za-z]+)/g),
    ].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of new Set(used)) {
      expect(en['external']['discovery'][key]).toBeDefined();
      expect(ru['external']['discovery'][key]).toBeDefined();
    }
  });

  it('defines every section key it uses, in both locales', () => {
    const used = [
      ...SOURCE.matchAll(/external\.sections\.([A-Za-z]+)\.([A-Za-z]+)/g),
    ];
    expect(used.length).toBeGreaterThan(0);
    for (const [, section, key] of used) {
      expect(en['external']['sections'][section]).toHaveProperty(key);
      expect(ru['external']['sections'][section]).toHaveProperty(key);
    }
  });
});
