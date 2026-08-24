import {
  decryptSecret,
  encryptSecret,
  generateDek,
  generateSessionSecret,
  isEncrypted,
  needsKdfUpgrade,
  safeEqual,
} from './crypto-box';

describe('crypto-box', () => {
  it('round-trips a secret with the right passphrase', () => {
    const cipher = encryptSecret(
      'sk-secret-value',
      'passphrase-passphrase-1234567890',
    );
    expect(cipher).not.toContain('sk-secret-value');
    expect(decryptSecret(cipher, 'passphrase-passphrase-1234567890')).toBe(
      'sk-secret-value',
    );
  });

  it('fails authentication with the wrong passphrase (returns null, never throws)', () => {
    const cipher = encryptSecret('top-secret', 'correct-passphrase-abcdefghij');
    expect(decryptSecret(cipher, 'wrong-passphrase-abcdefghij')).toBeNull();
  });

  it('produces a distinct ciphertext each time (random salt + IV)', () => {
    const a = encryptSecret('same-input', 'pp-pp-pp-pp-pp-pp-pp-pp-pp-01');
    const b = encryptSecret('same-input', 'pp-pp-pp-pp-pp-pp-pp-pp-pp-01');
    expect(a).not.toEqual(b);
    expect(decryptSecret(a, 'pp-pp-pp-pp-pp-pp-pp-pp-pp-01')).toBe(
      'same-input',
    );
    expect(decryptSecret(b, 'pp-pp-pp-pp-pp-pp-pp-pp-pp-01')).toBe(
      'same-input',
    );
  });

  it('round-trips under the hardened KDF and tags it v2', () => {
    const cipher = encryptSecret(
      'dek-value',
      'weak-login-password',
      'hardened',
    );
    expect(cipher.startsWith('v2:')).toBe(true);
    // Decrypt auto-detects the profile from the version tag — no caller hint.
    expect(decryptSecret(cipher, 'weak-login-password')).toBe('dek-value');
  });

  it('defaults to v1 and stays byte-format-compatible', () => {
    const cipher = encryptSecret('x', 'passphrase-passphrase-1234567890');
    expect(cipher.startsWith('v1:')).toBe(true);
  });

  it('a hardened wrap does not open at the default cost and vice-versa', () => {
    // Same passphrase, different profile ⇒ different derived key ⇒ auth fails
    // if the version tag is swapped by hand.
    const hardened = encryptSecret('secret', 'pw-pw-pw-pw', 'hardened');
    const forgedV1 = hardened.replace(/^v2:/, 'v1:');
    expect(decryptSecret(forgedV1, 'pw-pw-pw-pw')).toBeNull();
  });

  it('isEncrypted recognises both v1 and v2 ciphertexts', () => {
    expect(isEncrypted(encryptSecret('a', 'pp-pp-pp-pp'))).toBe(true);
    expect(isEncrypted(encryptSecret('a', 'pp-pp-pp-pp', 'hardened'))).toBe(
      true,
    );
    expect(isEncrypted('plaintext')).toBe(false);
  });

  it('needsKdfUpgrade flags a v1 wrap when hardened is desired, not a v2 one', () => {
    const legacy = encryptSecret('dek', 'pw', 'default');
    const strong = encryptSecret('dek', 'pw', 'hardened');
    expect(needsKdfUpgrade(legacy, 'hardened')).toBe(true);
    expect(needsKdfUpgrade(strong, 'hardened')).toBe(false);
  });

  it('detects tampering with the ciphertext body', () => {
    const cipher = encryptSecret('secret', 'passphrase-passphrase-1234567890');
    const parts = cipher.split(':');
    // Flip the last hex char of the ciphertext segment.
    const last = parts[4];
    const flipped = last.slice(0, -1) + (last.endsWith('0') ? '1' : '0');
    parts[4] = flipped;
    expect(
      decryptSecret(parts.join(':'), 'passphrase-passphrase-1234567890'),
    ).toBeNull();
  });

  it('rejects malformed payloads', () => {
    expect(decryptSecret('not-a-ciphertext', 'pp')).toBeNull();
    expect(decryptSecret('v1:only:three', 'pp')).toBeNull();
    expect(decryptSecret('', 'pp')).toBeNull();
  });

  it('marks its own ciphertexts as encrypted and plaintext as not', () => {
    expect(
      isEncrypted(encryptSecret('x', 'passphrase-1234567890-abcdef')),
    ).toBe(true);
    expect(isEncrypted('sk-plaintext-key')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('wraps a DEK under a password and unwraps it back (the keyring pattern)', () => {
    const dek = generateDek();
    const wrapped = encryptSecret(dek, 'user-login-password');
    expect(decryptSecret(wrapped, 'user-login-password')).toBe(dek);
    // A secret encrypted under the DEK is only recoverable with the DEK.
    const personalSecret = encryptSecret('personal-api-key', dek);
    expect(decryptSecret(personalSecret, dek)).toBe('personal-api-key');
    expect(decryptSecret(personalSecret, generateDek())).toBeNull();
  });

  it('generates high-entropy, distinct DEKs and session secrets', () => {
    expect(generateDek()).not.toEqual(generateDek());
    expect(generateSessionSecret()).not.toEqual(generateSessionSecret());
    // 32 bytes base64url ≈ 43 chars.
    expect(generateDek().length).toBeGreaterThanOrEqual(43);
  });

  it('safeEqual compares by content and rejects length mismatches', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
