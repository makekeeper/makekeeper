import { Injectable, Logger } from '@nestjs/common';
import {
  PRODUCT_SLUG,
  type ApiBaseUrlSource,
} from '@makekeeper/plugin-contract';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'path';

// The single typed accessor for process-level app configuration. Per CLAUDE.md
// §5.2, app code must read config through this service, never `process.env`
// directly — so environment reads live in one auditable place.
//
// Nx loads `.env` into the process env at boot; this service reads from it once
// and exposes validated, typed getters.

// The subset of an incoming HTTP request this service needs to derive the
// public base URL. Kept structural (not the framework Request) so the service
// stays free of a platform dependency.
export interface RequestHeadersLike {
  headers: Record<string, string | string[] | undefined>;
}

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') {
    // A comma-joined forwarded header ("proto, proto2") — take the first hop.
    const first = value.split(',')[0]?.trim();
    return first || undefined;
  }
  return undefined;
};

// Extract the `proto` token from an RFC 7239 `Forwarded:` header, e.g.
// `Forwarded: for=1.2.3.4;proto=https;host=example.com` → "https". Only the
// first forwarded element (the closest client hop) is consulted.
const parseForwardedProto = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const firstElement = value.split(',')[0];
  const match = /proto=("?)([^";]+)\1/i.exec(firstElement);
  return match?.[2]?.trim() || undefined;
};

// Whether a host authority already names a port. IPv6 literals are bracketed,
// so the colons inside them are not a port — only one after the bracket is.
const hasExplicitPort = (host: string): boolean =>
  host.startsWith('[') ? host.includes(']:') : host.includes(':');

// Product release tags only. The repo also carries per-plugin release tags
// ("mk-plugin-<id>/vX.Y.Z", see /mk-release), and an unfiltered `git describe`
// happily reports the newest of *those* as the core's version.
const RELEASE_TAG_GLOB = 'v[0-9]*';

