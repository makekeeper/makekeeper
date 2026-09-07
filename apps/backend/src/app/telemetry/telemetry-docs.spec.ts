import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TELEMETRY_FIELDS } from '@makekeeper/plugin-contract';

// The promise this feature makes is "here is exactly what is sent" (#343), and
// that promise is spread over four files that never import each other: the
// field catalogue, the payload the sender builds, the table in INSTALL.md, and
// the receiver's validation. A field added to one of them and forgotten in the
// others turns the promise into a lie no reviewer would notice — the code would
// work perfectly.
//
// So the guard is the thing that keeps them one statement.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), 'utf8');

describe('telemetry documentation (#343)', () => {
  const keys = TELEMETRY_FIELDS.map((field) => field.key);

  it('documents every field in INSTALL.md, and documents no others', () => {
    const install = read('INSTALL.md');
    const table = install
      .split('<!-- telemetry-fields:start -->')[1]
      ?.split('<!-- telemetry-fields:end -->')[0];
    expect(table).toBeDefined();

    const documented = [...(table ?? '').matchAll(/^\| `([A-Za-z]+)`/gm)].map(
      (match) => match[1],
    );
    expect(documented.sort()).toEqual([...keys].sort());
  });

  // The receiver rejects a body whose key set is not exactly this one, which is
  // what stops a future field from arriving undocumented — but only while that
  // list and this one agree.
  it('accepts exactly these fields at the receiver', () => {
    const worker = read('deploy/telemetry/worker.js');
    const accepted = /keys !== '([^']+)'/.exec(worker)?.[1]?.split(',');
    expect(accepted).toBeDefined();
    expect([...(accepted ?? [])].sort()).toEqual([...keys].sort());
  });

  it('says out loud that consent is off by default', () => {
    const install = read('INSTALL.md');
    expect(install).toContain('opt-in, off by default');
    expect(install).toContain('MK_TELEMETRY_ENDPOINT');
  });

  // The field table was guarded from the first commit; the PROSE around it was
  // not, and drifted within the day — it still sent readers to Settings → About
  // after the switch moved into its own section. A reader following the manual
  // to opt out landed on a page with no switch, which is the one instruction in
  // this file that has to work.
  it('sends a reader to the section the switch is actually in', () => {
    const install = read('INSTALL.md');
    const section = JSON.parse(
      read('libs/plugin-settings/src/i18n/en.json'),
    ) as {
      settings: {
        updates: { sections: { counting: { title: string } } };
      };
    };

    expect(install).toContain(section.settings.updates.sections.counting.title);
    // The old address, which no longer has the switch on it.
    expect(install).not.toContain('The switch lives in\n**Settings → About**');
  });
});
