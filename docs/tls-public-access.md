# TLS / public HTTPS access for phone-facing flows

**Status:** decided (discovery closed — see issue #8, split from #6).
**Scope:** how the app is exposed over HTTPS to phones, the `PUBLIC_BASE_URL`
config contract, and how the no-auth app is kept safe while a tunnel is up.

Phone-facing capture (issue #6) uses `getUserMedia`, which browsers allow **only
in a secure context (HTTPS)**. Phones reach the app over `http://<host>:8080`
(LAN, via nginx), which is not secure, so the camera is blocked. This document
records how we provide HTTPS without provisioning local certificates.

---

## 1. How HTTPS is provided

### Now (temporary) — Cloudflare Quick Tunnel

```bash
cloudflared tunnel --url http://localhost:8080
```

- **Zero configuration:** no Cloudflare account, no domain. Prints a random
  `https://<random>.trycloudflare.com` URL that terminates TLS at Cloudflare and
  forwards to the local nginx entry.
- **No interstitial page.** This matters because the phone loads both an HTML
  page (`/capture/:token`) and calls JSON endpoints (`/api/capture/*`). Some
  tunnels (e.g. ngrok free) inject a browser-warning page that replaces JSON
  responses with HTML; Cloudflare Quick Tunnel does not.
- **Same tooling as the target state** (below), so nothing is thrown away.
- **Trade-off:** the URL is ephemeral (changes on every restart). This is why
  `PUBLIC_BASE_URL` is derived from request headers by default — see §2.

**Run it on demand.** Bring the tunnel up for a capture session and take it down
after. `cloudflared` is not a project dependency; it is an operator tool run next
to the app, so it does not go in `package.json`.

**Tunnel target = the web entry, not the API.** The managed tunnel points at the
public web entry (nginx, `PUBLIC_WEB_PORT`, default 8080) which serves the SPA
and proxies `/api` to the backend — **not** at the backend API port. Pointing it
at the API makes phone-facing SPA routes like `/capture/:token` return a JSON 404
(the API has no such route); the SPA route must be served as `index.html` and
routed client-side by vue-router. Any external tunnel/proxy must likewise target
the web entry.

**Dev-server host allow-list.** In development the SPA is served by the Vite dev
server, which blocks requests whose `Host` header isn't allow-listed (a
DNS-rebinding guard). Tunnel hosts are arbitrary and ephemeral (a random
`*.trycloudflare.com`, or any operator's own domain), so they can't be
enumerated — `apps/frontend/vite.config.mts` sets `server.allowedHosts: true` to
allow any host. This is a dev-server setting only; a production static build
served by nginx has no such check.

### Target state (later, its own ticket) — Cloudflare Named Tunnel + Access

A named tunnel on a domain the operator already owns gives a **stable**
`https://<sub>.<operator-domain>` URL, and **Cloudflare Access / Zero Trust** in
front of it authenticates at the edge — closing the no-auth exposure (§3) without
adding auth to the app itself. Requires a Cloudflare account + the domain, so it
is deliberately out of scope for the temporary approach.

### Rejected / deferred alternatives

| Option | Why not (for now) |
|---|---|
| ngrok | Free tier injects an interstitial that breaks JSON `/api/*` responses unless a skip header is sent on every request. |
| Self-signed cert on nginx | Phone shows a warning the user must accept each time. |
| Internal-CA cert trusted on phone | Requires provisioning trust on every device; heavier than a tunnel for a temporary need. |
| Tailscale Funnel | Requires the Tailscale agent on server and phone; more setup than a quick tunnel. |

---

## 2. `PUBLIC_BASE_URL` config contract

The frontend uses **relative** `/api/...` paths and nothing knows an absolute
host. The QR code must encode an **absolute** URL
(`https://<public-host>/capture/<token>`), so we need one source of truth for the
public base address.

**Resolution order (first match wins):**

1. **`PUBLIC_BASE_URL` env override.** If set, it is authoritative. Use this with
   the stable named tunnel or any fixed hostname. No scheme/host guessing.
2. **Managed tunnel — when the mode demands it.** With tunnel mode **`on`** the
   operator forces the Cloudflare tunnel and its `*.trycloudflare.com` URL is
   used **regardless** of any detected HTTPS (a local-only domain that a phone
   can't otherwise reach still needs the tunnel). With mode **`auto`** the tunnel
   is used only when step 3 finds no existing HTTPS.
3. **Already-HTTPS detection — the desktop browser's own origin (#93).** The
   desktop that renders the QR knows authoritatively how the app was reached: its
   `window.location.origin` is sent with the create-session request. When that
   origin (or, failing that, the https forwarded headers) is a secure, non-loopback
   `https://` origin, it is used directly and — in `auto` mode — **the tunnel is
   skipped entirely.** This is what fixes the "front proxy reset `X-Forwarded-Proto`"
   case without `PUBLIC_BASE_URL`: the browser is on `https://mk.example.com`,
   so the QR is too, even though the inner header said `http`.
4. **Forwarded request headers.** Otherwise derive the base URL per-request from
   the forwarded scheme + `X-Forwarded-Host` (which `cloudflared` and nginx set),
   falling back to `Host`. This makes the ephemeral Quick Tunnel URL work with
   **no `.env` edit on every restart**. A non-default port that the forwarded
   host lost is restored from `X-Forwarded-Port` (#282).

**A caller that knows its own origin says so (#282).** `resolvePublicBaseUrl`
takes an optional `clientOrigin` — `window.location.origin` as the browser
reports it — and ranks it directly under the env override, above the headers.
The browser is the only party that holds scheme, host **and** port intact; every
hop between it and the app can drop a piece (nginx's `$host` drops the port,
which is why both nginx configs in this repo forward `$http_host`). This is the
same reasoning as step 3, generalised beyond the HTTPS question: the Settings →
API section shows the address a script should use, so it sends its own origin and
the answer says which rung it came from (`override` / `client` / `request`).

**Scheme detection (multi-proxy caveat).** The scheme is not read from a single
header. Behind **chained** reverse proxies where TLS terminates on the outermost
hop and the inner hop is plain http, e.g.

```
browser --https--> Nginx Proxy Manager --http:80--> Dokploy Traefik --> web(nginx) --> app
```

the inner Traefik receives the request on its http entrypoint and **overwrites
`X-Forwarded-Proto` with `http`** (it does not trust the upstream's forwarded
headers by default). The app would then build an `http://` base URL and the
phone-bridge would show a spurious "needs HTTPS" warning even though the app *is*
served over HTTPS. To survive this, `resolvePublicBaseUrl` consults **every**
de-facto scheme signal and treats "any of them says `https`" as https:

- `X-Forwarded-Proto` (standard; may be reset by an inner proxy)
- `X-Forwarded-Scheme` (set by NPM, **not** managed by Traefik → survives the hop)
- RFC 7239 `Forwarded: proto=…`
- `X-Forwarded-Ssl: on`
- `X-Url-Scheme`

A genuinely http-only LAN request carries none of these, so it still resolves to
`http://` (no false "secure"). If none of the signals reach the app (a proxy that
strips them all), set **`PUBLIC_BASE_URL`** explicitly — it always wins. The
Dokploy template (`deploy/dokploy/`) and the Coolify file (`deploy/coolify/`) both
leave `PUBLIC_BASE_URL` empty; set it to the public `https://` origin for a
proxied-HTTPS install that still shows the warning.

The same chain has a second consequence, on the **manager's** side: the domain
registered there describes the hop *it* serves, not the public one. Behind an
outer proxy that terminates TLS, Coolify's Domains field takes
`http://your.domain` — `https://` would have Traefik terminate TLS a second time
for a connection that arrives as plain http. The public origin then lives only in
`PUBLIC_BASE_URL`.

**The container port is never part of the public origin (#208).** This is the
canonical statement of the rule; the deploy files and `INSTALL.md` point here
rather than restating it.

Three ports are involved and only the first is public:

| Port | Who sets it | Public? |
|---|---|---|
| 443 | the manager's proxy, which terminates TLS | yes — the only one in the URL |
| container `80` | the `web` image (nginx `listen 80`, `EXPOSE 80`) | no |
| host `PUBLIC_WEB_PORT` (default 8080) | plain-compose/Portainer only, for direct access on the machine | no |

The `web` image listens on **80** so that a manager routing to the standard port
needs no port configured for the service at all. Where a manager does take one —
Coolify's Domains field, whose `https://host:port` form means "route to *this
container* port"; Dokploy's Domains tab / `template.toml` `port` — give it the
container port and keep the **domain portless**, because Coolify also presents
the stored domain as the deploy link, and nothing outside can reach that port.
Every stack in `deploy/` therefore names container port 80: `expose: ['80']`
(Coolify, Dokploy), `port = 80` (Dokploy template), `${PUBLIC_WEB_PORT:-8080}:80`
(plain compose). The host port stays freely configurable — it is not the one that
leaks.

nginx keeps a second `listen 8080` for continuity with stacks deployed before
#208, which route to that port; a newer image must not strip their route out from
under them. It is not advertised via `EXPOSE` (so a manager auto-detecting the
port from the image cannot pick it) and nothing in this repo targets it.

The app itself never emits the container port: it derives the origin from the
caller's own origin or from `X-Forwarded-Host`/`Host` (+ `X-Forwarded-Port`),
which carry the PUBLISHED port, if any — never the container's.

**Rules:**

- Read through a typed config accessor, **never `process.env` directly in app
  code** (CLAUDE.md §5.2). There is no general config service yet (only
  `PluginConfigService`, which is DB-backed plugin on/off), so #6 introduces a
  small `AppConfigService` in `@makekeeper/backend-core` that owns
  `PUBLIC_BASE_URL` and the header-derivation fallback, exposing e.g.
  `getPublicBaseUrl(req): string`.
- Validate the env value as an absolute `http(s)://` origin with no trailing
  slash; reject and log otherwise.
- **Consumers:** capture-session creation (returns the absolute `url`) and QR
  generation. Also the single source of truth for any future absolute links
  (emails, share links).

---

## 3. Securing public exposure while the app has no auth

The app has **no authentication** — every endpoint (data, agent tools including
WRITE/DESTRUCTIVE, uploads) is anonymous and fully trusted. A public tunnel makes
all of it internet-reachable. For the temporary approach we accept this under two
constraints:

1. **On-demand only.** The tunnel is brought up manually for a capture session and
   taken down after. There is no permanent public tunnel. The exposure window is
   short and the `trycloudflare.com` hostname is unguessable.
2. **Restrict the public surface to capture routes.** Only these paths are exposed
   through the tunnel; everything else stays LAN-only:
   - `/capture/*` — the phone capture page (SPA route)
   - `/api/capture/*` — capture-session endpoints
   - `/api/uploads/*` — attachment serving

   Enforce this at the tunnel/nginx layer (an allow-list `location` block on the
   tunnel-facing entry), not in app code, so the LAN entry is unaffected.

### Capture-session auth model (issue #10)

Within the capture surface, the token is no longer a plain bearer credential that
anyone holding the URL can fully use. Two properties now bound it:

- **Bound to the originating desktop.** Creating a session (`POST /api/capture/sessions`)
  tags the calling desktop browser with an opaque, `HttpOnly` cookie
  (`di_capture_owner`, `Path=/api/capture`, `SameSite=Lax`, `Secure` behind HTTPS)
  and stores that id on the session row. Reading the captured photos
  (`GET /api/capture/sessions/:token/results`) requires that cookie — a non-owner
  gets a `404`. The phone is a different device and never carries the cookie, so
  its routes stay reachable **by token alone**:
  - `GET /api/capture/sessions/:token` — validate/open
  - `POST /api/capture/sessions/:token/photos` — upload a frame
  - `POST /api/capture/sessions/:token/close` — finish
  - `GET /api/uploads/:id` — thumbnail bytes (UUID-keyed, unguessable)
- **Expires on completion.** When the phone taps *done* (or the desktop cancels),
  `close` marks the session `closed` **and** sets `expiresAt = now`, so the token
  dies the instant the transfer finishes — not after a fixed window. The 10-minute
  TTL remains only as a fallback for abandoned sessions.

Net effect: even if a capture URL leaks while a session is live, a stranger cannot
read the photos (owner-bound) and the window slams shut on completion. This gates
the capture surface itself; it is **not** a substitute for the surface restriction
above (which keeps the rest of the app off the tunnel entirely).

**Longer term:** if the whole app ever needs to be exposed, a minimal app-wide
auth/session layer or Cloudflare Access in front of the named tunnel (§1). Tracked
separately — out of scope here.

---

## 4. Summary

| Concern | Decision |
|---|---|
| HTTPS now | Cloudflare Quick Tunnel, on-demand, zero config |
| HTTPS target | Named tunnel on an operator-owned domain + Cloudflare Access (own ticket) |
| Absolute base URL | `PUBLIC_BASE_URL` → tunnel (mode `on`) → desktop browser origin / https headers (mode `auto` skips the tunnel when already HTTPS, #93) → tunnel (`auto`, no HTTPS) → header/Host fallback. Scheme reads any of `X-Forwarded-Proto`/`-Scheme`/`Forwarded`/`-Ssl` so it survives an inner-proxy reset. |
| Config access | Typed `AppConfigService` in `backend-core`; never raw `process.env` |
| No-auth exposure | On-demand tunnel + public surface limited to capture routes |
| Capture-session auth (#10) | Token bound to the creating desktop (HttpOnly cookie); reads owner-gated; expires on completion |

---

## 7. The mobile surface and its (optional) own origin — #198/#204

The mobile surface lives at **`/m`** on the main origin by default. Nothing about
cookies or CORS changes in that default; it is the same site as the desktop app.

**Installability.** An installed PWA is bound to its origin: manifest, service
worker, cache and stored session all belong to one host. The quick tunnel hands
out a fresh random `*.trycloudflare.com` name on every start, so an icon
installed from it is dead within the hour. `GET /api/mobile/origin` judges the
address a request arrived at and the shell suppresses the install prompt with the
reason shown (`ephemeral-host`, or `insecure` for plain http off loopback).

**Serving the mobile surface elsewhere (opt-in).**

The everyday way to set it is **Settings → Mobile app**, which stores the origin
and points the pairing QR (and the CORS allowlist) at it. The two environment
variables remain, with different roles:

| Variable | Meaning |
|---|---|
| `MOBILE_BASE_URL` | Absolute origin the mobile surface is published at (e.g. `https://phone.example.com`). Unset by default. When set it is a **hard override**: it wins over the UI setting, and the settings field renders read-only saying so — a deployment that states the address declaratively cannot be quietly contradicted from the database. |
| `SESSION_COOKIE_DOMAIN` | Bare hostname the `mk_session` cookie is issued for (e.g. `example.com`), so attachments load on the mobile host. Unset by default, and environment-only by nature: it has to be known before the first request is served, so there is no moment at which a stored value could be read in time. The settings screen shows its current value read-only. |

Both are deliberately explicit. A separate host is a separate **origin**, which
means a separate PWA installation, cross-origin `/api` calls, and a session
cookie that must be valid for both hosts. `SESSION_COOKIE_DOMAIN` is never
derived from the two origins: guessing a shared parent is exactly how a session
cookie ends up offered to unrelated hosts under the same registrable domain.
Keep it as narrow as the two addresses allow.

When a cookie domain is configured **and** the request is secure, the cookie
switches to `SameSite=None; Secure` — a picture requested by a page on the mobile
host is a cross-site request, and `Lax` would simply not send it. Without a
configured domain the cookie stays `SameSite=Lax` and domainless, exactly as
before #204.

**Installing from a tunnel.** There is no admin switch for installation (#210,
which removed one): a home-screen shortcut is the phone owner's business, and
gating our own offer only hid the feature from the person who wanted it. The
offer lives on the phone's pairing screen — a button where the browser gives us
`beforeinstallprompt`, an instruction where it does not (iOS Safari) — and on a
`*.trycloudflare.com` host it carries a warning next to it, because everything
the phone stores dies with that name on the next tunnel restart: the home-screen
icon, the offline cache, the queued shots and the pairing. The only address that
gets no offer at all is plain http off loopback, where the browser refuses the
service worker and the camera regardless.

**Pairing.** Phones authenticate with a long-lived **device token** rather than
the multiuser JWT (which has a TTL and no refresh): the desktop shows a one-time
code inside a QR at **Settings → Devices**, the phone trades it for a token, and
each device is revocable. See #199.
