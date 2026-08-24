import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { getErrorMessage } from '@makekeeper/backend-core';
import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  signingCanonicalString,
  TIMESTAMP_HEADER,
} from '@makekeeper/plugin-contract';

// Outbound HTTP to an external plugin container (#133). EVERY core→plugin
// call — renders, webhooks, hooks, purge — goes through here, so the HMAC
// signature is impossible to forget on a new call site. The canonical string
// is the shared one from plugin-contract; the SDK's receiver verifies the
// exact same bytes.

export interface SignedCallResult {
  ok: boolean;
  status: number;
  body: unknown;
  errorCode?: 'timeout' | 'network' | 'http' | 'body';
}

@Injectable()
export class ExternalSignerService {
  private readonly logger = new Logger(ExternalSignerService.name);

  buildHeaders(
    secret: string,
    method: string,
    path: string,
    body: string,
  ): Record<string, string> {
    const timestamp = String(Date.now());
    const nonce = randomBytes(12).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(signingCanonicalString({ method, path, timestamp, nonce, body }))
      .digest('hex');
    return {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
      [NONCE_HEADER]: nonce,
    };
  }

  // Signed JSON POST with a hard timeout. Never throws — the budget/breaker
  // logic upstream turns the discriminated failure into surface degradation.
  async post(
    baseUrl: string,
    secret: string,
    path: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<SignedCallResult> {
    const body = JSON.stringify(payload ?? {});
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(secret, 'POST', path, body),
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, status: res.status, body: null, errorCode: 'http' };
      }
      try {
        return { ok: true, status: res.status, body: await res.json() };
      } catch {
        return { ok: false, status: res.status, body: null, errorCode: 'body' };
      }
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (!aborted) {
        this.logger.debug(
          `external call failed: ${url}: ${getErrorMessage(err)}`,
        );
      }
      return {
        ok: false,
        status: 0,
        body: null,
        errorCode: aborted ? 'timeout' : 'network',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
