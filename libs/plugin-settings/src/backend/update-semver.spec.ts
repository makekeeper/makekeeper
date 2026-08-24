import {
  parseSemver,
  compareSemver,
  isNewerVersion,
  highestSemver,
} from './update-semver';

describe('update-semver', () => {
  it('parses v-prefixed, plain and pre-release cores', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('v2.0.0-rc.1')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    });
  });

  it('returns null for non-semver strings', () => {
    expect(parseSemver('dev')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('v1.2')).toBeNull();
  });

  it('orders versions by major, minor, patch', () => {
    expect(compareSemver(parseSemver('1.0.0')!, parseSemver('1.0.1')!)).toBe(
      -1,
    );
    expect(compareSemver(parseSemver('1.2.0')!, parseSemver('1.1.9')!)).toBe(1);
    expect(compareSemver(parseSemver('2.0.0')!, parseSemver('2.0.0')!)).toBe(0);
  });

  it('detects a strictly newer version', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('v0.1.0', '0.2.0')).toBe(false);
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
});
