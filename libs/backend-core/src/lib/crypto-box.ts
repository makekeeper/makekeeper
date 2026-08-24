import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

// Symmetric authenticated encryption for secrets stored at rest. AES-256-GCM
// with a per-value random salt+IV; the key is derived from a passphrase via
// scrypt, so the same primitive serves every layer just by varying the
// passphrase:
//   - instance secrets (provider keys, tracking password) → the app secret;
//   - a user's data-encryption key (DEK) → wrapped under a password-derived
//     KEK and under a client-held session secret;
//   - a user's personal secrets → encrypted under their DEK.
//
// Payload is self-describing so salt/IV/tag AND the KDF cost travel with the
// ciphertext:
//   v1:<saltHex>:<ivHex>:<tagHex>:<cipherHex>   scrypt at Node defaults
//   v2:<saltHex>:<ivHex>:<tagHex>:<cipherHex>   scrypt hardened (see below)
// The version prefix is the migration marker — a stored value without a known
// one is legacy plaintext (see `isEncrypted`). v1 stays byte-compatible with
// the original plugin-logistics secret-box so pre-existing tracking passwords
// still decrypt.
//
// Two KDF profiles, because the passphrase's entropy differs by caller:
//   - `default` (v1) — for HIGH-entropy passphrases (the ≥32-char app secret, a
//     random DEK, a random session secret). Node's scrypt defaults are ample
//     and the cheap cost keeps these hot-path derivations fast.
//   - `hardened` (v2) — for a LOW-entropy passphrase: the user's LOGIN PASSWORD
//     wrapping their DEK (#63/#242). Here the work factor is the only barrier
//     against an offline dictionary attack on a stolen DB, so it is raised to
//     the current OWASP scrypt floor (N=2^17). `maxmem` must be lifted to match
//     (≈128·N·r bytes), else scrypt throws.

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

export type KdfProfile = 'default' | 'hardened';

const HARDENED_SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const VERSION_FOR: Record<KdfProfile, string> = {
  default: 'v1',
  hardened: 'v2',
};
// Partial by design — an unknown version prefix (legacy plaintext, corruption)
// maps to `undefined`, which the callers treat as "not one of ours".
const PROFILE_FOR: Record<string, KdfProfile | undefined> = {
  v1: 'default',
  v2: 'hardened',
};

// Own-property lookup: a plain index would also hit `Object.prototype` keys, so
// a legacy plaintext that happens to start with `constructor:`/`toString:`
// would masquerade as a known ciphertext version.
function profileOf(version: string | undefined): KdfProfile | undefined {
  return version !== undefined &&
    Object.prototype.hasOwnProperty.call(PROFILE_FOR, version)
    ? PROFILE_FOR[version]
    : undefined;
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  profile: KdfProfile,
): Buffer {
  return profile === 'hardened'
    ? scryptSync(passphrase, salt, KEY_LEN, HARDENED_SCRYPT)
    : scryptSync(passphrase, salt, KEY_LEN);
}

export function encryptSecret(
  plain: string,
  passphrase: string,
  profile: KdfProfile = 'default',
): string {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt, profile);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_FOR[profile],
    salt.toString('hex'),
    iv.toString('hex'),
    tag.toString('hex'),
    enc.toString('hex'),
  ].join(':');
}

// Returns the plaintext, or null for any malformed payload or authentication
// failure (wrong passphrase, tampering). Callers treat null as "cannot use this
// secret" — never as an empty secret.
export function decryptSecret(
  payload: string,
  passphrase: string,
): string | null {
  try {
    const [version, saltHex, ivHex, tagHex, dataHex] = payload.split(':');
    const profile = profileOf(version);
    if (!profile || !saltHex || !ivHex || !tagHex || !dataHex) {
      return null;
    }
    const key = deriveKey(passphrase, Buffer.from(saltHex, 'hex'), profile);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

// Whether a stored value is one of our ciphertexts (vs. legacy plaintext). Used
// by the one-time startup migration to skip already-encrypted rows.
export function isEncrypted(value: string): boolean {
  return profileOf(value.split(':', 1)[0]) !== undefined;
}

// Whether a ciphertext was produced with a weaker KDF profile than requested —
// i.e. it should be re-wrapped opportunistically after a successful decrypt.
// The password→DEK wrap uses this to upgrade a legacy v1 wrap to v2 on the
// owner's next login, without a bulk migration (#242).
export function needsKdfUpgrade(payload: string, desired: KdfProfile): boolean {
  return profileOf(payload.split(':', 1)[0]) !== desired;
}

// A fresh 256-bit data-encryption key as a base64url string — the plaintext that
// gets wrapped under the password KEK and the session secret, and the passphrase
// under which a user's personal secrets are encrypted.
export function generateDek(): string {
  return randomBytes(KEY_LEN).toString('base64url');
}

// A fresh high-entropy session secret (client-held) used to re-arm a user's DEK
// after a server restart without re-entering the password.
export function generateSessionSecret(): string {
  return randomBytes(KEY_LEN).toString('base64url');
}

// Constant-time compare for opaque secret strings (session-secret lookup).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
