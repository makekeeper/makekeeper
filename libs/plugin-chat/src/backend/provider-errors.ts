import type { ProviderFailureKind } from '../providers-shared';

// Turning a vendor's error reply into what the user has to fix (#374).
//
// A failed test used to say "HTTP 401: {"type":"error","error":{...}}" and a
// failed turn said "Server communication error". Both are true and neither
// tells anyone whether to re-copy the key, pick another model or fix the URL.
// Each vendor words its errors differently, so the classification reads the
// structured fields first (Anthropic `error.type`, OpenAI `error.code`, Google
// `error.status`) and falls back to the HTTP status.

export interface ParsedProviderError {
  message: string;
  // Anthropic `error.type`, OpenAI `error.type`/`error.code`, Google
  // `error.status`, lower-cased and joined: only ever matched, never shown.
  markers: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

// Pull the human-readable message (and the machine-readable markers) out of
// an error body. Every vendor nests it under `error`, as a string (Ollama) or
// an object (the rest). A body that is not JSON (an HTML 404 page from a wrong
// base URL) is returned trimmed and capped, so it cannot flood the UI.
export function parseProviderError(body: string): ParsedProviderError {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      const err = parsed['error'];
      if (typeof err === 'string') return { message: err, markers: '' };
      if (isRecord(err)) {
        const markers = [err['type'], err['code'], err['status']]
          .map(str)
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return { message: str(err['message']) || body, markers };
      }
      const message = str(parsed['message']);
      if (message) return { message, markers: '' };
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return { message: body.trim().slice(0, 300), markers: '' };
}

export type ProviderCallKind = 'listing' | 'completion';

// Classify one failed HTTP reply.
//
// 404 is the ambiguous one: on the model-listing call it can only mean the
// endpoint is wrong, while on a completion it is usually the model ("model
// 'x' not found", `not_found_error`, `model_not_found`). A completion 404
// that does not mention a model is still read as a wrong endpoint, which is
// what an HTML page from the wrong host looks like.
export function classifyProviderFailure(
  status: number,
  parsed: ParsedProviderError,
  call: ProviderCallKind,
): ProviderFailureKind {
  const text = `${parsed.markers} ${parsed.message}`.toLowerCase();

  // Google answers a bad key with 400 INVALID_ARGUMENT, so the key check has
  // to come before the status switch.
  if (
    status === 401 ||
    text.includes('authentication_error') ||
    text.includes('invalid_api_key') ||
    text.includes('api key not valid') ||
    text.includes('api_key_invalid') ||
    text.includes('unauthenticated')
  ) {
    return 'auth';
  }
  if (
    status === 402 ||
    text.includes('billing_error') ||
    text.includes('insufficient_quota') ||
    text.includes('credit balance') ||
    text.includes('insufficient credits')
  ) {
    return 'billing';
  }
  if (status === 429 || text.includes('rate_limit')) return 'rateLimit';
  if (status === 529 || status === 503 || text.includes('overloaded')) {
    return 'overloaded';
  }
  if (status === 403 || text.includes('permission_denied')) {
    return 'permission';
  }
  if (status === 404) {
    if (call === 'listing') return 'endpoint';
    return text.includes('model') ? 'model' : 'endpoint';
  }
  if (status === 405) return 'endpoint';
  // Some gateways answer an unknown model with 400 rather than 404.
  if (
    status === 400 &&
    (text.includes('model_not_found') ||
      /\bmodel\b.*\b(not found|does not exist|not exist|invalid|unknown)\b/.test(
        text,
      ) ||
      /\b(unknown|invalid)\b.*\bmodel\b/.test(text))
  ) {
    return 'model';
  }
  if (status >= 400 && status < 500) return 'badRequest';
  return 'unknown';
}

// Classify a request that never produced a reply. Node's fetch wraps the
// socket error (ECONNREFUSED, ENOTFOUND, a TLS failure) in a TypeError whose
// `cause` carries the code; an abort is our own timeout.
export function classifyNetworkFailure(err: unknown): ProviderFailureKind {
  if (err instanceof Error && err.name === 'AbortError') return 'timeout';
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  return 'unreachable';
}

// The text to show next to a network failure: the socket code when there is
// one ("ECONNREFUSED"), which is the part an operator can search for.
export function networkFailureDetail(err: unknown): string {
  if (err instanceof Error) {
    const cause: unknown = 'cause' in err ? err.cause : undefined;
    if (isRecord(cause)) {
      const code = str(cause['code']);
      const message = str(cause['message']);
      if (code || message) return [code, message].filter(Boolean).join(': ');
    }
    return err.message;
  }
  return String(err);
}
