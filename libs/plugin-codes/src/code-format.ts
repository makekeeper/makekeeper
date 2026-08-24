// Short-code grammar for universal labels (#74). Framework-agnostic and imported
// by BOTH sides: the backend generates/validates codes, the frontend detects a
// scanned label code and derives print prefixes. No user-facing strings here.
import type { ObjectRef } from '@makekeeper/plugin-contract';

// Crockford base32 — no I, L, O, U (avoids human/OCR ambiguity). Code128-safe.
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// The random part is 5 Crockford symbols (25 bits ≈ 33M combinations per prefix).
export const CODE_RANDOM_LENGTH = 5;

// A full label code: 2–4 uppercase-letter prefix, a hyphen, then the random part.
// The prefix keeps codes human-scannable ("this is a component"); the hyphen is
// Code128-safe. Kept in sync with `codePrefixForRef` below.
export const LABEL_CODE_RE = /^[A-Z]{2,4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

// A fragment marks a sub-entity (a storage grid-cell) and gets its own prefix so
// a cell label reads differently from its whole-storage label. Entity types with
// too few letters to derive from fall back to a generic prefix.
const FRAGMENT_PREFIX = 'CEL';
const GENERIC_PREFIX = 'OBJ';

// Derive a short, human-scannable prefix from the ORef itself — codes carries NO
// hardcoded knowledge of any specific plugin's entities (§5.10), so any labelable
// object gets a sensible prefix with zero codes changes. The result is always
// 2–4 uppercase letters, matching `LABEL_CODE_RE` and Code128's charset.
export function codePrefixForRef(ref: ObjectRef): string {
  if (ref.fragment) return FRAGMENT_PREFIX;
  const letters = ref.entityType.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return letters.length >= 2 ? letters.slice(0, 3) : GENERIC_PREFIX;
}

// Normalize a scanned/typed code to canonical form (uppercase, trimmed).
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isLabelCode(input: string): boolean {
  return LABEL_CODE_RE.test(normalizeCode(input));
}

// Pull the `<code>` out of a `/c/<code>` deep-link (full URL or bare path), which
// is what a QR encodes and what a phone's native camera hands back. Returns the
// normalized code, or null when the string is not a label deep-link.
export function extractDeepLinkCode(input: string): string | null {
  const match = input.trim().match(/\/c\/([^/?#\s]+)\/?$/);
  if (!match) return null;
  const code = normalizeCode(decodeURIComponent(match[1]));
  return isLabelCode(code) ? code : null;
}
