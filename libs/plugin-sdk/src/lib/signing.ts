import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  SIGNATURE_FRESHNESS_MS,
  TIMESTAMP_HEADER,
  isTimestampFresh,
  signingCanonicalString,
} from '@makekeeper/plugin-contract';

// Verification of core→plugin calls (#139).
//
// This is the piece every plugin author would otherwise reimplement — and the
// piece where a subtle mistake (comparing with `===`, ignoring the timestamp,
// forgetting nonces) silently removes the protection. So the SDK does it, and
// the request handlers below refuse to run a handler on an unverified call:
// the safe path is the only path, not the documented one.

export interface VerifyInput {
  method: string;
  // Path WITH query, without host — exactly what the core signed.
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  secret: string;
  nowMs?: number;
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing-headers' | 'stale' | 'replayed' | 'mismatch';
    };

const header = (
  headers: VerifyInput['headers'],
  name: string,
): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

// Seen (timestamp, nonce) pairs inside the freshness window. Bounded by that
// window, so it cannot grow without limit; entries older than the window can
// never be accepted again anyway.
class NonceCache {
  private readonly seen = new Map<string, number>();

  check(nonce: string, timestamp: string, nowMs: number): boolean {
    this.sweep(nowMs);
    const key = `${timestamp}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs);
    return true;
  }

  private sweep(nowMs: number): void {
    for (const [key, at] of this.seen) {
      if (nowMs - at > SIGNATURE_FRESHNESS_MS) this.seen.delete(key);
    }
  }
}

const nonces = new NonceCache();

export function verifySignedRequest(input: VerifyInput): VerifyResult {
  const signature = header(input.headers, SIGNATURE_HEADER);
  const timestamp = header(input.headers, TIMESTAMP_HEADER);
  const nonce = header(input.headers, NONCE_HEADER);
  if (!signature || !timestamp || !nonce) {
    return { ok: false, reason: 'missing-headers' };
  }
  const now = input.nowMs ?? Date.now();
  if (!isTimestampFresh(timestamp, now)) return { ok: false, reason: 'stale' };
  if (!nonces.check(nonce, timestamp, now)) {
    return { ok: false, reason: 'replayed' };
  }

  const expected = createHmac('sha256', input.secret)
    .update(
      signingCanonicalString({
        method: input.method,
        path: input.path,
        timestamp,
        nonce,
        body: input.rawBody,
      }),
    )
    .digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Constant-time: a length check first, because timingSafeEqual throws on
  // mismatched lengths.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}
