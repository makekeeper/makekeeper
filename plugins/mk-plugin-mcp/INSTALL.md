# Installing mk-plugin-mcp

Published image: **`ghcr.io/makekeeper/mk-plugin-mcp`** (built by the release
CI, same version tags as `app`/`web`). Container facts: listens on `4410`,
state in `/data`, env `MK_CORE_URL` / `MK_PLUGIN_URL` / optional
`MK_INSTALL_TOKEN`. The endpoint MCP clients connect to is served by the
instance itself at `https://<instance>/plugins/mcp` — the container needs no
published port and no domain of its own.

Any of the standard paths (details: [`../INSTALL.md`](../INSTALL.md)):

1. **Deploy stacks.** Plain compose / Portainer:
   `docker compose --profile mcp up -d` (the service ships profile-gated in
   `deploy/docker-compose.prod.yml`; set `MCP_INSTALL_TOKEN` for a headless
   install). Dokploy / Coolify: uncomment the `mcp` service and its volume in
   the stack file, redeploy.

2. **install.sh** on the docker host of an existing stack:

   ```bash
   ./plugins/install.sh mcp                # pairing code printed
   ./plugins/install.sh mcp --token mki_…  # headless
   ```

3. **Compose fragment**: paste
   [`compose.fragment.yml`](./compose.fragment.yml) into your own stack.

4. **Plain docker run**:

   ```bash
   docker run -d --name mcp --network makekeeper_default \
     -e MK_CORE_URL=http://app:3000 \
     -e MK_PLUGIN_URL=http://mcp:4410 \
     -v mcp-data:/data \
     --restart unless-stopped \
     ghcr.io/makekeeper/mk-plugin-mcp:latest
   ```

5. **From source** (development):
   `./examples/run-plugin.sh plugins/mk-plugin-mcp`, or
   `docker build -f plugins/mk-plugin-mcp/Dockerfile -t mk-plugin-mcp .`
   (repo-root context).

Then pair it in **Settings → External plugins** (code in `docker logs mcp`
unless an install token was provided), approve the empty permission set, and
issue per-client `mkt_…` connection tokens on the same page. Client
configuration and token-ceiling semantics: [`docs/mcp.md`](../../docs/mcp.md).
