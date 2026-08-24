# `deploy/dokploy/` — Dokploy blueprint

The MakeKeeper stack packaged for [Dokploy](https://dokploy.com). Full context and
the alternative (manual) path are in [`../../INSTALL.md`](../../INSTALL.md) §(d).

| File | Purpose |
|---|---|
| `docker-compose.yml` | Dokploy-native stack: `web` on the external `dokploy-network` via `expose` (no host port), `db`/`app` on a private network. |
| `template.toml` | Template config — Dokploy's `${password}` / `${domain}` generators for the secrets + public domain. |
| `import.base64` | The two files above encoded for Dokploy's **Import** field. |
| `gen-import.mjs` | Regenerates `import.base64` from the two files. |

## Install (recommended — auto-generated secrets + domain, no hosting)

Dokploy runs the `template.toml` generators when you **import** the blueprint into
a Compose service, so nothing is typed by hand:

1. In Dokploy: **Create → Compose** (Docker Compose service).
2. Open the service's **Advanced → Import** section and paste the entire contents
   of [`import.base64`](import.base64).
3. **Deploy.** On first deploy Dokploy:
   - generates `POSTGRES_PASSWORD`, `APP_SECRET` and `JWT_SECRET`;
   - assigns a public domain to the `web` service (container port `80`);
   - adds the Traefik labels and terminates TLS.

The `app` entrypoint then runs `prisma migrate deploy` and boots. Open the assigned
domain — the SPA loads and `/api/health` returns `200`.

> **Copy tip:** `import.base64` is one long line. Copy the whole file (e.g.
> `cat deploy/dokploy/import.base64 | pbcopy` / `… | xclip -selection clipboard`),
> don't retype it.

## Updating the blueprint

`import.base64` embeds `docker-compose.yml` and `template.toml` verbatim. After
editing either, regenerate it:

```bash
node deploy/dokploy/gen-import.mjs
```

## Notes

- **No manual-secret path?** Use the plain-Compose alternative in
  [`../../INSTALL.md`](../../INSTALL.md) §(d) (the Environment tab does **not** run
  the generators).
- **One-click from the template gallery** (*Create → Template*) needs the blueprint
  served from a template base URL — tracked separately, see issue #92.
