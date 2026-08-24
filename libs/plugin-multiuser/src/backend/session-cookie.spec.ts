import {
  SESSION_COOKIE_NAME,
  buildClearedSessionCookie,
  buildSessionCookie,
  extractSessionCookie,
} from './session-cookie';

describe('session cookie (#123)', () => {
  describe('buildSessionCookie', () => {
    const cookie = buildSessionCookie('jwt-token', {
      secure: true,
      maxAgeSeconds: 60,
    });

    it('carries the token with the attributes that make it safe', () => {
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=jwt-token`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=60');
    });

    // Anything wider would hand the cookie to routes that must never accept it.
    it('is scoped to the attachment route only', () => {
      expect(cookie).toContain('Path=/api/uploads');
    });

    // A Secure cookie on a plain-http LAN instance is dropped by the browser,
    // which would 401 every picture.
    it('marks Secure only when asked to', () => {
      expect(cookie).toContain('Secure');
      expect(
        buildSessionCookie('jwt-token', { secure: false, maxAgeSeconds: 60 }),
      ).not.toContain('Secure');
    });
  });

  // A cookie is only replaced by a Set-Cookie whose name and path match, so the
  // cleared one has to repeat them.
  it('clears with a matching name and path', () => {
    const cleared = buildClearedSessionCookie(false);
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain('Path=/api/uploads');
    expect(cleared).toContain('Max-Age=0');
  });

  // A separate mobile host (#204). Everything here must stay OFF unless an
  // operator explicitly configured a cookie domain.
  describe('separate mobile origin', () => {
    it('stays Lax and domainless by default', () => {
      const cookie = buildSessionCookie('t', {
        secure: true,
        maxAgeSeconds: 60,
      });
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).not.toContain('Domain=');
    });

    it('widens to the configured domain and switches to SameSite=None', () => {
      // A picture requested by a page on the mobile host is a cross-site
      // request; Lax would simply not send the cookie and every image would 401.
      const cookie = buildSessionCookie('t', {
        secure: true,
        maxAgeSeconds: 60,
        domain: 'example.com',
      });
      expect(cookie).toContain('Domain=example.com');
      expect(cookie).toContain('SameSite=None');
      expect(cookie).toContain('Secure');
    });

    it('keeps Lax on an insecure request, where None would be dropped anyway', () => {
      const cookie = buildSessionCookie('t', {
        secure: false,
        maxAgeSeconds: 60,
        domain: 'example.com',
      });
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).not.toContain('Secure');
    });

    it('clears with the same domain, or a cookie survives the logout', () => {
      expect(buildClearedSessionCookie(true, 'example.com')).toContain(
        'Domain=example.com',
      );
    });
  });

  describe('extractSessionCookie', () => {
    it('finds the value among other cookies', () => {
      expect(
        extractSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=jwt; a=b`),
      ).toBe('jwt');
    });

    it('tolerates a header array', () => {
      expect(extractSessionCookie([`${SESSION_COOKIE_NAME}=jwt`])).toBe('jwt');
    });

    // A name that merely ends with ours must not match — `x_mk_session` is a
    // different cookie, and treating it as the session would let any other
    // cookie-setting surface speak for the user.
    it('matches the whole name only', () => {
      expect(extractSessionCookie(`x_${SESSION_COOKIE_NAME}=jwt`)).toBeNull();
    });

    it('reads an empty or absent value as no session', () => {
      expect(extractSessionCookie(`${SESSION_COOKIE_NAME}=`)).toBeNull();
      expect(extractSessionCookie('theme=dark')).toBeNull();
      expect(extractSessionCookie(undefined)).toBeNull();
    });
  });
});
