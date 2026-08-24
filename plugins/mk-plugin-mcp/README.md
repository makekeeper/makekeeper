# mk-plugin-mcp — MakeKeeper as an MCP server

A first-party **external plugin** that exposes the instance's agent tools to
MCP clients (Claude Desktop, Claude Code, …) over the MCP **streamable HTTP**
transport. Part of the product (FSL-licensed, see the repository's
`LICENSE.md`), unlike the Apache-licensed templates in `examples/*`.

## How it works

- The plugin registers with the core like any external plugin and declares its
  whole surface public (`publicPaths: ['']`), so the instance serves the MCP
  endpoint at **`https://<instance>/plugins/mcp`** with no MakeKeeper session.
- The tool surface is a **1:1 live mirror** of the core's external data
  operations: `tools/list` ← `GET /api/external/data/operations`,
  `tools/call` → `POST /api/external/data/invoke`. The plugin knows nothing
  about individual tools — new core plugins appear automatically.
- **Pass-through auth.** The MCP client's `Authorization: Bearer mkt_…` header
  (a _connection token_ issued in Settings → External plugins) is forwarded to
  the core on every call; effective rights are the issuing user's, clamped by
  the token's access ceiling. The container stores no secrets beyond its own
  registration pairing.
- Tool annotations (`readOnlyHint`/`destructiveHint`) derive from the core's
  permission levels; a DESTRUCTIVE call additionally requires a per-call MCP
  elicitation confirmation and fails closed if the client cannot elicit.

## Client setup

```jsonc
// e.g. Claude Desktop / Claude Code MCP config
{
  "url": "https://<instance>/plugins/mcp",
  "headers": { "Authorization": "Bearer mkt_…" },
}
```

## Running

The release CI publishes `ghcr.io/makekeeper/mk-plugin-mcp` alongside
app/web. Every installation path — deploy-stack service, `plugins/install.sh`,
compose fragment, plain `docker run`, from source — is in
[`INSTALL.md`](./INSTALL.md); client configuration and token semantics in
[`docs/mcp.md`](../../docs/mcp.md).

Environment: `MK_CORE_URL`, `MK_PLUGIN_URL`, `PORT` (default 4410),
`MK_STATE_DIR` (default `/data`), plus the usual pairing/install variables of
the external-plugin SDK.

v1 non-goals: MCP resources, prompts, sampling, per-token locale (tool
descriptions resolve to English).
