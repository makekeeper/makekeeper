import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKnownPluginIcon, resolvePluginIcon } from './plugin-icons';

// Walk up from this file until the workspace root (the dir holding nx.json), so
// the guard finds every plugin manifest regardless of where vitest is invoked.
function findWorkspaceRoot(): string {
  let dir = import.meta.dirname;
  while (dir !== dirname(dir)) {
    try {
      statSync(join(dir, 'nx.json'));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('workspace root (nx.json) not found');
}

// Every `icon: '<Name>'` string literal declared across all plugin manifests —
// the authoritative set of names the shell resolves through resolvePluginIcon.
function collectManifestIconNames(): { name: string; source: string }[] {
  const root = findWorkspaceRoot();
  const pluginsDir = join(root, 'libs');
  const found: { name: string; source: string }[] = [];
  const iconLiteral = /icon:\s*'([^']+)'/g;

  for (const entry of readdirSync(pluginsDir)) {
    if (!entry.startsWith('plugin-')) continue;
    const manifest = join(pluginsDir, entry, 'src', 'manifest.ts');
    let contents: string;
    try {
      contents = readFileSync(manifest, 'utf8');
    } catch {
      continue; // not every plugin ships a manifest.ts at that path
    }
    for (const match of contents.matchAll(iconLiteral)) {
      found.push({ name: match[1], source: `${entry}/src/manifest.ts` });
    }
  }
  return found;
}

describe('resolvePluginIcon', () => {
  it('falls back to a component for an unknown or empty name', () => {
    expect(resolvePluginIcon(undefined)).toBeTruthy();
    expect(resolvePluginIcon('NotARealIcon')).toBeTruthy();
    expect(resolvePluginIcon('')).toBeTruthy();
  });
});

describe('plugin icon registry drift guard', () => {
  const declared = collectManifestIconNames();

  it('finds icon declarations to check', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it('maps every icon name any plugin manifest declares', () => {
    const unmapped = [
      ...new Set(
        declared
          .filter(({ name }) => !isKnownPluginIcon(name))
          .map(({ name, source }) => `${name} (${source})`),
      ),
    ];
    // A manifest icon absent from PLUGIN_ICONS silently renders the Box cube —
    // add it to libs/frontend-core/src/lib/plugin-icons.ts.
    expect(unmapped).toEqual([]);
  });
});
