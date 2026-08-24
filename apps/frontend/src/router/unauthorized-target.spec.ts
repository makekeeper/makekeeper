import { describe, expect, it } from 'vitest';
import { unauthorizedRedirectTarget } from './unauthorized-target';

// Reported from the shelf twice: a phone scanning a phone-bridge QR landed on
// /login. The route guard was never the culprit — it let the public page
// through, and then a background 401 dragged the phone off it anyway.

const route = (path: string, meta: Record<string, unknown> = {}) => ({
  path,
  meta,
});

describe('unauthorizedRedirectTarget', () => {
  it('leaves a public page exactly where it is', () => {
    // The QR page authenticates by the session token in its URL. A 401 from
    // some unrelated request says nothing about the visitor's right to be here.
    expect(
      unauthorizedRedirectTarget(
        route('/d/session-token', { public: true }),
        true,
      ),
    ).toBeNull();
  });

  it('leaves the mobile pairing page alone too — it is public by the same logic', () => {
    expect(
      unauthorizedRedirectTarget(route('/m/pair', { public: true }), true),
    ).toBeNull();
  });

  it('sends a phone with a dead credential to pairing, not to the desktop login', () => {
    expect(unauthorizedRedirectTarget(route('/m/inventory'), true)).toBe(
      '/m/pair',
    );
  });

  it('falls back to the login wall when the mobile plugin is not installed', () => {
    // Redirecting to a route that does not exist would strand the user on a
    // blank page.
    expect(unauthorizedRedirectTarget(route('/m/inventory'), false)).toBe(
      '/login',
    );
  });

  it('sends the mobile shell root itself to pairing', () => {
    // The installed PWA launches exactly here (#207).
    expect(unauthorizedRedirectTarget(route('/m'), true)).toBe('/m/pair');
  });

  it('does not claim a desktop page that merely starts with the same letter', () => {
    expect(unauthorizedRedirectTarget(route('/manual'), true)).toBe('/login');
  });

  it('sends an ordinary desktop page to the login wall', () => {
    expect(unauthorizedRedirectTarget(route('/inventory'), true)).toBe(
      '/login',
    );
  });
});
