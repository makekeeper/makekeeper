// Desktop-session binding for the phone-bridge handshake (issue #10, #77). The
// desktop that creates a bridge session is tagged with an opaque, HttpOnly
// cookie; only that session may read the relayed messages back
// (`GET /sessions/:token/results`). The phone is a different device and never
// carries this cookie — it authenticates by the session token alone, so the
// public phone routes stay reachable.

export const OWNER_COOKIE = 'di_bridge_owner';

// Path-scoped to the bridge API so the cookie is sent on session create/poll
// but nowhere else. 30-day lifetime keeps one browser stable across sessions.
const COOKIE_PATH = '/api/phone-bridge';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// A framework-agnostic view of the bits of the request we read — mirrors the
// structural `RequestHeadersLike` convention in backend-core, so we avoid
// importing Express types.
export interface OwnerRequestLike {
  headers: {
    cookie?: string;
    'x-forwarded-proto'?: string | string[];
  };
}

// Structural view of the response — only `setHeader` is used, so we don't depend
// on Express's `Response`/`CookieOptions` types.
export interface SetCookieResponseLike {
  setHeader(name: string, value: string): void;
}

// Read the owner id from the request's Cookie header. Returns null when absent.
export function readOwnerId(req: OwnerRequestLike): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === OWNER_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// True when the request arrived over HTTPS (behind the tunnel/proxy). The
// `Secure` attribute is only set then, so the LAN-http desktop still receives
// the cookie.
export function isSecureRequest(req: OwnerRequestLike): boolean {
  const proto = req.headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return (value ?? '').split(',')[0].trim() === 'https';
}

// Build the Set-Cookie value for a freshly minted owner id.
export function buildOwnerSetCookie(ownerId: string, secure: boolean): string {
  const attrs = [
    `${OWNER_COOKIE}=${encodeURIComponent(ownerId)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
