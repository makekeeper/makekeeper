# Installing a first-party external plugin

Every plugin here is published as a prebuilt image
`ghcr.io/makekeeper/mk-plugin-<id>` (built by the release CI alongside
`app`/`web`, same version tags). A plugin container needs exactly three
things: to reach the core (`MK_CORE_URL`), to be reachable back
(`MK_PLUGIN_URL`), and a volume for its own state. Pick whichever path fits
your setup — they all end at the same place.

## 1. The deploy stacks (recommended)

The shipped stacks already carry the services:

- **Plain compose / Portainer** (`deploy/docker-compose.prod.yml`): services
  are gated behind a profile — e.g. `docker compose --profile mcp up -d`.
- **Dokploy / Coolify**: the service blocks ship commented out in
  `deploy/dokploy/docker-compose.yml` / `deploy/coolify/makekeeper.yaml` —
  uncomment the service and its volume, then redeploy.

## 2. install.sh (an existing docker host)

For a stack already running on the same host:

```bash
./plugins/install.sh mcp                      # pulls the image and starts it
./plugins/install.sh mcp --token mki_…        # headless: one-time install token
./plugins/install.sh mcp --tag 0.5.0          # pin a version (default: latest)
```

The script puts the container on the app's compose network
(`makekeeper_default`), creating that network if nothing else has, reads the
plugin's port from the image, passes a pairing code it
prints for you, stores state in a named volume `<id>-data`, and restarts with
the daemon. `--network`, `--core`, `--name`, `--port` override the defaults.

## 3. Compose fragment

Each plugin directory publishes a `compose.fragment.yml` to paste into your
own compose file (e.g.
[`mk-plugin-mcp/compose.fragment.yml`](./mk-plugin-mcp/compose.fragment.yml)).

## 4. Plain `docker run`

```bash
docker run -d --name <id> --network makekeeper_default \
  -e MK_CORE_URL=http://app:3000 \
  -e MK_PLUGIN_URL=http://<id>:<port> \
  -v <id>-data:/data \
  --restart unless-stopped \
  ghcr.io/makekeeper/mk-plugin-<id>:latest
```

The container name is load-bearing: it is the hostname in `MK_PLUGIN_URL` the
core calls back on.

## After the container starts — pairing

Install it like any external plugin: **Settings → External plugins →
"Connect a plugin"**, then enter the pairing code (printed by `install.sh`, or
visible in `docker logs <id>`) and approve the requested permissions. For a
headless install, provide a one-time install token from the same page as the
container env `MK_INSTALL_TOKEN` before the first start — no pairing round
then. The pairing survives restarts via the data volume; removing the volume
means pairing again.

For development — building any of these from source — use the examples
launcher: `./examples/run-plugin.sh plugins/<dir>`.
