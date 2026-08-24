// mk-plugin-mcp — MakeKeeper as an MCP server (#248/#251).
//
// A first-party EXTERNAL plugin: it registers with the core like any
// third-party container, declares its whole surface public
// (`publicPaths: ['']`), and serves the MCP streamable-HTTP protocol on it.
// MCP clients connect to `https://<instance>/plugins/mcp` with
// `Authorization: Bearer mkt_…` (a connection token issued in Settings →
// External plugins); the token travels through to the core on every call, so
// this container stores no secrets beyond its own registration pairing.
//
// Wiring only. See mcp.ts (protocol + 1:1 tool mirror), core-api.ts
// (pass-through client), manifest.ts.

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { loadState, saveState } from './state.ts';
import { handleMcpRequest } from './mcp.ts';

const state = await loadState();

await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  onSecretForgotten: async () => {
    delete state.secret;
    await saveState(state);
  },
  handlers: {
    // The manifest declares no screens, so the core never renders this — the
    // handler exists because rendering is the one mandatory contract surface.
    render: async () => ({ title: { key: 'mcp.name' }, children: [] }),
  },
  rawRoutes: {
    // The whole non-/mk surface IS the MCP endpoint.
    '/': handleMcpRequest,
  },
});

console.log('mk-plugin-mcp: MCP endpoint ready at /plugins/mcp (via the core)');
