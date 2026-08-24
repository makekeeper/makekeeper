import type { RouteLocationNormalizedLoaded } from 'vue-router';
import {
  isMobileShellPath,
  MOBILE_PAIR_PATH,
} from '@makekeeper/plugin-contract';

// Where a visitor with no valid credential is sent — or, just as often, nowhere
// at all. Two callers ask: the 401 handler (a request came back unauthorized)
// and the route guard (an anonymous navigation while multi-user mode is on).
// They used to disagree, and that disagreement WAS #207: an installed PWA
// launching at /m was judged by the guard, thrown to the desktop /login, and
// signed in to the desktop app — the phone never got its shell back.
//
// Extracted from `main.ts` because that file is never exercised by a spec, and
// this decision is exactly the kind that breaks a page nobody thinks to retest:
// a phone scanning a phone-bridge QR was being thrown to /login not by the route
// guard — which correctly let it through — but by this handler firing on some
// unrelated background request.
//
// The rules, in order:
//   1. A PUBLIC page stays put. It authenticates by other means (a session token
//      in the URL, a one-time pairing code), so a 401 elsewhere says nothing
//      about the visitor's right to be here.
//   2. Inside the mobile shell, a lost credential means "pair again", not the
//      desktop login form the phone cannot use — and only when that route
//      exists, i.e. the mobile plugin is installed and enabled.
//   3. Otherwise, the login wall.
export function unauthorizedRedirectTarget(
  route: Pick<RouteLocationNormalizedLoaded, 'path' | 'meta'>,
  hasMobilePairRoute: boolean,
): string | null {
  if (route.meta.public === true) return null;
  // What counts as "inside the shell" is the contract's answer, not a second
  // one written here (§5.10): the scanner asks the same question of a scanned
  // URL, and the two must not drift apart.
  if (isMobileShellPath(route.path) && hasMobilePairRoute) {
    return MOBILE_PAIR_PATH;
  }
  return '/login';
}
