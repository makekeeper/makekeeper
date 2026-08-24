# `deploy/` — production deployment artifacts

These files ship the app as containers. **The full install & update guide lives
in [`../INSTALL.md`](../INSTALL.md)** — this folder holds only the artifacts:

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The production stack (db + app + web, plus the optional profile-gated `mcp` service — see [`docs/mcp.md`](../docs/mcp.md)). Used by both install paths. |
| `coolify/makekeeper.yaml` | The Coolify stack: paste into *Docker Compose Empty*, set the domain on `web`, deploy. Auto-generated secrets, catalogue-ready header. See [`coolify/README.md`](coolify/README.md). |
| `dokploy/` | Dokploy blueprint + one-paste `import.base64` install. See [`dokploy/README.md`](dokploy/README.md). |
| `dokploy/docker-compose.yml` | Dokploy-native variant (`dokploy-network` + `expose`, Traefik-routed `web`). |
| `dokploy/template.toml` | Dokploy template config (auto-generates secrets + domain). |
| `dokploy/import.base64` | The two above encoded for Dokploy's Compose → Advanced → **Import** (auto-gen, no hosting). |
| `dokploy/gen-import.mjs` | Regenerates `import.base64` after editing either Dokploy file. |
| `install.sh` | One-line installer / updater (`… \| bash`, `… \| bash -s -- --update`). |
| `update.sh` | Thin update helper (`pull` + `up -d`). |

Quick start:

```bash
curl -fsSL https://raw.githubusercontent.com/makekeeper/makekeeper/main/deploy/install.sh | bash
```

See [`../INSTALL.md`](../INSTALL.md) for path 2 (Portainer/Coolify/Dokploy/compose),
environment variables, updates, backup/restore, and troubleshooting.
