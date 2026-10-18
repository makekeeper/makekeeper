// Minimal semver handling for the update checker. Release tags are plain
// `vMAJOR.MINOR.PATCH`, a candidate carries a `-prerelease` suffix
// (`v1.0.0-rc.1`), and an unpinned build may carry `+` build metadata
// (`0.4.0+`, see AppConfigService). Enough of semver §9–§11 to parse those and
// order them; not a full implementation.

export interface SemverCore {
  major: number;
  minor: number;
  patch: number;
  // Dot-separated prerelease identifiers (`['rc', '1']`), or null for a final
  // release. Kept, not dropped: a prerelease must order BELOW its final (#304),
  // and the only way to do that is to know it is one.
  prerelease: readonly string[] | null;
}

// One prerelease identifier as semver §9 defines it: digits without a leading
// zero, or alphanumerics/hyphens with at least one non-digit. Empty identifiers
// (`rc..1`) and `01` are not identifiers, so a tag carrying them is not a
// version — `null`, like any other junk, rather than a guessed order.
const PRERELEASE_IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER_PATTERN = new RegExp(
  `^v?(\\d+)\\.(\\d+)\\.(\\d+)` +
    `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?` +
    `(?:\\+.*)?$`,
);

// Parse "v1.2.3", "1.2.3", "1.2.3-rc.1", "1.2.3+" → core (+ prerelease).
// Returns null for anything without a numeric MAJOR.MINOR.PATCH core (e.g.
// "dev", "latest"). Build metadata after `+` is ignored, as semver says.
export function parseSemver(value: string): SemverCore | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  };
}

export function isPrerelease(core: SemverCore): boolean {
  return core.prerelease !== null;
}

// semver §11: identifiers compare numerically when both are digits, otherwise
// as ASCII strings; a numeric identifier is lower than an alphanumeric one; a
// longer list wins when every shared identifier is equal.
function comparePrerelease(
  a: readonly string[],
  b: readonly string[],
): -1 | 0 | 1 {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      return Number(left) < Number(right) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

// -1 if a < b, 0 if equal, 1 if a > b. Core first; on an equal core a final
// release is newer than any prerelease of it, and two prereleases order by
// their identifiers.
export function compareSemver(a: SemverCore, b: SemverCore): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

// True when `candidate` is a valid semver strictly newer than `current`. False
// when either side isn't parseable (e.g. a "dev" build never reports an update).
// An install running a candidate (`1.0.0-rc.1`) is offered the final `1.0.0`.
export function isNewerVersion(candidate: string, current: string): boolean {
  const c = parseSemver(candidate);
  const cur = parseSemver(current);
  if (!c || !cur) return false;
  return compareSemver(c, cur) === 1;
}

// Pick the highest FINAL release from a list of tag names; null if none.
// Prereleases are skipped outright rather than merely ordered below: a pushed
// `v1.0.0-rc.1` is meant to be pullable by name and invisible to everyone else,
// and this is the function that decides what every install is offered (#304).
export function highestSemver(tags: readonly string[]): string | null {
  let best: string | null = null;
  let bestCore: SemverCore | null = null;
  for (const tag of tags) {
    const core = parseSemver(tag);
    if (!core || isPrerelease(core)) continue;
    if (!bestCore || compareSemver(core, bestCore) === 1) {
      best = tag;
      bestCore = core;
    }
  }
  return best;
}
