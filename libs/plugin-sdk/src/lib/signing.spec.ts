import { createHmac } from 'node:crypto';
import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signingCanonicalString,
} from '@makekeeper/plugin-contract';
import { verifySignedRequest } from './signing';

// These are the protections an author would otherwise have to remember. They
// are tested here because the SDK's promise is that they hold by default.

const SECRET = 'mkp_test-secret';

let nonceCounter = 0;
const signed = (over?: {
  secret?: string;
  body?: string;
  path?: string;
  timestamp?: string;
  nonce?: string;
}) => {
  const body = over?.body ?? JSON.stringify({ screen: 'home' });
  const path = over?.path ?? '/mk/render';
  const timestamp = over?.timestamp ?? String(Date.now());
  const nonce = over?.nonce ?? `n${++nonceCounter}`;
  const signature = createHmac('sha256', over?.secret ?? SECRET)
    .update(
      signingCanonicalString({ method: 'POST', path, timestamp, nonce, body }),
    )
    .digest('hex');
  return {
    method: 'POST',
    path,
    rawBody: body,
    secret: SECRET,
    headers: {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
      [NONCE_HEADER]: nonce,
    },
  };
};

describe('verifySignedRequest', () => {
  it('accepts a correctly signed request', () => {
    expect(verifySignedRequest(signed())).toEqual({ ok: true });
  });

  it('rejects a request signed with the wrong secret', () => {
    const res = verifySignedRequest(signed({ secret: 'other-secret' }));
    expect(res).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a tampered body (the signature covers it)', () => {
    const req = signed();
    const res = verifySignedRequest({
      ...req,
      rawBody: JSON.stringify({ screen: 'admin' }),
    });
    expect(res).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a tampered path — a signature cannot be moved to another route', () => {
    const req = signed({ path: '/mk/render' });
    expect(verifySignedRequest({ ...req, path: '/mk/purge' })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a stale timestamp', () => {
    const old = String(Date.now() - 10 * 60 * 1000);
    expect(verifySignedRequest(signed({ timestamp: old }))).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('rejects a replayed (timestamp, nonce) pair', () => {
    const req = signed({ nonce: 'fixed-nonce' });
    expect(verifySignedRequest(req)).toEqual({ ok: true });
    expect(verifySignedRequest(req)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('rejects a request with no signature headers at all', () => {
    const req = signed();
    expect(verifySignedRequest({ ...req, headers: {} })).toEqual({
      ok: false,
      reason: 'missing-headers',
    });
  });
});
