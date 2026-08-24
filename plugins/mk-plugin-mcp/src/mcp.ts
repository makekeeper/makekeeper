// The MCP face (#251): a streamable-HTTP MCP server whose tool surface is a
// LIVE 1:1 mirror of the core's external data operations. This file knows no
// individual tool — `tools/list` asks the core on every call (new plugins
// appear with no change here), `tools/call` relays to `data/invoke`, and the
// caller's Authorization header is the only credential in play.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  CoreApiError,
  invokeOperation,
  listOperations,
  type CoreOperation,
} from './core-api.ts';

import { manifest } from './manifest.ts';

// Operator/model-facing strings are plain English by design: this plugin is
// standalone third-party-style code (§5.11), and per-token locale is a v1
// non-goal of the epic — the core resolves tool descriptions to `en` too.
const SERVER_INFO = { name: 'makekeeper-mcp', version: manifest.version };

const INSTRUCTIONS = [
  'This server exposes the tools of a MakeKeeper instance. Tool results may',
  'reference MakeKeeper objects by canonical `mk://<plugin>/<type>/<id>`',
  'links. When you mention such an object to the user, render its NAME as a',
  'Markdown link with the mk:// URI as the target — the MakeKeeper UI',
  'resolves it to an in-app link. Never print a bare mk:// URI.',
].join(' ');

// SSE comments every 25s keep intermediaries (nginx's 600s read timeout, LB
// idle timeouts) from reaping a quiet stream. A comment line is legal between
// any two SSE events and invisible to the client.
const KEEPALIVE_MS = 25_000;

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

// The Authorization header of the HTTP request that DELIVERED the current
// JSON-RPC message — sessions are shared plumbing, credentials are not, so
// this is read per message, never cached on the session.
export const authOf = (extra: {
  requestInfo?: { headers: Record<string, string | string[] | undefined> };
}): string | undefined =>
  firstHeader(extra.requestInfo?.headers['authorization']);

export const toMcpTool = (
  op: CoreOperation,
): {
  name: string;
  description: string;
  inputSchema: CoreOperation['resolvedParameters'];
  annotations: Record<string, boolean>;
} => ({
  name: op.name,
  description: op.description,
  inputSchema: op.resolvedParameters,
  annotations: {
    readOnlyHint: op.permission === 'READ',
    destructiveHint: op.permission === 'DESTRUCTIVE',
    // Every tool acts on this one instance's data, never the open web.
    openWorldHint: false,
  },
});

const buildServer = (): Server => {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });

  server.setRequestHandler(ListToolsRequestSchema, async (_req, extra) => {
    const authorization = authOf(extra);
    if (!authorization) throw new Error('missing Authorization header');
    const operations = await listOperations(authorization);
    return { tools: operations.map(toMcpTool) };
  });

  // The per-call human gate on DESTRUCTIVE tools (#252). Fail-closed by
  // design: no elicitation capability on the client means no deletion, ever —
  // the ceiling and the grant say the CALLER may delete; only the human at
  // the client says THIS call does.
  const confirmDestructive = async (
    name: string,
    args: Record<string, unknown>,
    relatedRequestId: string | number,
  ): Promise<{ confirmed: true } | { confirmed: false; refusal: string }> => {
    if (!server.getClientCapabilities()?.elicitation) {
      return {
        confirmed: false,
        refusal:
          `"${name}" is a DESTRUCTIVE operation and requires a per-call user ` +
          'confirmation, but this MCP client does not support elicitation. ' +
          'The call was refused (fail-closed).',
      };
    }
    const result = await server.elicitInput(
      {
        message:
          `Approve DESTRUCTIVE MakeKeeper operation "${name}"? ` +
          `Arguments: ${JSON.stringify(args)}. This permanently deletes data.`,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              title: 'Delete',
              description: 'Approve this destructive operation',
            },
          },
          required: ['confirm'],
        },
      },
      { relatedRequestId },
    );
    return result.action === 'accept' && result.content?.['confirm'] === true
      ? { confirmed: true }
      : {
          confirmed: false,
          refusal: `The user did not approve the destructive operation "${name}".`,
        };
  };

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const authorization = authOf(extra);
    if (!authorization) throw new Error('missing Authorization header');
    const args = req.params.arguments ?? {};
    try {
      // The mirror carries no per-tool knowledge, so the permission level is
      // asked of the core at call time — one extra local round-trip, and only
      // the answer decides whether the human gate applies.
      const operations = await listOperations(authorization);
      const operation = operations.find((op) => op.name === req.params.name);
      if (operation?.permission === 'DESTRUCTIVE') {
        const gate = await confirmDestructive(
          req.params.name,
          args,
          extra.requestId,
        );
        if (gate.confirmed === false) {
          return {
            content: [{ type: 'text' as const, text: gate.refusal }],
            isError: true,
          };
        }
      }
      const result = await invokeOperation(
        authorization,
        req.params.name,
        args,
      );
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err: unknown) {
      // A core refusal (403 ceiling, 400 handler error) is a TOOL failure the
      // model should see and reason about, not a protocol error.
      if (err instanceof CoreApiError) {
        return {
          content: [{ type: 'text' as const, text: err.message }],
          isError: true,
        };
      }
      throw err;
    }
  });

  return server;
};

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
}

