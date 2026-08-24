import { execFileSync } from 'node:child_process';
import { AppConfigService, parseGitDescribe } from './app-config.service';

// The version fallback shells out to git; the ESM namespace can't be spied on,
// so the module is replaced outright. Nothing else in this suite runs a process.
jest.mock('node:child_process', () => ({ execFileSync: jest.fn() }));

// Public-URL resolution is the contract from docs/tls-public-access.md:
// PUBLIC_BASE_URL override → the caller's own origin, when it sent one →
// X-Forwarded-* → Host. These branches are pure and input-driven, so they
// unit-test cleanly.

describe('AppConfigService.resolvePublicBaseUrl', () => {
  const service = new AppConfigService();
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  const req = (headers: Record<string, string | string[] | undefined>) => ({
    headers,
  });

  it('prefers a valid PUBLIC_BASE_URL override and strips a trailing slash', () => {
    process.env.PUBLIC_BASE_URL = 'https://inspector.example.com/';
    expect(service.resolvePublicBaseUrl(req({ host: 'lan.local' }))).toBe(
      'https://inspector.example.com',
    );
  });

  it('ignores an invalid override and falls back to forwarded headers', () => {
    process.env.PUBLIC_BASE_URL = 'not-a-url';
    const url = service.resolvePublicBaseUrl(
      req({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'abc.trycloudflare.com',
        host: 'localhost:3000',
      }),
    );
    expect(url).toBe('https://abc.trycloudflare.com');
  });

  it('derives from X-Forwarded-* when no override is set', () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = service.resolvePublicBaseUrl(
      req({
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'tunnel.trycloudflare.com',
      }),
    );
    // The first hop of a comma-joined forwarded header wins.
    expect(url).toBe('https://tunnel.trycloudflare.com');
  });

  it('honours X-Forwarded-Scheme (https) when X-Forwarded-Proto was reset to http by an inner proxy', () => {
    delete process.env.PUBLIC_BASE_URL;
    // NPM terminates TLS and sets both headers; an inner Traefik hop on its
    // http entrypoint overwrites X-Forwarded-Proto but leaves X-Forwarded-Scheme.
    const url = service.resolvePublicBaseUrl(
      req({
        'x-forwarded-proto': 'http',
        'x-forwarded-scheme': 'https',
        'x-forwarded-host': 'mk.example.com',
        host: 'web:80',
      }),
    );
    expect(url).toBe('https://mk.example.com');
  });

  it('honours the RFC 7239 Forwarded: proto token', () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = service.resolvePublicBaseUrl(
      req({
        forwarded: 'for=1.2.3.4;proto=https;host=mk.example.com',
        'x-forwarded-host': 'mk.example.com',
      }),
    );
    expect(url).toBe('https://mk.example.com');
  });

  it('treats X-Forwarded-Ssl: on as https', () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = service.resolvePublicBaseUrl(
      req({ 'x-forwarded-ssl': 'on', host: 'mk.example.com' }),
    );
    expect(url).toBe('https://mk.example.com');
  });

  it('stays http for a genuinely http-only LAN request (no scheme signals)', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(req({ host: '192.168.1.10:8080' })),
    ).toBe('http://192.168.1.10:8080');
  });

  it('falls back to the Host header (http) when no forwarded headers exist', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(service.resolvePublicBaseUrl(req({ host: 'lan.local:8080' }))).toBe(
      'http://lan.local:8080',
    );
  });

  // #282: when the caller tells us the address it is on, that beats any
  // header-derived guess — it is the one place scheme, host and port are known
  // intact. An operator's explicit PUBLIC_BASE_URL still outranks it.
  it("prefers the caller's own origin over forwarded headers", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(
        req({ 'x-forwarded-host': 'box.lan', host: 'localhost:3000' }),
        'http://box.lan:8080/',
      ),
    ).toBe('http://box.lan:8080');
  });

  it('keeps the override above the caller-sent origin', () => {
    process.env.PUBLIC_BASE_URL = 'https://mk.example.com';
    expect(service.resolvePublicBaseUrl(req({}), 'http://box.lan:8080')).toBe(
      'https://mk.example.com',
    );
  });

  it('ignores a caller origin that is not an http(s) origin', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(req({ host: 'lan.local' }), 'javascript:1'),
    ).toBe('http://lan.local');
  });

  // #282: a proxy that forwards nginx's `$host` drops a non-default port, and
  // every address built from the result then points at 80/443. X-Forwarded-Port
  // is what still carries it.
  it('restores a non-default port the forwarded host lost', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(
        req({ 'x-forwarded-host': 'box.lan', 'x-forwarded-port': '8080' }),
      ),
    ).toBe('http://box.lan:8080');
  });

  it('leaves the scheme default port off', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(
        req({
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'mk.example.com',
          'x-forwarded-port': '443',
        }),
      ),
    ).toBe('https://mk.example.com');
    expect(
      service.resolvePublicBaseUrl(
        req({ 'x-forwarded-host': 'mk.example.com', 'x-forwarded-port': '80' }),
      ),
    ).toBe('http://mk.example.com');
  });

  it('keeps a port the host already names, over the forwarded one', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(
        req({ 'x-forwarded-host': 'box.lan:8443', 'x-forwarded-port': '80' }),
      ),
    ).toBe('http://box.lan:8443');
    // An IPv6 literal's own colons are not a port.
    expect(
      service.resolvePublicBaseUrl(
        req({ 'x-forwarded-host': '[::1]', 'x-forwarded-port': '8080' }),
      ),
    ).toBe('http://[::1]:8080');
  });

  it('ignores a junk X-Forwarded-Port rather than building a broken address', () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(
      service.resolvePublicBaseUrl(
        req({ host: 'lan.local', 'x-forwarded-port': 'nonsense' }),
      ),
    ).toBe('http://lan.local');
  });

  it('falls back to localhost when nothing identifies the host', () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.PORT;
    expect(service.resolvePublicBaseUrl(req({}))).toBe('http://localhost:3000');
  });
});

