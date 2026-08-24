// The mobile surface (#198): a phone-sized shell mounted under `/m`, installable
// as a PWA when the instance is published at an address an installed app can
// actually live at.

import { LOCALE_PARAM, parseAppLocale, type AppLocale } from './locale';

// Where the mobile surface lives. Shared as contract DATA so the app shell can
// reason about the route root without importing the plugin that owns it.
export const MOBILE_ROOT_PATH = '/m';
export const MOBILE_PAIR_PATH = '/m/pair';
// The phone's own password wall (#207). A phone that lost its device token —
// an installed app whose storage the browser keeps apart from the tab it was
// installed from — must be able to get back in without being thrown to the
// desktop login page, which is not a page you can use one-handed.
export const MOBILE_LOGIN_PATH = '/m/login';
export const MOBILE_ROOT_ROUTE_NAME = 'mobile';
export const MOBILE_PAIR_ROUTE_NAME = 'mobile-pair';
export const MOBILE_LOGIN_ROUTE_NAME = 'mobile-login';

// "Is this path inside the phone shell?" — asked by the app shell (which route
// a lost credential goes to) and by anything matching a scanned URL against our
// own surface. ONE answer, because two of them is how the shell and the scanner
// end up disagreeing about what `/m` means.
//
// `/m` exactly, or a path BELOW it: a plain prefix test would claim a future
// `/manual`, and this decides real navigation, not only a 401.
export function isMobileShellPath(path: string): boolean {
  return path === MOBILE_ROOT_PATH || path.startsWith(`${MOBILE_ROOT_PATH}/`);
}

// What kind of address the phone is talking to.
// - `ok` — a stable, secure origin; nothing to warn about.
// - `ephemeral-host` — a throwaway tunnel name that will not exist tomorrow.
//   Installation is still OFFERED (#210): nobody is served by hiding a home-screen
//   shortcut from the person who asked for one, and suppressing it only made the
//   feature look broken. What the surface owes them is the truth about the
//   address, shown next to the button.
// - `insecure` — plain http off loopback: no secure context, so the browser
//   refuses the service worker and the camera anyway, whatever we offer.
export type MobileOriginVerdict = 'ok' | 'ephemeral-host' | 'insecure';

// Whether an installed app can exist here at all — asked by the install offer and
// by the shell deciding whether to register a worker. A disposable name still
// qualifies; an origin the browser refuses to treat as secure does not.
export function isInstallableVerdict(verdict: MobileOriginVerdict): boolean {
  return verdict !== 'insecure';
}

// `GET /api/mobile/origin` — what the shell needs to decide whether to offer
// installation, and what to tell the user when it does not.
export interface MobileOriginInfo {
  verdict: MobileOriginVerdict;
  // The origin this answer is about, as the request arrived (scheme + host).
  origin: string;
  // Where the mobile surface is deliberately published, when the operator gave
  // it its own host (#204). Null — the default — means it lives at `/m` on the
  // main origin and no cookie or CORS behaviour changed.
  mobileOrigin: string | null;
  // Whether a phone can be brought onto this instance at all right now: there is
  // either a permanent HTTPS address or a tunnel that can carry one. The header
  // pairing button hangs on this — offering a QR that leads nowhere is worse
  // than not offering it.
  canPair: boolean;
}

// ── Mobile settings ───────────────────────────────────────────────────────
// `GET/PATCH /api/mobile/settings`. Instance administration: where the phone
// surface is published. Installability is NOT administered — it is a property of
// the address, reported by `MobileOriginInfo` and explained on the phone (#210).
export interface MobileSettingsPublic {
  // The address the mobile surface is published at, set in the UI. Null means
  // it simply lives at `/m` on the main origin.
  customOrigin: string | null;
  // `MOBILE_BASE_URL` when the environment sets it — a hard override, so the UI
  // shows the field read-only and says why rather than pretending to own it.
  originEnvOverride: string | null;
  // `SESSION_COOKIE_DOMAIN`, reported read-only: it must be known before the
  // first request is served, so it stays environment-only by nature.
  sessionCookieDomain: string | null;
}

