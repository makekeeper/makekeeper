# MCP server — connect MCP clients to your instance

MakeKeeper can act as an **MCP server**: an optional container
(`ghcr.io/makekeeper/mk-plugin-mcp`, source in
[`plugins/mk-plugin-mcp`](../plugins/mk-plugin-mcp/README.md)) exposes the
instance's agent tools to MCP clients — Claude Desktop, Claude Code, and any
other client speaking MCP **streamable HTTP** — at:

```
https://<instance>/plugins/mcp
```

The tool surface is a live 1:1 mirror of the capability layer the product's
own assistant uses (§5.7): every plugin's tools appear automatically, with
their English descriptions and parameter schemas, annotated as read-only /
destructive for the client's own approval UX. (Epic #248.)

## 1. Run the container

The deploy stacks ship it as an **optional service**:

- **Plain compose / Portainer** (`deploy/docker-compose.prod.yml`): the `mcp`
  service is gated behind a compose profile — `docker compose --profile mcp
up -d`.
- **Dokploy / Coolify**: the service ships commented out in
  `deploy/dokploy/docker-compose.yml` / `deploy/coolify/makekeeper.yaml` —
  uncomment it (and its volume) and redeploy.
- **An existing stack on a docker host**: one command —
  `./plugins/install.sh mcp` (pulls the published image, joins the app's
  network, prints the pairing code; `--token mki_…` for headless). All paths:
  [`plugins/INSTALL.md`](../plugins/INSTALL.md).
- **An existing / hand-rolled stack**: paste
  [`plugins/mk-plugin-mcp/compose.fragment.yml`](../plugins/mk-plugin-mcp/compose.fragment.yml)
  into your compose file — or run the published image directly, joined to the
  app's network (compose default: `makekeeper_default`):

  ```bash
  docker run -d --name mcp --network makekeeper_default \
    -e MK_CORE_URL=http://app:3000 \
    -e MK_PLUGIN_URL=http://mcp:4410 \
    -v mcp-data:/data \
    ghcr.io/makekeeper/mk-plugin-mcp:latest
  ```

  The container name is load-bearing — it is the hostname in `MK_PLUGIN_URL`,
  which the core calls back on. Pin `:latest` to a version tag in production.

- **Development**: `./examples/run-plugin.sh plugins/mk-plugin-mcp` (builds
  the image from source), or build it yourself:
  `docker build -f plugins/mk-plugin-mcp/Dockerfile -t mk-plugin-mcp .`
  (repo-root context).

Then install it like any external plugin: Settings → External plugins →
"Connect a plugin" and enter the pairing code from `docker logs mcp` — or
provide a one-time install token from the same page before the first start
for a headless install (container env `MK_INSTALL_TOKEN`; the shipped stacks
expose it as the `MCP_INSTALL_TOKEN` variable). Approve the (empty)
permission set; the plugin asks for nothing of its own.

## 2. Issue a connection token

Every MCP client authenticates with a **connection token** (`mkt_…`), issued
in Settings → External plugins → _Connection tokens_. A token:

- acts **as you** — under multiuser it is bound to the issuing user, sees that
  user's data and per-user plugin set, and each user manages only their own
  tokens;
- carries an immutable **access ceiling**, chosen at issuance:

  | Ceiling               | May call                                                                    |
  | --------------------- | --------------------------------------------------------------------------- |
  | `read-only` (default) | READ tools only                                                             |
  | `read-write`          | READ + WRITE tools                                                          |
  | `destructive`         | everything, incl. DESTRUCTIVE tools — issue only for a fully trusted client |

- is shown **once**, never expires, and dies instantly when revoked on the
  same page.

DESTRUCTIVE tool calls are additionally gated **per call**: the MCP server
asks the client to elicit a human confirmation, and refuses (fail-closed) when
the client does not support elicitation.

## 3. Configure the client

Any MCP client that supports streamable HTTP with custom headers:

```jsonc
{
  "url": "https://<instance>/plugins/mcp",
  "headers": { "Authorization": "Bearer mkt_…" },
}
```

Claude Code CLI:

```bash
claude mcp add --transport http makekeeper https://<instance>/plugins/mcp \
  --header "Authorization: Bearer mkt_…"
```

Claude Desktop: the custom-connector UI expects OAuth for remote servers, so
bridge the header-authenticated endpoint with `mcp-remote` in
`claude_desktop_config.json` (Settings → Developer → Edit Config):

```jsonc
{
  "mcpServers": {
    "makekeeper": {
      "command": "npx",
      "args": ["mcp-remote", "https://<instance>/plugins/mcp", "--header", "Authorization: Bearer mkt_…"],
    },
  },
}
```

Tool results may reference MakeKeeper objects with canonical `mk://…` links;
the server's instructions tell the model to render them as named links, and
pasting one into the MakeKeeper UI resolves it to the object.

## 4. Facts worth knowing

- The `/plugins/` URL prefix belongs to the external-plugin public proxy
  (#250); the MCP endpoint needs no port of its own and no extra domain — MCP
  clients enter through the same web origin as browsers.
- Disabling or uninstalling the MCP plugin (or the external-plugins host)
  takes the endpoint down immediately; connection tokens survive and simply
  wait for it to come back.
- v1 non-goals: MCP resources, prompts, sampling, per-token locale (tool
  descriptions are English).