// #93: which public origin the app can already reach over HTTPS without a
// tunnel — the desktop browser's own origin first, then https forwarded headers.
describe('AppConfigService.pickSecurePublicOrigin', () => {
  const service = new AppConfigService();
  const req = (headers: Record<string, string | string[] | undefined>) => ({
    headers,
  });

  it('prefers the desktop browser origin (https) over the forwarded scheme', () => {
    expect(
      service.pickSecurePublicOrigin('https://mk.example.com/', {
        headers: { 'x-forwarded-proto': 'http', host: 'web:80' },
      }),
    ).toBe('https://mk.example.com');
  });

  it('falls back to https forwarded headers when no browser origin is supplied', () => {
    expect(
      service.pickSecurePublicOrigin(undefined, {
        headers: {
          'x-forwarded-scheme': 'https',
          'x-forwarded-host': 'mk.example.com',
        },
      }),
    ).toBe('https://mk.example.com');
  });

  it('rejects an http browser origin and http-only headers', () => {
    expect(
      service.pickSecurePublicOrigin('http://lan.local:8080', {
        headers: { host: 'lan.local:8080' },
      }),
    ).toBeNull();
  });

  it('rejects a loopback https origin as not phone-reachable', () => {
    expect(
      service.pickSecurePublicOrigin('https://localhost:8080', req({})),
    ).toBeNull();
    expect(
      service.pickSecurePublicOrigin('https://127.0.0.1', req({})),
    ).toBeNull();
    expect(service.pickSecurePublicOrigin('https://[::1]', req({}))).toBeNull();
  });

  it('ignores a malformed browser origin and consults the headers', () => {
    expect(
      service.pickSecurePublicOrigin('not a url', {
        headers: { 'x-forwarded-proto': 'https', host: 'mk.example.com' },
      }),
    ).toBe('https://mk.example.com');
  });
});

