#!/usr/bin/env bash
# .devcontainer/install-codebase-memory.sh
#
# Idempotent bootstrap for the codebase-memory-mcp knowledge-graph server.
#
# WHY THIS EXISTS: only /workspaces is a persistent mount in this devcontainer.
# The whole /home/node tree — the binary (~/.local/bin), the Claude Code MCP
# registration (~/.claude*), the graph DB (~/.cache) — lives in the container's
# ephemeral overlay and is wiped on every "Rebuild Container". This script,
# committed under the persistent workspace and run from postCreateCommand,
# restores the server + UI on each rebuild. On a plain restart the binary is
# still present and the heavy install is skipped.
#
# Safe to run repeatedly: reinstalls only when the binary is missing, then
# re-asserts the MCP registration and settings.

set -uo pipefail  # not -e: failures here must never abort container creation

BIN="$HOME/.local/bin/codebase-memory-mcp"
UI_PORT=9749

log() { echo "[cbm-bootstrap] $*"; }

# 1. Binary + agent config (hooks, skills, MCP entry) via the official installer.
#    --ui pulls the graph-visualization build.
if [ ! -x "$BIN" ]; then
  log "binary missing — installing codebase-memory-mcp (ui variant)…"
  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh \
    | bash -s -- --ui \
    || log "installer reported an error (continuing to config step)"
fi

if [ ! -x "$BIN" ]; then
  log "ERROR: binary still absent after install — skipping the rest of bootstrap"
  exit 0
fi

# 2. Guarantee the Claude Code MCP registration and the UI graph-server args.
#    The installer registers the server WITHOUT the --ui launch args, and its
#    agent auto-detection may not fire this early — so we author the entry
#    directly. ~/.claude/.mcp.json is owned by the installer (safe to write);
#    ~/.claude.json is owned by Claude Code (only patched if the entry exists).
CBM_BIN="$BIN" CBM_PORT="$UI_PORT" node <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = ['--ui=true', `--port=${process.env.CBM_PORT}`];
const entry = { command: process.env.CBM_BIN, args };

const mcpPath = path.join(os.homedir(), '.claude', '.mcp.json');
let mcp = { mcpServers: {} };
try { mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch (_) { /* fresh */ }
mcp.mcpServers = mcp.mcpServers || {};
mcp.mcpServers['codebase-memory-mcp'] = entry;
fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 4) + '\n');

const cjPath = path.join(os.homedir(), '.claude.json');
try {
  const cj = JSON.parse(fs.readFileSync(cjPath, 'utf8'));
  if (cj.mcpServers && cj.mcpServers['codebase-memory-mcp']) {
    cj.mcpServers['codebase-memory-mcp'].args = args;
    fs.writeFileSync(cjPath, JSON.stringify(cj, null, 2) + '\n');
  }
} catch (_) { /* Claude Code recreates this on first run */ }

console.log('[cbm-bootstrap] MCP registration + UI args ensured');
NODE

# 3. Full auto-indexing on MCP session start.
"$BIN" config set auto_index true >/dev/null 2>&1 || true

log "done ($("$BIN" --version 2>/dev/null))"
log "graph UI will be at http://localhost:${UI_PORT} once Claude Code connects"
