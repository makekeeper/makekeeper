# Agent rules for plugins/mk-plugin-mcp

First-party **external plugin**, built in the standalone third-party style
(root `CLAUDE.md` §5.11): plain Node process, no NestJS, no app i18n runtime.
Inside this directory these rules govern; `AGENTS.md` is the identical mirror
for other agents.

- **License: FSL** (root `LICENSE.md`) — this is product, not SDK. It still
  imports only `@makekeeper/plugin-sdk` / `@makekeeper/plugin-contract`
  (Apache) plus its own pinned npm dependencies; never `apps/*`, `backend-core`
  or another plugin.
- `console.*` and raw `process.env` reads are allowed here (§5.11). Operator
  and model-facing strings (MCP `instructions`, elicitation texts, log lines)
  are plain **English** — per-token locale is a v1 non-goal (#248). Strings
  travelling through the contract to the core (manifest `nameKey`, screen
  titles) are still i18n keys resolved from the manifest bundle.
- Strict TS otherwise: no `any`, no naked `as`; dependencies exact-pinned and
  at least a week old (§5.6) — `@modelcontextprotocol/sdk` included.
- The plugin must stay a **pure pass-through**: no per-tool knowledge, no
  stored caller credentials. The `Authorization` header of the incoming MCP
  request is the only credential and is forwarded verbatim to the core.
- `docker build -f plugins/mk-plugin-mcp/Dockerfile .` (repo-root context);
  dev runs via `./examples/run-plugin.sh plugins/mk-plugin-mcp`.
