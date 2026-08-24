// Shared contract for the "API" settings tab (#282) — what an owner needs to
// script against their own instance: where the API lives, where its interactive
// docs are, and how long the token they were handed stays valid.

// Where the reported base URL came from. Shown as a plain fact, not a warning:
// behind a reverse proxy the origin the browser used and the origin the server
// considers public can differ, and a script gets the server's answer.
export type ApiBaseUrlSource =
  // PUBLIC_BASE_URL was set — the operator said where the instance is published.
  | 'override'
  // The address this browser reached the app on, as it reported it.
  | 'client'
  // Derived from this request's (forwarded) scheme and host — the fallback for
  // a caller that sent no origin of its own.
  | 'request';

// Paths are part of the wire contract, not prose: the docs page and the login
// endpoint a script posts to. Absolute, origin-relative, no trailing slash.
export const API_DOCS_PATH = '/api/docs';
export const API_LOGIN_PATH = '/api/auth/login';

// Upper bound for a client-sent origin, matching the phone bridge's own cap:
// long enough for any real origin, short enough that a junk query string is
// rejected by validation rather than parsed.
export const MAX_ORIGIN_LENGTH = 2048;

export interface ApiInfo {
  // Absolute origin, no trailing slash — what a script should prefix.
  baseUrl: string;
  baseUrlSource: ApiBaseUrlSource;
  // Lifetime of a freshly issued session token, in seconds (JWT_TTL).
  tokenTtlSeconds: number;
}
