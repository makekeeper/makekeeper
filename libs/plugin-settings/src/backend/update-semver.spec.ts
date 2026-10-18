import {
  parseSemver,
  compareSemver,
  isNewerVersion,
  isPrerelease,
  highestSemver,
} from './update-semver';

function core(value: string) {
  const parsed = parseSemver(value);
  if (!parsed) throw new Error(`unparseable: ${value}`);
  return parsed;
}

describe('update-semver', () => {
  it('parses v-prefixed and plain final releases', () => {
    expect(parseSemver('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it('keeps the prerelease identifiers instead of dropping them', () => {
    expect(parseSemver('v2.0.0-rc.1')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ['rc', '1'],
    });
    expect(isPrerelease(core('v2.0.0-rc.1'))).toBe(true);
    expect(isPrerelease(core('v2.0.0'))).toBe(false);
  });

  it('ignores build metadata, including the bare "+" of an unpinned build', () => {
    expect(parseSemver('0.4.0+')).toEqual(core('0.4.0'));
    expect(parseSemver('0.4.0+3.gabcdef')).toEqual(core('0.4.0'));
    expect(parseSemver('1.0.0-rc.1+build.5')?.prerelease).toEqual(['rc', '1']);
  });

  it('returns null for non-semver strings', () => {
    expect(parseSemver('dev')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('v1.2')).toBeNull();
    expect(parseSemver('v1.2.3-')).toBeNull();
  });

  it('rejects prerelease identifiers semver forbids', () => {
    expect(parseSemver('1.0.0-rc..1')).toBeNull();
    expect(parseSemver('1.0.0-01')).toBeNull();
    expect(parseSemver('1.0.0-rc.')).toBeNull();
    // ...while allowing hyphens and leading-zero alphanumerics.
    expect(parseSemver('1.0.0-rc.1-x')?.prerelease).toEqual(['rc', '1-x']);
    expect(parseSemver('1.0.0-0a')?.prerelease).toEqual(['0a']);
  });

  it('orders versions by major, minor, patch', () => {
    expect(compareSemver(core('1.0.0'), core('1.0.1'))).toBe(-1);
    expect(compareSemver(core('1.2.0'), core('1.1.9'))).toBe(1);
    expect(compareSemver(core('2.0.0'), core('2.0.0'))).toBe(0);
  });

  it('orders a prerelease below its final, never equal to it', () => {
    expect(compareSemver(core('v1.0.0-rc.1'), core('v1.0.0'))).toBe(-1);
    expect(compareSemver(core('v1.0.0'), core('v1.0.0-rc.1'))).toBe(1);
    // ...but above the previous final.
    expect(compareSemver(core('v1.0.0-rc.1'), core('v0.9.9'))).toBe(1);
  });

  it('orders prereleases by semver §11 identifier precedence', () => {
    expect(compareSemver(core('1.0.0-rc.1'), core('1.0.0-rc.2'))).toBe(-1);
    expect(compareSemver(core('1.0.0-rc.9'), core('1.0.0-rc.10'))).toBe(-1);
    expect(compareSemver(core('1.0.0-alpha'), core('1.0.0-beta'))).toBe(-1);
    expect(compareSemver(core('1.0.0-1'), core('1.0.0-alpha'))).toBe(-1);
    expect(compareSemver(core('1.0.0-alpha'), core('1.0.0-alpha.1'))).toBe(-1);
    expect(compareSemver(core('1.0.0-rc.1'), core('1.0.0-rc.1'))).toBe(0);
  });

  it('detects a strictly newer version', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('v0.1.0', '0.2.0')).toBe(false);
  });

  it('offers the final to an install running its candidate, and not vice versa', () => {
    expect(isNewerVersion('v1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewerVersion('v1.0.0-rc.1', '1.0.0')).toBe(false);
    expect(isNewerVersion('v1.0.0-rc.2', '1.0.0-rc.1')).toBe(true);
  });

  it('never reports an update against a non-semver current (e.g. dev)', () => {
    expect(isNewerVersion('v1.0.0', 'dev')).toBe(false);
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
  });

  it('picks the highest valid tag, ignoring junk', () => {
    expect(highestSemver(['v0.1.0', 'v0.2.0', 'v0.1.9', 'nightly'])).toBe(
      'v0.2.0',
    );
    expect(highestSemver(['latest', 'main'])).toBeNull();
    expect(highestSemver([])).toBeNull();
  });

  it('never picks a prerelease, whatever order the source lists tags in', () => {
    expect(highestSemver(['v1.0.0-rc.1', 'v0.9.0'])).toBe('v0.9.0');
    expect(highestSemver(['v0.9.0', 'v1.0.0-rc.1'])).toBe('v0.9.0');
    expect(highestSemver(['v1.0.0-rc.1', 'v1.0.0', 'v1.0.0-rc.2'])).toBe(
      'v1.0.0',
    );
    expect(highestSemver(['v1.0.0-rc.1'])).toBeNull();
  });
});
