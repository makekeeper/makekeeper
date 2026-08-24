// External plugin contract — request signing (#132).
//
// Every core→plugin HTTP call carries an HMAC-SHA256 signature over a
// canonical string, keyed with the plugin's registration secret, so a plugin
// can tell the core apart from any other container on the docker network.
// This file defines the header names and the canonical string — pure string
// operations only, so the contract lib stays framework-agnostic. The actual
// HMAC computation lives with the caller (node:crypto in backend-core and in
// the SDK); both sides build the exact same canonical string from here.
//
// Replay protection: the timestamp must be within the freshness window of the
// receiver's clock, and the (timestamp, nonce) pair must not repeat inside it.

export const SIGNATURE_HEADER = 'x-mk-signature';
export const TIMESTAMP_HEADER = 'x-mk-timestamp';
export const NONCE_HEADER = 'x-mk-nonce';

// Receivers reject calls whose timestamp is farther than this from now.
export const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

// The signed payload: method, path (with query, no host), unix-ms timestamp,
// nonce and the raw request body. Joined with newlines — none of the parts may
// contain one (method/path/timestamp/nonce never do; the body is hashed by
// the HMAC itself, newlines inside it are fine as the trailing segment).
export function signingCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.body,
  ].join('\n');
}

export const isTimestampFresh = (
  timestamp: string,
  nowMs: number,
  windowMs: number = SIGNATURE_FRESHNESS_MS,
): boolean => {
  const ts = Number(timestamp);
  return Number.isFinite(ts) && Math.abs(nowMs - ts) <= windowMs;
};