// The unpinned-build version fallback: the last release tag, "+"-suffixed when
// the tree carries work beyond it.
describe('parseGitDescribe', () => {
  it('returns the bare tag when HEAD is exactly on it', () => {
    expect(parseGitDescribe('v0.4.0-0-gc561440')).toBe('0.4.0');
  });

  it('marks commits past the tag with "+"', () => {
    expect(parseGitDescribe('v0.4.0-7-gc561440')).toBe('0.4.0+');
  });

  it('marks a dirty worktree with "+" even on the tag commit', () => {
    expect(parseGitDescribe('v0.4.0-0-gc561440-dirty')).toBe('0.4.0+');
  });

  it('keeps a prerelease tag intact', () => {
    expect(parseGitDescribe('v1.2.0-rc.1-3-gabc1234')).toBe('1.2.0-rc.1+');
  });

  it('returns null when there is no describe line to parse', () => {
    expect(parseGitDescribe('')).toBeNull();
    expect(parseGitDescribe('c561440')).toBeNull();
  });

  // A per-plugin release tag describes cleanly, so only the tag shape keeps it
  // out of the core's version — it must never surface as "mk-plugin-mcp/v0.1.1+".
  it('rejects a per-plugin release tag', () => {
    expect(parseGitDescribe('mk-plugin-mcp/v0.1.1-8-g67e3d73')).toBeNull();
    expect(parseGitDescribe('mk-plugin-mcp/v0.1.1-0-g67e3d73')).toBeNull();
  });
});

describe('AppConfigService.getAppVersion', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  // The real derivation shells out to git, so the branches are exercised through
  // a stubbed override — the environment must not decide which branch runs.
  class StubbedConfigService extends AppConfigService {
    calls = 0;

    constructor(private readonly derived: string | null) {
      super();
    }

    protected override deriveGitVersion(): string | null {
      this.calls += 1;
      return this.derived;
    }
  }

  it('prefers the baked-in APP_VERSION over any git derivation', () => {
    process.env.APP_VERSION = '0.9.1';
    const service = new StubbedConfigService('0.4.0+');
    expect(service.getAppVersion()).toBe('0.9.1');
    expect(service.calls).toBe(0);
  });

  it('falls back to the derived version when unpinned', () => {
    delete process.env.APP_VERSION;
    expect(new StubbedConfigService('0.4.0+').getAppVersion()).toBe('0.4.0+');
  });

  it('falls back to "dev" when the derivation fails', () => {
    delete process.env.APP_VERSION;
    expect(new StubbedConfigService(null).getAppVersion()).toBe('dev');
  });

  it('derives once and caches, including the failure case', () => {
    delete process.env.APP_VERSION;
    const service = new StubbedConfigService(null);
    service.getAppVersion();
    service.getAppVersion();
    expect(service.calls).toBe(1);
  });

  // The real derivation, with git itself stubbed: `describe` must be restricted
  // to product release tags, or it reports the newest per-plugin tag instead.
  it('asks git only for product release tags', () => {
    delete process.env.APP_VERSION;
    const git = jest.mocked(execFileSync);
    git.mockReturnValue('v0.13.1-8-g67e3d73');

    expect(new AppConfigService().getAppVersion()).toBe('0.13.1+');
    expect(git).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['describe', '--match', 'v[0-9]*']),
      expect.anything(),
    );

    git.mockReset();
  });
});

// The separate mobile origin (#204). Both getters are deliberately opt-in: with
// nothing configured they must answer null, and nothing downstream changes.
describe('AppConfigService mobile origin', () => {
  const service = new AppConfigService();
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('is absent by default', () => {
    delete process.env.MOBILE_BASE_URL;
    delete process.env.SESSION_COOKIE_DOMAIN;
    expect(service.getMobileOriginOverride()).toBeNull();
    expect(service.getSessionCookieDomain()).toBeNull();
  });

  it('normalizes a configured origin and rejects nonsense', () => {
    process.env.MOBILE_BASE_URL = 'https://phone.example.com/';
    expect(service.getMobileOriginOverride()).toBe('https://phone.example.com');
    process.env.MOBILE_BASE_URL = 'phone.example.com';
    expect(service.getMobileOriginOverride()).toBeNull();
  });

  it('accepts a bare cookie domain and drops the legacy leading dot', () => {
    process.env.SESSION_COOKIE_DOMAIN = '.example.com';
    expect(service.getSessionCookieDomain()).toBe('example.com');
  });

  it('refuses a cookie domain that is not a hostname', () => {
    process.env.SESSION_COOKIE_DOMAIN = 'https://example.com/path';
    expect(service.getSessionCookieDomain()).toBeNull();
  });
});
