// Minimal semver handling for the update checker. Release tags are plain
// `vMAJOR.MINOR.PATCH` (optionally with a `-prerelease` suffix); we only need to
// parse the numeric core and order two versions. Not a full semver implementation.

export interface SemverCore {
  major: number;
  minor: number;
  patch: number;
}

// Parse "v1.2.3", "1.2.3", "1.2.3-rc.1" → {1,2,3}. Returns null for anything
// without a numeric MAJOR.MINOR.PATCH core (e.g. "dev", "latest").
export function parseSemver(value: string): SemverCore | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

// -1 if a < b, 0 if equal core, 1 if a > b.
export function compareSemver(a: SemverCore, b: SemverCore): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

// True when `candidate` is a valid semver strictly newer than `current`. False
// when either side isn't parseable (e.g. a "dev" build never reports an update).
export function isNewerVersion(candidate: string, current: string): boolean {
  const c = parseSemver(candidate);
  const cur = parseSemver(current);
  if (!c || !cur) return false;
  return compareSemver(c, cur) === 1;
}

// Pick the highest valid semver from a list of tag names; null if none parse.
export function highestSemver(tags: readonly string[]): string | null {
  let best: string | null = null;
  let bestCore: SemverCore | null = null;
  for (const tag of tags) {
    const core = parseSemver(tag);
    if (!core) continue;
    if (!bestCore || compareSemver(core, bestCore) === 1) {
      best = tag;
      bestCore = core;
    }
  }
  return best;
}
