# `deploy/coolify/` — MakeKeeper on Coolify

`makekeeper.yaml` is the MakeKeeper stack for Coolify. It is written for one
flow, and that flow is the whole design goal:

> *New resource → **Docker Compose Empty*** → paste the file → on the `web`
> service, set **Domains** to `https://your.domain` → **Deploy**. The app is up.

Coolify generates the DB password and both app secrets itself; the domain is the
only thing typed by hand. Full steps:
[`../../INSTALL.md`](../../INSTALL.md) §(c).

## Why the file looks like this

Everything here follows Coolify's own compose documentation; the deviations we
tried and reverted are recorded because each one cost a deploy.

| Decision | Reason |
|---|---|
| Routing is left to Coolify — **no `traefik.*` labels in the file** | Hand-written Traefik labels are documented for *Raw Compose Deployment* only. In normal mode Coolify builds the router from the domain you assign to `web`; a second hand-rolled router just competes with it. |
| `SERVICE_FQDN_WEB` on `web`, plus a domain you type over it | The magic var makes Coolify generate an address on first deploy, the way its catalogue services do. It writes only into an empty Domains field (`$isNew \|\| fqdn === null`), so the domain you enter afterwards wins permanently. Type it as a full FQDN with a scheme — that is the format Coolify's domain fields parse — and note Coolify validates its DNS against `1.1.1.1`, so a LAN-only domain needs *Settings → Advanced → Custom DNS Servers*. **FQDN, not URL**: only a `SERVICE_FQDN*` key assigns the domain a service is routed by. |
| Behind an outer TLS-terminating proxy, the Coolify domain is `http://…` | It describes the hop Coolify's Traefik serves; `https://` would terminate TLS twice. Set `PUBLIC_BASE_URL` to the public `https://` origin so the app's own links stay right — see [`../../docs/tls-public-access.md`](../../docs/tls-public-access.md). |
| **No `networks:` at all** | Coolify's docs are explicit: a custom network puts containers on two networks at once, Traefik non-deterministically picks an IP it cannot reach, and the app hangs or 504s — intermittently, so it can survive one deploy and break the next. |
| No `${VAR:?}` required-variable syntax | Coolify treats `:?` as "required" and blocks the deploy outright ("Unable to deploy. Required environment variables missing") rather than letting you fill the value in. |
| No `ports:` anywhere | Traefik (Coolify's proxy) already owns host 80/443; publishing a host port collides with it. `expose: '80'` names the container port instead, so the domain stays portless (#208). |
| `SERVICE_PASSWORD_POSTGRES`, `SERVICE_BASE64_64_APPSECRET`, `SERVICE_BASE64_64_JWTSECRET` | Pure value generation — no routing involved. Generated on first deploy and persisted, so no secret is ever typed. |
| `web` uses `depends_on: [app]`, **not** `condition: service_healthy` | nginx resolves `app` as soon as that container exists. Gating on *health* means a slow or unhappy backend leaves `web` non-existent — the domain then routes to nothing, and no log anywhere explains it. Serving the SPA (and a 502 on `/api`) beats serving nothing. |
| Healthcheck only on `db` | The `app` and `web` images ship their own `HEALTHCHECK`; Postgres does not, and `app` waits on it. |
| Top-level `volumes:` declared | Coolify's parser would add them, but a file that is valid standalone `docker compose` cannot be broken by a parser difference between Coolify versions. |
| Metadata header (`# documentation / slogan / category / tags / logo / port`) | Inert for a pasted compose; it is what Coolify's service catalogue reads. See below. |

## Submitting to the catalogue (later)

The header above is already in the shape `templates/compose/<service>.yaml`
entries use, so the catalogue PR is mostly a copy:

1. Copy `makekeeper.yaml` to `templates/compose/makekeeper.yaml` in a fork of
   [`coollabsio/coolify`](https://github.com/coollabsio/coolify).
2. Add the logo as `public/svgs/makekeeper.png`, matching the `# logo:` header
   (an SVG is preferred; until one exists,
   `apps/frontend/public/icons/icon-512.png` is the source asset).
3. A catalogue entry is expected to come up without anyone typing a domain —
   `- SERVICE_FQDN_WEB` on the `web` service already covers that. Deploy the
   file once through *Docker Compose (Empty)* on a real instance — the test the
   maintainers ask for — then open the PR.

> Coolify's contribution guide gates catalogue inclusion on the project's own
> repository having **≥ 1 000 stars**. Until MakeKeeper clears that bar the paste
> flow above is the install route — it needs no upstream change and no hosting.
