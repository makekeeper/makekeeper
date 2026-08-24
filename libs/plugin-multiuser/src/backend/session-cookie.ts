// The second way a session travels: a cookie the browser attaches by itself
// (#123).
//
// `/api/uploads/:id` used to be `@Public` because the two surfaces that fetch an
// attachment are the browser's own, not the SPA's: `<img :src>` and the
// `DownloadURL` drag-out payload (#109). Neither can carry the bearer token, so
// the boundary between users on that route rested on the id being unguessable
// rather than on authentication. A cookie fixes that without touching a single
// call site.
//
// Scoped as narrowly as the job allows:
//   Path=/api/uploads — it exists for attachment serving and is not even sent
//                       to any other route, so it cannot authenticate a write;
//   HttpOnly         — script never reads it; the SPA keeps using the token it
//                       already holds, and an XSS cannot lift the cookie;
//   SameSite=Lax     — another site embedding one of our URLs gets an
//                       unauthenticated request, as it should.
// `Secure` is decided per request (see AppConfigService.isRequestSecure): this
// product is routinely self-hosted on a plain-http LAN, where a `Secure` cookie
// would be dropped and every picture would 401.

export const SESSION_COOKIE_NAME = 'mk_session';

// Structural stand-in for the HTTP response, mirroring the guard's
// `IncomingRequestLike`: enough to emit a Set-Cookie, no Express type
// dependency dragged into the plugin.
export interface ResponseLike {
  setHeader(name: string, value: string): void;
}

// Must stay in step with the global prefix (`api`) + the uploads controller's
// route. Anything wider hands the cookie to routes that must never accept it.
const SESSION_COOKIE_PATH = '/api/uploads';

interface SessionCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
  // Set only when the operator published the mobile surface on its own host and
  // said so explicitly (#204). It widens the cookie to that host's parent
  // domain, which is a security decision — hence configuration, never a guess.
  domain?: string | null;
}

export function buildSessionCookie(
  token: string,
  { secure, maxAgeSeconds, domain }: SessionCookieOptions,
): string {
  return serialize(token, maxAgeSeconds, secure, domain ?? null);
}

// Same attributes with an empty value and Max-Age=0 — a cookie is only
// overwritten by a Set-Cookie whose name/path/domain match, so the attributes
// are not decoration here.
export function buildClearedSessionCookie(
  secure: boolean,
  domain: string | null = null,
): string {
  return serialize('', 0, secure, domain);
}

function serialize(
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
  domain: string | null,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Path=${SESSION_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ];
  if (domain) parts.push(`Domain=${domain}`);
  // Lax stays the default and the tight case. A picture requested by a page on
  // the separate mobile host is a CROSS-SITE request, and Lax would simply not
  // send the cookie — every image would 401. `None` is the only value that
  // works there, and browsers only accept it together with `Secure`, so an
  // insecure request keeps Lax rather than emitting a cookie the browser drops.
  parts.push(domain && secure ? 'SameSite=None' : 'SameSite=Lax');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Read the token back out of a `Cookie` request header. Hand-parsed rather than
// pulling in cookie-parser: one name, and the guard stays free of Express types.
export function extractSessionCookie(
  header: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}
