import {
  SINGLE_USER_ID,
  callerUserId,
  deriveUserRef,
} from './external-user-ref';

// The three properties the reference is FOR (#156). Each is what a plugin —
// or a pair of plugins — must not be able to do.

const SALT_A = 'salt-of-plugin-a';
const SALT_B = 'salt-of-plugin-b';

describe('opaque user references', () => {
  it('is stable for the same person and plugin', () => {
    // A plugin stores data under it, so a value that drifted would orphan
    // everything the user had.
    expect(deriveUserRef(SALT_A, 'user-1')).toBe(
      deriveUserRef(SALT_A, 'user-1'),
    );
  });

  it('separates people within one plugin', () => {
    expect(deriveUserRef(SALT_A, 'user-1')).not.toBe(
      deriveUserRef(SALT_A, 'user-2'),
    );
  });

  it('gives two plugins different references for the same person', () => {
    // Otherwise installing two plugins would let their authors compare notes
    // and rebuild an instance's roster between them.
    expect(deriveUserRef(SALT_A, 'user-1')).not.toBe(
      deriveUserRef(SALT_B, 'user-1'),
    );
  });

  it('gives a single-user instance its one person', () => {
    // Without this a per-person plugin was dead on the default deployment:
    // no multiuser overlay means no user ids, and every screen fell back to
    // "signed out, nothing to show".
    expect(callerUserId({})).toBe(SINGLE_USER_ID);
    expect(callerUserId({ userId: 'u1' })).toBe('u1');
  });

  it('gives background work nobody', () => {
    // A rollup or an export runs inside a request context and is still not a
    // person; handing it a reference would let a plugin attribute a scheduled
    // action to whoever last triggered something.
    expect(
      callerUserId({ systemBypassReason: 'stats-aggregation' }),
    ).toBeNull();
    expect(callerUserId(undefined)).toBeNull();
  });

  it('does not carry the user id', () => {
    const ref = deriveUserRef(SALT_A, 'user-1');
    expect(ref).not.toContain('user-1');
    // Long enough that guessing is pointless, short enough to read in a log.
    expect(ref).toHaveLength(22);
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
