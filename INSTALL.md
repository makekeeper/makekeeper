# Installing & updating MakeKeeper (self-host)

MakeKeeper ships as two container images published to the GitHub Container
Registry (ghcr.io):

| Image                    | Role                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `ghcr.io/makekeeper/app` | Node backend (REST API + agent runtime). Runs DB migrations on start. |
| `ghcr.io/makekeeper/web` | nginx: serves the SPA and reverse-proxies `/api` to the app.          |

The stack also runs a bundled **PostgreSQL 16** and persists two named volumes
(`pgdata`, `uploads`).

> Packages are published under the `makekeeper` GitHub organization. Override the image
> references via `IMAGE_APP` / `IMAGE_WEB` (or `MK_GH_OWNER`) if you fork them.

---

## Requirements

- **Docker Engine** + **Docker Compose v2** (`docker compose version`).
- One free host port for the web UI (default `8080`).
- For a public deployment: a TLS-terminating reverse proxy (Caddy, Traefik,
  nginx, or the one built into Portainer/Coolify) in front of the `web` service.
- For path 2: a container manager — **Portainer**, **Coolify**, **Dokploy**, or
  plain `docker compose`.

---

## Path 1 — one-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh | bash
```

The installer:

1. checks Docker + Docker Compose,
2. creates `./makekeeper/`,
3. downloads `docker-compose.prod.yml`,
4. generates `./makekeeper/.env` with fresh random secrets
   (`APP_SECRET`, `JWT_SECRET`, `POSTGRES_PASSWORD`) — **only if `.env` doesn't exist yet**,
5. pulls the images and starts the stack,
6. waits for readiness and prints the URL (`http://localhost:8080`).

Override defaults with env vars, e.g. a different owner or install dir:

```bash
curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh \
  | MK_GH_OWNER=makekeeper MK_DIR=/opt/makekeeper bash
```

**Keep `./makekeeper/.env` safe and backed up** — it holds your secrets.
Losing `APP_SECRET` makes stored encrypted secrets unrecoverable.

---

## Path 2 — deploy the stack manually

All variants use the **same** `deploy/docker-compose.prod.yml` (pre-built images,
no build step). Secrets are **required** — the stack refuses to start without
`APP_SECRET`, `JWT_SECRET`, and `POSTGRES_PASSWORD`.

Generate a secret with:

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
```

### (a) Plain `docker compose`

```bash
mkdir makekeeper && cd makekeeper
curl -fsSLO https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/docker-compose.prod.yml

cat > .env <<'EOF'
TAG=latest
IMAGE_APP=ghcr.io/makekeeper/app
IMAGE_WEB=ghcr.io/makekeeper/web
PUBLIC_WEB_PORT=8080
POSTGRES_USER=makekeeper
POSTGRES_DB=makekeeper
POSTGRES_PASSWORD=<paste a generated secret>
APP_SECRET=<paste a generated secret>
JWT_SECRET=<paste a generated secret>
# PUBLIC_BASE_URL=https://your.domain
EOF