// One MCP server per session, addressed by the SDK's `mcp-session-id`
// header. The map is the plugin's only per-client state and dies with the
// process — clients re-initialize on reconnect, per the MCP spec. Because the
// endpoint is public, the map is bounded two ways: a hard cap with
// least-recently-used eviction, and an idle sweep — an abandoned session must
// not hold memory forever.
const sessions = new Map<string, Session>();
const MAX_SESSIONS = 128;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const closeSession = (id: string): void => {
  const session = sessions.get(id);
  sessions.delete(id);
  void session?.transport.close();
};

const evictForNewSession = (): void => {
  if (sessions.size < MAX_SESSIONS) return;
  let oldest: string | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;
  for (const [id, session] of sessions) {
    if (session.lastSeenAt < oldestSeen) {
      oldestSeen = session.lastSeenAt;
      oldest = id;
    }
  }
  if (oldest !== undefined) closeSession(oldest);
};

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeenAt < cutoff) closeSession(id);
  }
}, SWEEP_INTERVAL_MS).unref();

const startKeepalive = (res: ServerResponse): void => {
  const timer = setInterval(() => {
    const contentType = String(res.getHeader('content-type') ?? '');
    if (
      res.headersSent &&
      !res.writableEnded &&
      contentType.includes('text/event-stream')
    ) {
      res.write(': keepalive\n\n');
    }
  }, KEEPALIVE_MS);
  res.on('close', () => clearInterval(timer));
};

// The raw route handler: every non-/mk request of the plugin lands here (the
// manifest declares publicPaths: ['']), already stripped of the instance's
// /plugins/mcp prefix by the core's proxy.
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rpcError = (status: number, message: string): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message },
        id: null,
      }),
    );
  };

  // Refuse unauthenticated requests up front: the config error surfaces as a
  // clean 401 instead of an empty tool list.
  const authorization = firstHeader(req.headers['authorization']);
  if (!authorization) {
    rpcError(401, 'missing Authorization: Bearer mkt_… header');
    return;
  }

  // Proxies buffer SSE into silence unless told not to; nginx honours this
  // per-response header even with buffering globally on.
  res.setHeader('X-Accel-Buffering', 'no');
  startKeepalive(res);

  const sessionId = firstHeader(req.headers['mcp-session-id']);
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      rpcError(404, 'unknown session');
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res);
    return;
  }

  // No session header: only an initialize POST may open one. Verify the token
  // against the core FIRST — a public endpoint must not hand sessions to
  // whoever sends a header-shaped string, and a bad token should fail at
  // connect time, not on the first tools call.
  try {
    await listOperations(authorization);
  } catch (err: unknown) {
    if (
      err instanceof CoreApiError &&
      (err.status === 401 || err.status === 403)
    ) {
      rpcError(401, err.message);
      return;
    }
    rpcError(502, 'the MakeKeeper core is unreachable');
    return;
  }

  evictForNewSession();
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport, lastSeenAt: Date.now() });
    },
  });
  transport.onclose = (): void => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await server.connect(transport);
  await transport.handleRequest(req, res);
  // The transport itself rejects a session-less non-initialize POST with a
  // proper JSON-RPC error, so nothing else needs guarding here.
}
