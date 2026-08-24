import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Wiring guards for #188: the event that was declared, documented, handled by
// three example plugins — and emitted by nobody.
//
// It is not a bug a unit test would have caught, because every piece worked:
// the constant existed, the outbox worked, the handlers were correct. What was
// missing was the wiring between them, which is exactly what these check.
//
// They live in the BACKEND, not in either plugin, for two reasons: the wiring
// spans plugins that must not name each other, and this is the only project
// whose test cache depends on all of them — inside plugin-external the same
// guard would pass from cache while a change in plugin-multiuser broke it.

const ROOT = join(__dirname, '..', '..', '..', '..');
const LIBS = join(ROOT, 'libs');
const APPS = join(ROOT, 'apps');

// A file counts as a publisher only if it hands something to the bus or the
// outbox. Mentioning a name in an import or a comment is exactly the
// non-wiring #188 was about.
const PUBLISHES = /\.(emit|publish\w*)[<(]/;

const stripImportsAndComments = (text: string): string =>
  text
    .replace(/import[\s\S]*?from\s+'[^']*';/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
};

const sources = (): Array<{ path: string; text: string }> =>
  [...walk(LIBS), ...walk(APPS)].map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
  }));

describe('core.scope-deleted', () => {
  it('is emitted somewhere, not only declared', () => {
    // The shape of the bug: a name in the contract that nothing publishes.
    // WHICH file emits it is not this test's business — naming the overlay's
    // path would break falsely the day the emitter moves.
    const emitters = sources().filter(({ text }) =>
      /\.emit(<[^>]*>)?\(\s*CORE_SCOPE_DELETED_EVENT/.test(text),
    );
    expect(emitters.length).toBeGreaterThan(0);
  });

  it('reaches external subscribers through the host', () => {
    const relay = sources().find(({ path }) =>
      path.endsWith('plugin-external/src/backend/external.module.ts'),
    );
    expect(relay).toBeDefined();
    // Listening on the neutral bus, not importing the overlay: multiuser may
    // not even be installed, and plugins do not import each other.
    expect(relay?.text).toContain('CORE_SCOPE_DELETED_EVENT');
    expect(relay?.text).toContain('EXTERNAL_EVENT_SCOPE_DELETED');
    expect(relay?.text).not.toContain('plugin-multiuser');
  });

  it('every declared external event type has a publisher', () => {
    // The same trap, generalised: `events: [...]` in a manifest is a promise,
    // and a promise nothing fulfils is worse than a missing feature. Covers
    // BOTH vocabular files: the lifecycle names (external-api.ts) and the
    // domain catalogue (external-events.ts, #192) — a catalogue name without
    // an emitter is exactly the #188 bug born again.
    const contract =
      readFileSync(
        join(LIBS, 'plugin-contract/src/lib/external/external-api.ts'),
        'utf8',
      ) +
      readFileSync(
        join(LIBS, 'plugin-contract/src/lib/external/external-events.ts'),
        'utf8',
      );
    // The trailing quote keeps non-name constants (EXTERNAL_EVENT_SCHEMA_
    // VERSION is a number) out of the declared set.
    const declared = [
      ...contract.matchAll(/export const (EXTERNAL_EVENT_\w+|\w+_EVENT) = '/g),
    ].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(3);

    // The name has to survive stripping imports and comments AND sit in a file
    // that publishes — otherwise an unused import satisfies the guard.
    const publishers = sources()
      .filter(
        ({ path, text }) =>
          !path.includes('external-api.ts') && PUBLISHES.test(text),
      )
      .map(({ text }) => stripImportsAndComments(text))
      .join('\n');
    for (const name of declared) {
      expect(publishers).toContain(name);
    }
  });
});