docker compose -f docker-compose.prod.yml up -d
```

### (b) Portainer (Stacks)

1. **Stacks → Add stack**, name it `makekeeper`.
2. Paste the contents of `docker-compose.prod.yml` into the web editor (or point
   it at this repo path `deploy/docker-compose.prod.yml`).
3. Under **Environment variables**, add: `APP_SECRET`, `JWT_SECRET`,
   `POSTGRES_PASSWORD` (required), and optionally `PUBLIC_WEB_PORT`, `TAG`,
   `IMAGE_APP`, `IMAGE_WEB`, `PUBLIC_BASE_URL`. Add `MK_INSTALL_METHOD=portainer`
   too — the compose file can't know it was deployed through Portainer, and
   without it Settings → Version & Updates reports the method as `compose`.
4. **Deploy the stack.** Point Portainer's proxy (or your own) at the `web`
   service on container port `80`, and keep the domain portless — the container
   port must not appear in the public URL (#208). `PUBLIC_WEB_PORT` (default
   `8080`) is a _host_ port for direct access; a proxy on the same host can use
   it instead, but it too stays out of the domain you publish.

> Portainer has no value generators, so the secrets above are entered by hand. To
> avoid that, run path 1's `install.sh` on the host (it generates them once into a
> `.env`) and let Portainer adopt the resulting stack.

### (c) Coolify

**Recommended — `deploy/coolify/makekeeper.yaml`.** Three steps, one of them
typing your domain; Coolify generates every secret itself.

1. New resource → **Docker Compose Empty**. Paste the contents of
   `deploy/coolify/makekeeper.yaml`. Its magic env vars
   (`SERVICE_PASSWORD_POSTGRES`, `SERVICE_BASE64_64_*`) make Coolify generate
   `POSTGRES_PASSWORD`, `APP_SECRET` and `JWT_SECRET` on first deploy.
2. **Put your domain on the `web` service.** The resource lists its services;
   `web` has a **Domains** field, pre-filled with an address Coolify generated
   (`SERVICE_FQDN_WEB` — the server's wildcard domain, or an `sslip.io` one).
   Replace it with yours: a full FQDN **with the scheme** —
   `https://makekeeper.example.com`, not a bare host. No port suffix: `web`
   listens on 80, and per Coolify's docs a domain carries a port only when the
   container listens elsewhere (#208). Your value is never overwritten — Coolify
   generates only into an empty field.

   **Behind another proxy** that terminates TLS and forwards plain http to
   Coolify (Nginx Proxy Manager, a company edge, a tunnel), enter the domain as
   **`http://your.domain`** — that describes the hop Coolify's Traefik actually
   serves, and `https://` there would make it try to terminate TLS a second
   time. Then set **`PUBLIC_BASE_URL=https://your.domain`** in the environment
   variables so the app's generated links (phone-capture QR, PWA) use the
   public origin rather than the inner `http` one. Full rationale:
   [`docs/tls-public-access.md`](docs/tls-public-access.md).

3. **Deploy** — Coolify generates the Traefik router from that domain and
   requests the certificate from Let's Encrypt.

Two documented traps worth knowing before you debug anything:

- **DNS validation.** Coolify validates the domain against `1.1.1.1`. A domain
  that resolves only on your LAN fails that check — point **Settings → Advanced
  → Custom DNS Servers** at a resolver that knows it.
- **Never add `networks:` to this compose.** Coolify creates one network per
  stack and attaches Traefik to it; a custom network puts containers on two
  networks and Traefik then picks an IP it cannot reach — intermittent hangs and
  504s. The shipped file therefore declares none, and neither should your edits.

The file publishes **no host port** either — Traefik already owns 80/443, and it
carries no hand-written `traefik.*` labels, which belong to Coolify's _Raw
Compose Deployment_ mode only. Rationale for every choice in it, plus the
catalogue-submission checklist:
[`deploy/coolify/README.md`](deploy/coolify/README.md).

**Fallback — plain compose (manual secrets).** Use `docker-compose.prod.yml`
instead and set `APP_SECRET`/`JWT_SECRET`/`POSTGRES_PASSWORD` yourself. That file
has no magic vars, so Coolify assigns no domain by itself: attach one in the
service's **Domains** field, portless, as above. Unlike the Coolify file it also
publishes `web` on a host port (`PUBLIC_WEB_PORT`, default `8080`) for direct
access on the machine itself; the proxy routes to container port 80 regardless.

### (d) Dokploy

**Recommended — base64 import (auto-generates secrets + domain, no hosting).**
Dokploy's value generators (`${password}`, `${domain}`) run when you import a
template blob into a Compose service — the MakeKeeper blob is
`deploy/dokploy/import.base64` (built from `deploy/dokploy/docker-compose.yml` +
`template.toml`).

1. New **Docker Compose** service → **Advanced** → **Import** and paste the
   contents of `deploy/dokploy/import.base64`.
2. Deploy — Dokploy generates `POSTGRES_PASSWORD`, `APP_SECRET`, `JWT_SECRET`,
   assigns the public domain to the `web` service (container port `80`), adds the
   Traefik labels and handles TLS. Nothing to type.

> The blob embeds both files verbatim; after editing either, regenerate it with
> `node deploy/dokploy/gen-import.mjs`.

**Alternative — plain Compose (manual secrets).** Dokploy's Environment tab does
**not** run the generators, so on this path you supply the secrets yourself:

1. New **Docker Compose** service. Provide `docker-compose.prod.yml`.
2. In the **Environment** tab set `APP_SECRET`, `JWT_SECRET`, `POSTGRES_PASSWORD`
   — generate each with `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='`.
3. In the **Domains** tab, attach a domain to the `web` service on container port
   `80`. Leave the domain itself portless (#208).
4. Deploy.

> **One-click from the template gallery** (_Create → Template_) additionally
> requires the blueprint to be served from a Dokploy template **base URL** (a
> static host exposing `meta.json` + `blueprints/<id>/{docker-compose.yml,
template.toml,logo}`) — there is no local-path import there
> ([Dokploy/dokploy#2414](https://github.com/Dokploy/dokploy/issues/2414)). Hosting
> a MakeKeeper base URL, or submitting the blueprint to the official
> [`Dokploy/templates`](https://github.com/Dokploy/templates) gallery, is tracked
> as a follow-up; the base64 route above needs neither.

---

## Optional services

### MCP server (`mcp`)

An optional container that exposes the instance's agent tools to MCP clients
(Claude Desktop, Claude Code, …) at `https://<instance>/plugins/mcp`. Off by
default in every stack:

- **Plain compose / Portainer:** the service sits behind a compose profile —
  `docker compose --profile mcp up -d`.
- **Dokploy / Coolify:** the service ships commented out in the stack file —
  uncomment it (and its volume) and redeploy.

After the container starts, pair it once in **Settings → External plugins**
(pairing code in `docker logs mcp`, or set `MCP_INSTALL_TOKEN` beforehand for
a headless install), then issue per-client `mkt_…` connection tokens on the
same page. Full guide: [`docs/mcp.md`](docs/mcp.md).

### Browser notifications (web push)

Nothing to install and nothing to configure: the signing keys are generated on
first use and stored encrypted with `APP_SECRET`. One condition, though, is the
browser's and cannot be worked around — **push needs a secure context**. Served
over plain `http://` from another machine, the browser removes the API
altogether, and **Settings → General → Notifications → Connect this device**
will say so instead of connecting. Put the instance behind HTTPS (a reverse
proxy with a certificate, or a tunnel) and it works; `http://localhost` counts
as secure, which is why it works in local testing and not on the LAN address.

The in-app inbox — the bell, its badge, reminders and the calendar — does not
depend on any of this and works over plain HTTP.

---

## Environment variables

| Variable                                | Required            | Default                                                            | Purpose                                                                                                                                                                                       |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`                            | **yes** (≥32 chars) | —                                                                  | Encrypts stored secrets at rest + wraps per-user keys. Rotating it invalidates all stored secrets.                                                                                            |
| `JWT_SECRET`                            | **yes** (≥32 chars) | —                                                                  | Signs multiuser JWTs.                                                                                                                                                                         |
| `POSTGRES_PASSWORD`                     | **yes**             | —                                                                  | Bundled Postgres password (used to build `DATABASE_URL`).                                                                                                                                     |
| `PUBLIC_WEB_PORT`                       | no                  | `8080`                                                             | **Host** port the web UI is published on (plain-compose/Portainer path only) — free to be any port. The container always listens on `80`, and that port never appears in a public URL (#208). |
| `TAG`                                   | no                  | `latest`                                                           | Image version. **Pin to a `vX.Y.Z` in production.**                                                                                                                                           |
| `IMAGE_APP` / `IMAGE_WEB` / `IMAGE_MCP` | no                  | `ghcr.io/makekeeper/{app,web}`, `ghcr.io/makekeeper/mk-plugin-mcp` | Image references.                                                                                                                                                                             |
| `MCP_INSTALL_TOKEN`                     | no                  | —                                                                  | One-time install token for a headless install of the optional `mcp` service (see **Optional services**).                                                                                      |
| `MCP_TAG`                               | no                  | `latest`                                                           | Version of the optional `mcp` service — the MCP plugin is a separate product with its own version line, so it is **not** pinned by `TAG`.                                                     |
| `POSTGRES_USER` / `POSTGRES_DB`         | no                  | `makekeeper` / `makekeeper`                                        | Bundled DB identity.                                                                                                                                                                          |
| `PUBLIC_BASE_URL`                       | no                  | derived from `X-Forwarded-*`                                       | Fixed public origin (no trailing slash) for phone-capture QR links. Leave empty behind an ephemeral tunnel.                                                                                   |
| `RUN_SEED`                              | no                  | `0`                                                                | `1` = run the optional demo seed once (the app self-seeds plugin defaults regardless).                                                                                                        |
| `MK_INSTALL_METHOD`                     | no                  | `compose` (prod file)                                              | How this instance was installed — diagnostics only, shown in **Settings → Version & Updates**. See below.                                                                                     |
| `DATABASE_URL`                          | auto                | built from the Postgres vars                                       | Only set manually if you use an **external** database instead of the bundled `db` service.                                                                                                    |

### `MK_INSTALL_METHOD` — declaring the install method

The app cannot detect its surrounding deployment manager from inside the
container (Coolify's and Dokploy's own variables never reach it), so the deploy
artifact declares it. Every shipped artifact already stamps the right value —
`install.sh` writes `install-sh` into the generated `.env`,
`docker-compose.prod.yml` defaults to `compose`, the Coolify and Dokploy compose
files hardcode `coolify` / `dokploy`.

Set it yourself where no shipped artifact stamps it — **Portainer**
(`MK_INSTALL_METHOD=portainer` in the stack's environment variables), a custom
manifest, another manager. Accepted values: `install-sh`, `compose`, `coolify`,
`dokploy`, `portainer`, `kubernetes`, `dev`. Anything else is ignored, and the app falls back
to what it can infer on its own (Kubernetes via `KUBERNETES_SERVICE_HOST`,
container-vs-host via `/.dockerenv`) — reported in the UI as a guess.

It is purely a support/diagnostic hint: nothing behaves differently based on it,
and the value never leaves the instance.

---

## Updating

Schema and code are coupled by image version: **migrations ship inside the app
image**, and the app container runs `prisma migrate deploy` on **every start**.
So updating is just "pull the new image and restart" — migrations apply
automatically, no manual step.

**Before updating, back up** (see below).

- **Path 1:** re-run the installer, or use the update helper:
  ```bash
  cd makekeeper
  curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh | bash -s -- --update
  # or, if you downloaded it:  ./update.sh
  ```
- **Path 2 (compose):**
  ```bash
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml up -d
  ```
- **Portainer / Coolify / Dokploy:** use **Re-pull image** / **Redeploy** on the stack.

**One-click update from the app.** If your manager exposes a deploy webhook, paste
it — and its token, if it uses a bearer header — under **Settings → Version &
Updates → One-click update**. Fill in the URL first: a token or an HTTP method on
its own is rejected, since there would be nothing to call. Coolify's hook is a
`GET` with a bearer token, Dokploy's a `POST` whose URL already carries the token.
Both the URL and the token are stored encrypted and are never shown again — a hook
URL is itself a deploy credential, which is also why removing the hook clears the
stored token with it.

**Where to get the hook.** It lives in your manager's own UI — the app cannot read
it from inside the container, so you copy it once. The same steps are shown in the
app under **Where do I get this hook?**, pre-opened on the detected manager.

- **Coolify** — open the resource you want redeployed and copy its **UUID** (the
  last segment of the page URL), then create a token under **Keys & Tokens → API
  tokens** with the `deploy` permission (shown once). The hook is
  `https://<coolify-host>/api/v1/deploy?uuid=<uuid>&force=false`, method `GET`,
  token in the bearer field.
- **Dokploy** — enable **Auto Deploy** on the application's _General_ tab, then copy
  the **Webhook URL** from its _Deployments_ tab. Method `POST`; the URL already
  carries its token, so leave the bearer field empty.
- **Portainer** — open **Stacks → your stack**, turn on **Create a stack webhook**
  in the _Webhooks_ section and copy the link; enable **Re-pull image** under
  automatic updates so the redeploy actually fetches the new image (Business
  Edition). Method `POST`, no token — the link itself is the secret.
- **Anything else** — any HTTP endpoint that redeploys the instance works: a CI job
  trigger, an Argo CD sync webhook, a Watchtower HTTP trigger or your own script.
  It is called once per press, with no body.

Once a hook is configured, the button calls it: **Update now** while a new version
is pending, **Redeploy** otherwise — the same call, restarting on whatever version
your manager is already set to. It always asks for confirmation and never fires on
its own, and the request goes only to your own manager; nothing is sent to us. The
app cannot discover the hook by itself (see `MK_INSTALL_METHOD` above).

The manual steps for your install method stay on the same screen under **How to
update**. They are folded away while a working hook makes them unnecessary, and
open by default when no hook is configured or the version check can't reach the
release feed — the case where the manual path is the only one you have.

Watch migrations apply:

```bash
docker compose -f docker-compose.prod.yml logs -f app
# → [entrypoint] migrations up to date.
```

For reproducible upgrades, pin `TAG=vX.Y.Z` in `.env` and bump it deliberately
rather than tracking `latest`.

> **Automatic pulls (optional):** tools like Watchtower, or Coolify's auto-deploy
> webhook, can pull new images for you — migrations still run via the entrypoint.

---

## Backup & restore

Two things hold state: the Postgres database and the `uploads` volume.

**Back up:**

```bash
# Database
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U makekeeper makekeeper > backup-$(date +%F).sql

# Uploaded files (attachments, 3D models, imports)
docker run --rm -v makekeeper_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

**Restore:**

```bash
# Database (into a running, empty db)
cat backup-YYYY-MM-DD.sql | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U makekeeper -d makekeeper

# Uploads
docker run --rm -v makekeeper_uploads:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/uploads-YYYY-MM-DD.tgz'
```

> Volume names are prefixed with the compose project name (`makekeeper_…`).
> Confirm with `docker volume ls`.

---

## Rollback

Migrations are **forward-only** — `migrate deploy` never reverts. Rolling the
image back to an older `TAG` **after** a migration has run can break the app
(old code against a newer schema). Safe rollback = restore the pre-update DB
backup **and** set the old `TAG`. This is why you back up before every update.

---

## Troubleshooting

- **`app` exits immediately / restarts.**
  - `APP_SECRET`/`JWT_SECRET` too short (need ≥32 chars) → the backend refuses to
    boot. Regenerate.
  - A migration failed → the entrypoint aborts on purpose (won't run on a broken
    schema). Inspect: `docker compose -f docker-compose.prod.yml logs app`.
- **`web` returns 502.** The `app` isn't ready yet (migrations running) or is
  unhealthy. Wait, then check `logs app`.
- **Port already in use.** Change `PUBLIC_WEB_PORT` in `.env` and `up -d` again.
- **DB not reachable.** The app retries `migrate deploy` while `db` starts; if it
  never recovers, check `logs db` and that the `pgdata` volume isn't corrupted.
- **Health check:** `curl http://localhost:8080/api/health/ready` → `{"status":"ok",…}`.

---

## Rotating `APP_SECRET`

Changing `APP_SECRET` **invalidates every secret encrypted at rest** (provider
API keys, tracking credentials, per-user data keys). Only do it deliberately and
re-enter those secrets afterward. It is not a routine operation.