// `git describe --tags --dirty --long` output → the version shown in the UI.
// The `--long` form is always "<tag>-<commits>-g<sha>[-dirty]", so the released
// tag is recoverable even when HEAD sits exactly on it; "+" marks anything
// beyond that release (commits since the tag, or uncommitted changes).
// Returns null when the output isn't a describe line over a release tag — a
// non-semver tag is rejected here too, so a stray tag shape can never reach the
// UI (and, being unparseable downstream, silently disable the update check).
export const parseGitDescribe = (described: string): string | null => {
  const match =
    /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)-(\d+)-g[0-9a-f]+(-dirty)?$/.exec(
      described.trim(),
    );
  if (!match) return null;
  const ahead = Number(match[2]) > 0 || match[3] !== undefined;
  return `${match[1]}${ahead ? '+' : ''}`;
};

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  // `undefined` = not derived yet, `null` = derivation failed (don't retry).
  private gitVersion: string | null | undefined = undefined;

  // Root folder for uploaded attachments. Defaults to "<cwd>/uploads".
  getUploadsRoot(): string {
    return resolve(
      process.env.UPLOADS_DIR?.trim() || join(process.cwd(), 'uploads'),
    );
  }

  getPort(): number {
    return this.readPort(process.env.PORT, 3000);
  }

  // The running release version, baked into the image by the release workflow
  // (APP_VERSION build-arg). Consumed by the update checker to compare against
  // the latest published tag.
  //
  // Unpinned builds (dev containers, self-built images with the repo present)
  // fall back to the last release tag reachable from HEAD, suffixed with "+"
  // when the working tree carries work beyond that tag — so the UI shows a real
  // version ("0.4.0+") instead of an opaque "dev". "dev" remains the last resort
  // when there is no git repo/tag to derive from.
  getAppVersion(): string {
    const pinned = process.env.APP_VERSION?.trim();
    if (pinned) return pinned;
    if (this.gitVersion === undefined)
      this.gitVersion = this.deriveGitVersion();
    return this.gitVersion ?? 'dev';
  }

  // `protected` so a test can substitute the git call — the derivation itself is
  // environment-dependent and unmockable otherwise.
  protected deriveGitVersion(): string | null {
    let described: string;
    try {
      described = execFileSync(
        'git',
        [
          'describe',
          '--tags',
          '--dirty',
          '--long',
          '--match',
          RELEASE_TAG_GLOB,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
    } catch {
      // No git, no repo, or no tag — the caller falls back to "dev".
      return null;
    }
    return parseGitDescribe(described);
  }

  // Self-declared install method, stamped by the deploy artifact (#100). Raw and
  // unvalidated on purpose: InstallInfoService owns the vocabulary and decides
  // what an unrecognised value means. Null when unset.
  getInstallMethodMarker(): string | null {
    return process.env.MK_INSTALL_METHOD?.trim() || null;
  }

  // Injected by kubelet into every pod, so its presence identifies a Kubernetes
  // install even when the marker is missing. Null outside Kubernetes.
  getKubernetesServiceHost(): string | null {
    return process.env.KUBERNETES_SERVICE_HOST?.trim() || null;
  }

  // GitHub "owner/repo" the update checker queries for the latest release tag.
  // Overridable for forks; defaults to the canonical repo.
  getUpdateCheckRepo(): string {
    return (
      process.env.UPDATE_CHECK_REPO?.trim() || `${PRODUCT_SLUG}/${PRODUCT_SLUG}`
    );
  }

  // The public web entry (nginx) that serves the SPA and proxies /api. A managed
  // tunnel must target THIS, not the API port, so phone-facing SPA routes like
  // /capture/:token resolve to index.html (not a 404 from the API). Defaults to
  // the devcontainer nginx port 8080.
  getWebPort(): number {
    return this.readPort(process.env.PUBLIC_WEB_PORT, 8080);
  }

  private readPort(raw: string | undefined, fallback: number): number {
    const parsed = raw?.trim() ? Number.parseInt(raw.trim(), 10) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  // Secret for signing multiuser JWTs. Returns null when unset or too short —
  // callers must treat null as "auth unavailable" (503 on login/register)
  // rather than falling back to a weak default.
  getJwtSecret(): string | null {
    const raw = process.env.JWT_SECRET?.trim();
    if (!raw) return null;
    if (raw.length < 32) {
      this.logger.warn('Ignoring JWT_SECRET shorter than 32 characters.');
      return null;
    }
    return raw;
  }

  // Upper bound for an uploaded exchange archive (`.mkx`), in bytes.
  // EXCHANGE_UPLOAD_LIMIT_MB overrides the 512 MB default; instance backups
  // with a large uploads tree may need more.
  getExchangeUploadLimitBytes(): number {
    const DEFAULT_MB = 512;
    const raw = process.env.EXCHANGE_UPLOAD_LIMIT_MB?.trim();
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MB;
    return mb * 1024 * 1024;
  }

  // Minimum length for the app secret — matches the JWT secret floor. scrypt
  // stretches it regardless, but a short secret is a configuration mistake.
  static readonly APP_SECRET_MIN_LENGTH = 32;

  // App-wide secret for encrypting stored third-party credentials at rest
  // (provider API keys, the tracking-account password) and for wrapping per-user
  // data keys. REQUIRED: no JWT_SECRET fallback — the two rotate independently,
  // and sharing them would tie secret-at-rest safety to the auth secret. Null
  // when unset or shorter than the floor; SecretBoxService fails the boot on
  // null so no code path ever silently persists a secret in clear text.
  getAppSecret(): string | null {
    const raw = process.env.APP_SECRET?.trim();
    if (!raw || raw.length < AppConfigService.APP_SECRET_MIN_LENGTH)
      return null;
    return raw;
  }

  // External-plugin DEV MODE (#139): a fixed, reusable install token so a
  // plugin under development re-registers on every restart without a UI
  // round-trip. Null unless MK_EXTERNAL_DEV=1 AND a token is set — gated on an
  // explicit flag rather than NODE_ENV, so a production image cannot acquire a
  // standing install credential because one variable was forgotten.
  getExternalDevInstallToken(): string | null {
    if (process.env.MK_EXTERNAL_DEV !== '1') return null;
    const raw = process.env.MK_EXTERNAL_DEV_TOKEN?.trim();
    return raw ? raw : null;
  }

  // Token lifetime in seconds. JWT_TTL accepts "3600", "45m", "12h" or "30d";
  // anything unparsable falls back to the 7-day default. A week bounds how long
  // a captured token stays usable (#241) — epoch revocation kills it earlier on
  // logout/password change — while a weekly re-login stays tolerable for a
  // self-hosted instance; a deployment that prefers longer sessions raises
  // JWT_TTL explicitly.
  getJwtTtlSeconds(): number {
    const DEFAULT = 7 * 24 * 60 * 60;
    const raw = process.env.JWT_TTL?.trim();
    if (!raw) return DEFAULT;
    const match = /^(\d+)([smhd]?)$/.exec(raw);
    if (!match) {
      this.logger.warn(`Ignoring invalid JWT_TTL "${raw}".`);
      return DEFAULT;
    }
    const value = Number.parseInt(match[1], 10);
    const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1;
    return value * unit;
  }

  // Explicit override for the absolute public base URL (no trailing slash).
  // Returns null when unset or invalid — callers then fall back to request
  // headers. See docs/tls-public-access.md.
  getPublicBaseUrlOverride(): string | null {
    const raw = process.env.PUBLIC_BASE_URL?.trim();
    if (!raw) return null;
    const normalized = this.normalizeOrigin(raw);
    if (!normalized) {
      this.logger.warn(
        `Ignoring invalid PUBLIC_BASE_URL "${raw}" — expected an absolute http(s) origin.`,
      );
      return null;
    }
    return normalized;
  }

  // Where the MOBILE surface is published, when it is deliberately somewhere
  // else than the main app (#204) — a short domain that is easier to scan and an
  // installed app that is visibly its own thing. Null (the default) means the
  // mobile surface is simply `/m` on the main origin and NOTHING about cookies
  // or CORS changes.
  //
  // A separate host is a separate ORIGIN, which is why this is opt-in and
  // explicit rather than derived from anything.
  getMobileOriginOverride(): string | null {
    const raw = process.env.MOBILE_BASE_URL?.trim();
    if (!raw) return null;
    const normalized = this.normalizeOrigin(raw);
    if (!normalized) {
      this.logger.warn(
        `Ignoring invalid MOBILE_BASE_URL "${raw}" — expected an absolute http(s) origin.`,
      );
      return null;
    }
    return normalized;
  }

  // Domain attribute for the session cookie, so it is also valid on the mobile
  // host (#204). Deliberately NOT derived from the two origins: guessing a
  // shared parent is exactly how a session cookie ends up offered to unrelated
  // hosts under the same registrable domain. An operator who wants this says so.
  getSessionCookieDomain(): string | null {
    const raw = process.env.SESSION_COOKIE_DOMAIN?.trim();
    if (!raw) return null;
    // A leading dot is the old spelling of "and its subdomains"; modern
    // browsers imply it, so normalize it away rather than emitting both forms.
    const domain = raw.replace(/^\./, '');
    if (!/^[a-z0-9.-]+$/i.test(domain)) {
      this.logger.warn(
        `Ignoring invalid SESSION_COOKIE_DOMAIN "${raw}" — expected a bare hostname.`,
      );
      return null;
    }
    return domain;
  }

  // Resolve the absolute public base URL for building phone-facing links.
  // Precedence: PUBLIC_BASE_URL override → the caller's own origin, when it
  // sent one → X-Forwarded-* (proxy/tunnel aware) → the request Host. Always
  // returns a value with no trailing slash.
  //
  // `clientOrigin` is `window.location.origin` as the browser reports it: the
  // ground truth for how the app was actually reached, scheme, host AND port,
  // with nothing in between to lose a piece of it — the same reason
  // `pickSecurePublicOrigin` ranks it first (#93). The forwarded headers below
  // remain the answer for everything built without a browser in the loop.
  resolvePublicBaseUrl(req: RequestHeadersLike, clientOrigin?: string): string {
    return this.resolvePublicBaseUrlWithSource(req, clientOrigin).url;
  }

  // Same resolution, plus WHICH rung answered. A surface that shows the address
  // to a person (the API section, #282) has to be able to say where it came
  // from — "your browser's address" and "our best guess from the proxy headers"
  // are different promises, and only the caller knows which one it is looking
  // at. Derived here rather than re-compared by the caller, which would mean
  // re-implementing the normalisation to recognise its own origin.
  resolvePublicBaseUrlWithSource(
    req: RequestHeadersLike,
    clientOrigin?: string,
  ): { url: string; source: ApiBaseUrlSource } {
    const override = this.getPublicBaseUrlOverride();
    if (override) return { url: override, source: 'override' };

    const fromClient = this.normalizeOrigin(clientOrigin?.trim() ?? '');
    if (fromClient) return { url: fromClient, source: 'client' };

    const proto = this.resolveForwardedProto(req.headers);
    const host =
      firstHeader(req.headers['x-forwarded-host']) ??
      firstHeader(req.headers['host']);

    if (!host) {
      this.logger.warn(
        'Could not derive public base URL from request headers (no Host/X-Forwarded-Host).',
      );
      return {
        url: `http://localhost:${this.getPort()}`,
        source: 'request',
      };
    }
    return {
      url: `${proto}://${this.withForwardedPort(host, proto, req.headers)}`,
      source: 'request',
    };
  }

  // Put back a non-default port the forwarded host lost. nginx's `$host` — the
  // value both of this repo's proxy configs pass on — is the server NAME, with
  // the port stripped; an instance published on `http://box.lan:8080` therefore
  // arrives as `box.lan` and every address built from it points at port 80.
  // `X-Forwarded-Port` is the header that still carries it. Applied only when
  // the host names no port of its own (an explicit one wins) and only when the
  // port is not the scheme's default, so an ordinary https deployment does not
  // start advertising `:443`.
  private withForwardedPort(
    host: string,
    proto: 'http' | 'https',
    headers: RequestHeadersLike['headers'],
  ): string {
    if (hasExplicitPort(host)) return host;
    const forwarded = firstHeader(headers['x-forwarded-port'])?.trim();
    if (!forwarded || !/^\d{1,5}$/.test(forwarded)) return host;
    const defaultPort = proto === 'https' ? '443' : '80';
    return forwarded === defaultPort ? host : `${host}:${forwarded}`;
  }

  // Whether THIS request reached us over TLS — the question a `Secure` cookie
  // attribute asks. Deliberately not routed through `resolvePublicBaseUrl`:
  // that one honours the PUBLIC_BASE_URL override, which describes how the
  // instance is published, not how the caller arrived. Marking a cookie
  // `Secure` on an http-only LAN request would make the browser drop it
  // silently (#123).
  // Takes the bare header bag rather than the whole request: its only caller
  // gets one straight from Nest's `@Headers()`, and the wrapper would be
  // packed and unpacked for nothing.
  isRequestSecure(headers: RequestHeadersLike['headers']): boolean {
    return this.resolveForwardedProto(headers) === 'https';
  }

  // Derive the public scheme from the proxy-forwarded headers, preferring any
  // trustworthy `https` signal over a bare `http`. A single header is not
  // enough behind chained reverse proxies: an inner hop (e.g. Traefik on its
  // http entrypoint) commonly overwrites `X-Forwarded-Proto` with `http` while
  // leaving `X-Forwarded-Scheme` (set by an outer TLS-terminating NPM) intact.
  // So we consult every de-facto scheme signal and treat "any says https" as
  // https — the phone-bridge needs HTTPS and a false `http` breaks it, whereas
  // a spurious `https` cannot arise from a genuinely http-only LAN request
  // (none of these headers are present there).
  private resolveForwardedProto(
    headers: RequestHeadersLike['headers'],
  ): 'http' | 'https' {
    const signals = [
      firstHeader(headers['x-forwarded-proto']),
      firstHeader(headers['x-forwarded-scheme']),
      parseForwardedProto(firstHeader(headers['forwarded'])),
      firstHeader(headers['x-forwarded-ssl']) === 'on' ? 'https' : undefined,
      firstHeader(headers['x-url-scheme']),
    ];
    return signals.some((s) => s?.toLowerCase() === 'https') ? 'https' : 'http';
  }

  // The phone-reachable, secure-context origin we already have — if any —
  // without spinning up a tunnel. Precedence:
  //   1. the desktop browser's own origin (`clientOrigin`), which is the ground
  //      truth for how the app was actually reached (address bar), beating any
  //      forwarded-header guess;
  //   2. the request's forwarded scheme/host.
  // Only `https` on a non-loopback host qualifies: getUserMedia needs a secure
  // context, and a loopback/link-local host is not reachable from the phone.
  // Returns null when neither yields a usable secure public origin — the caller
  // then falls back to a managed tunnel (or the plain header URL).
  pickSecurePublicOrigin(
    clientOrigin: string | undefined,
    req: RequestHeadersLike,
  ): string | null {
    const fromClient = this.normalizeOrigin(clientOrigin?.trim() ?? '');
    if (fromClient && this.isSecurePublicOrigin(fromClient)) return fromClient;

    const fromHeaders = this.resolvePublicBaseUrl(req);
    if (this.isSecurePublicOrigin(fromHeaders)) return fromHeaders;

    return null;
  }

  private isSecurePublicOrigin(origin: string): boolean {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && !this.isLoopbackHost(url.hostname);
    } catch {
      return false;
    }
  }

  private isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    );
  }

  // Validate a string as an absolute http(s) origin and strip any trailing
  // slash. Returns null when it is not a usable origin.
  private normalizeOrigin(value: string): string | null {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  }
}
