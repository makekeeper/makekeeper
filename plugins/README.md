# First-party external plugins

Out-of-process plugins that ship **as part of the MakeKeeper product**: each
runs as its own container next to the core, talks to it over the external
plugin contract, and is published as a prebuilt image
`ghcr.io/makekeeper/mk-plugin-<id>` by the release CI.

How this directory differs from [`examples/`](../examples/README.md):

|              | `plugins/*`                                                  | `examples/*`                    |
| ------------ | ------------------------------------------------------------ | ------------------------------- |
| Role         | Product features                                             | Templates authors copy          |
| License      | **FSL** (root `LICENSE.md`)                                  | Apache-2.0                      |
| Distribution | Prebuilt ghcr images, optional services in the deploy stacks | Built from source               |
| Dependencies | Own pinned npm deps allowed                                  | None (SDK via monorepo aliases) |

Both are written in the standalone third-party style (root `CLAUDE.md` §5.11)
and import only the Apache SDK libs (`plugin-sdk`, `plugin-contract`).

## Plugins

| Plugin                               | What it does                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**mk-plugin-mcp**](./mk-plugin-mcp) | MCP server: exposes the instance's agent tools to MCP clients (Claude Desktop, Claude Code, …) at `https://<instance>/plugins/mcp`. Guide: [`docs/mcp.md`](../docs/mcp.md). |

## Versioning & releases

Each plugin here is a **separate product with its own version line** — a
product release (`vX.Y.Z`) never rebuilds plugin images, and a plugin release
never touches `app`/`web`. To release one:

```bash
git tag mk-plugin-mcp/v0.2.0 && git push origin mk-plugin-mcp/v0.2.0
```

The tag triggers the plugin-release pipeline, which publishes
`ghcr.io/makekeeper/mk-plugin-<id>:{X.Y.Z, X.Y, latest}` and bakes the version
into the image (`MK_PLUGIN_VERSION` → the manifest version the core displays).
Bump the plugin's `package.json`/source version in the same commit the tag
points at. In the deploy stacks the plugin's version is pinned by its own
variable (`MCP_TAG`), independent of the product `TAG`.

## Installing

See [`INSTALL.md`](./INSTALL.md) for every path (deploy-stack service, compose
fragment, `install.sh`, plain `docker run`); each plugin directory carries its
own `INSTALL.md` with the concrete values. For development, the examples
launcher builds and runs any of these from source:

```bash
./examples/run-plugin.sh plugins/mk-plugin-mcp
```
