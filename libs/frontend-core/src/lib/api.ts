// The single HTTP client every store/view uses instead of raw `fetch`. It is
// the frontend half of the multiuser overlay's "proxy": one place that injects
// Authorization + x-scope-id + x-locale headers and funnels 401s into a
// logout/redirect — while staying a plain passthrough when multi-user mode is
// off (no token stored → no auth header, exactly today's requests).

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
  method?: HttpMethod;
  // Objects are JSON-encoded with a Content-Type header; strings pass as-is.
  body?: unknown;
  headers?: Record<string, string>;
  // Skip auth header + 401 handling (tokenless surfaces: phone capture page,
  // login/registration/status calls themselves).
  public?: boolean;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Toast/message helper: surface the backend's (already localized) error text
// when it's an ApiError, else a caller-provided localized fallback. Replaces the
// `err instanceof ApiError ? err.message : t(key)` ternary duplicated per view.
export function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const TOKEN_STORAGE_KEY = 'auth.token';
// A paired phone's long-lived credential (#199) lives in its OWN slot, not in
// the session one. Sharing a slot was a real bug: a phone whose device was
// revoked kept presenting the dead token on every request, and the first 401
// threw the plain phone-bridge scan page — which needs no credential at all —
// out to /login. Two credentials, two lifetimes, two keys.
const DEVICE_TOKEN_STORAGE_KEY = 'auth.deviceToken';
const SCOPE_STORAGE_KEY = 'auth.activeScope';
// The client-held key that re-arms the user's encryption key after a server
// restart (#63). Sent as `x-session-key` on authenticated requests.
const SESSION_KEY_STORAGE_KEY = 'auth.sessionKey';

let localeProvider: (() => string) | null = null;
let unauthorizedHandler: (() => void) | null = null;

// Wired once in main.ts from the i18n instance — api.ts cannot import the
// app's i18n without a circular dependency.
export function setApiLocaleProvider(provider: () => string): void {
  localeProvider = provider;
}

// Wired once in main.ts: clear the session and route to /login.
export function setApiUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getStoredDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
}

export function setStoredDeviceToken(token: string | null): void {
  if (token) localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
}

export function getStoredSessionKey(): string | null {
  return localStorage.getItem(SESSION_KEY_STORAGE_KEY);
}

export function setStoredSessionKey(sessionKey: string | null): void {
  if (sessionKey) localStorage.setItem(SESSION_KEY_STORAGE_KEY, sessionKey);
  else localStorage.removeItem(SESSION_KEY_STORAGE_KEY);
}

export function getStoredScopeId(): string | null {
  return localStorage.getItem(SCOPE_STORAGE_KEY);
}

export function setStoredScopeId(scopeId: string | null): void {
  if (scopeId) localStorage.setItem(SCOPE_STORAGE_KEY, scopeId);
  else localStorage.removeItem(SCOPE_STORAGE_KEY);
}

// Drop-in replacement for `fetch('/api/...')`: returns the raw Response (so
// existing `res.ok` handling ports 1:1), but with headers injected and 401
// funneled into the unauthorized handler.
export async function apiFetch(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };

  if (localeProvider && !headers['x-locale']) {
    headers['x-locale'] = localeProvider();
  }
  if (!options.public) {
    // A logged-in session wins over a paired device: on a desktop that has both
    // (a phone paired from this very browser during setup) the person is who
    // they logged in as.
    const token = getStoredToken() ?? getStoredDeviceToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const sessionKey = getStoredSessionKey();
    if (sessionKey && !headers['x-session-key']) {
      headers['x-session-key'] = sessionKey;
    }
    const scopeId = getStoredScopeId();
    if (scopeId && !headers['x-scope-id']) {
      headers['x-scope-id'] = scopeId;
    }
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      body = options.body;
    } else if (options.body instanceof FormData) {
      // Multipart uploads (exchange archive import): pass through untouched so
      // the browser sets the boundary Content-Type itself.
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  });

  // A server-restart re-arm consumes the presented session key (#243); the
  // replacement rides back on the response and must be stored before the next
  // cold start, or personal secrets stay locked until the next login. The
  // typeof guard tolerates the many test doubles that stub fetch with a bare
  // `{ ok, json }` object — this seam must not make them all carry Headers.
  const rotatedSessionKey =
    !options.public && typeof response.headers?.get === 'function'
      ? response.headers.get('x-session-key')
      : null;
  if (rotatedSessionKey) setStoredSessionKey(rotatedSessionKey);

  if (response.status === 401 && !options.public) {
    unauthorizedHandler?.();
  }
  return response;
}

// JSON convenience: throws a typed ApiError on any non-ok response. The error
// message carries the backend's (already localized) `message` when present.
export async function apiJson<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => undefined);
    throw new ApiError(
      response.status,
      errorPayload,
      extractMessage(errorPayload, response),
    );
  }
  const payload: T = await response.json();
  return payload;
}

// Blob download: run a request and hand the response body to the browser as a
// file download, using the server's Content-Disposition filename when present.
// The one place the blob→object-URL→anchor dance lives, so every export/backup
// surface (exchange export, multiuser admin scope backup) shares it instead of
// re-implementing it per view. Throws a typed ApiError on non-ok, like apiJson.
export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
  fallbackFilename = 'download',
): Promise<void> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => undefined);
    throw new ApiError(
      response.status,
      errorPayload,
      extractMessage(errorPayload, response),
    );
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = dispositionFilename(disposition) ?? fallbackFilename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Filename from a Content-Disposition header: prefer the RFC 5987 `filename*`
// (UTF-8, survives non-Latin names) over the ASCII-sanitised quoted fallback.
function dispositionFilename(disposition: string): string | null {
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed percent-encoding — fall through to the quoted form.
    }
  }
  const quoted = /filename="([^"]+)"/.exec(disposition);
  return quoted?.[1] ?? null;
}

function extractMessage(payload: unknown, response: Response): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return `HTTP ${response.status}`;
}