export function isMobileSettingsPublic(
  value: unknown,
): value is MobileSettingsPublic {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.customOrigin === null ||
    typeof candidate.customOrigin === 'string'
  );
}

// ── Device pairing (#199) ─────────────────────────────────────────────────
// An installed phone stays signed in for weeks, which the multiuser JWT cannot
// do. So the desktop shows a QR carrying a one-time code, the phone trades it
// for a long-lived device token, and the token is revocable per device.

// A paired device as shown to a human. Never carries the credential.
export interface PairedDevice {
  id: string;
  name: string;
  // ISO timestamps — this crosses the wire as JSON.
  createdAt: string;
  lastSeenAt: string | null;
}

// `POST /api/devices/pairing-code` — everything the desktop needs to render the
// QR, plus the deadline so the UI can show it going stale.
export interface DevicePairingOffer {
  // Identifies this offer so the desktop can ask whether it has been taken up —
  // never the code itself, which stays in the QR.
  id: string;
  // The URL encoded in the QR: the mobile pairing route with the code in it.
  // The QR is drawn by the desktop from this (#263) — a server-rendered image
  // is opaque to the cascade and so cannot follow the viewer's theme.
  url: string;
  expiresAt: string;
  // How long to HOLD the QR before showing it, because the tunnel carrying this
  // address has only just come up and its name is still propagating. Zero on a
  // permanent address. A QR shown a second too early sends the person to a
  // "site not found" and teaches them the feature is broken.
  warmupSeconds: number;
}

// `POST /api/devices/redeem` — the phone's half of pairing. Also the answer of
// `POST /api/devices/self`, where an already-authenticated phone pairs ITSELF
// (#207): signing in with a password leaves the phone holding a JWT, which
// expires in hours, and the next launch would ask for the password again — the
// very symptom the ticket is about. The device token is what survives.
export interface DevicePairingResult {
  // The long-lived credential. Returned exactly once, at redemption.
  token: string;
  device: PairedDevice;
}

// Query parameter carrying the one-time code into the mobile pairing route.
export const DEVICE_PAIRING_CODE_PARAM = 'code';

// Is this the pairing route, as it appears in a scanned URL? The same notion of
// "our path" as `isMobileShellPath`, read off the END of a pathname: an instance
// published under a prefix serves the surface at `/app/m/pair`.
function isPairingPathname(pathname: string): boolean {
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return path.endsWith(MOBILE_PAIR_PATH);
}

// What a scanned pairing QR hands over.
export interface PairingHandoff {
  // The one-time code, the credential half of the handoff.
  code: string;
  // The language of the desktop that painted the QR (#211), when it is one we
  // ship — null for a QR that predates the parameter, or carries junk. The
  // camera app applies this by navigating to the URL; a scan from INSIDE the
  // app never navigates, so it has to read the language back out here.
  locale: AppLocale | null;
}

// What a scanned pairing QR carries, or null when the thing that was scanned is
// not one of ours (#207).
//
// The QR the desktop paints is a full URL (`https://host/m/pair?code=…`), which
// is what makes ONE scan both open the app and pair it. A phone that is already
// inside the app scans the very same QR to re-pair — and there the URL is not a
// destination but an envelope, so the code has to be read back out of it.
//
// ONLY that URL is accepted. A bare word would be tempting to allow — someone
// could read a code aloud — but the camera also decodes CODE_128 and EAN, i.e.
// this app's own printed shelf labels: a label that drifted into frame would
// pass as a credential, close the camera and burn the person's pairing attempt
// on a code that was never a code.
export function parsePairingHandoff(scanned: string): PairingHandoff | null {
  const trimmed = scanned.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isPairingPathname(url.pathname)) return null;
  const code = url.searchParams.get(DEVICE_PAIRING_CODE_PARAM)?.trim();
  if (!code) return null;
  return { code, locale: parseAppLocale(url.searchParams.get(LOCALE_PARAM)) };
}
