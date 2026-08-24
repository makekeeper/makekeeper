import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import {
  EXTERNAL_EVENT_SCHEMA_VERSION,
  EXTERNAL_REGISTER_PATH,
  ExternalActionRequest,
  ExternalCallContext,
  ExternalPluginManifest,
  ExternalRenderRequest,
  ExternalResolveRefRequest,
  ExternalToolRequest,
  ExternalWebhookEvent,
  PLUGIN_ACTION_PATH,
  PLUGIN_CAPABILITY_PATH,
  PLUGIN_EXPORT_PATH,
  PLUGIN_HEALTH_PATH,
  PLUGIN_IMPORT_PATH,
  PLUGIN_PURGE_PATH,
  PLUGIN_RENDER_PATH,
  PLUGIN_RESOLVE_REF_PATH,
  PLUGIN_TOOL_PATH,
  UiActionResult,
  UiScreen,
  validateExternalManifest,
} from '@makekeeper/plugin-contract';
import { verifySignedRequest } from './signing';
import { BackgroundTokens, CoreClient } from './core-client';

// The plugin runtime (#139): registration, a signed HTTP server, and typed
// handler slots.
//
// Everything the contract REQUIRES of a plugin is done here by default rather
// than documented: signatures are verified before any handler runs, webhook
// handlers are deduplicated by eventId, and the manifest is validated locally
// so an author sees the error at boot instead of as a rejected registration.

export interface PluginHandlers {
  // Render a screen. Params merge route params and host-supplied context.
  render(input: {
    screen: string;
    params: Record<string, string>;
    // What the user has typed so far, when a `reloadOnChange` field triggered
    // this render. Absent on a first render — treat it as "nothing typed yet"
    // and fall back to stored state.
    form?: Record<string, string | number | boolean>;
    context: ExternalCallContext;
    core: CoreClient;
  }): Promise<UiScreen>;

  // Handle a user action; return a new screen or commands.
  action?(input: {
    screen: string;
    action: string;
    params: Record<string, string | number | boolean>;
    form?: Record<string, string | number | boolean>;
    context: ExternalCallContext;
    core: CoreClient;
  }): Promise<UiActionResult>;

  // A subscribed domain event. Called at most once per eventId (the runtime
  // dedupes), but MUST still be idempotent: the dedupe cache dies with the
  // process, and at-least-once delivery is the contract.
  onEvent?(input: {
    event: ExternalWebhookEvent;
    core: CoreClient;
  }): Promise<void>;

  // An agent tool call. The result is wrapped as untrusted data by the core.
  tool?(input: {
    tool: string;
    args: Record<string, unknown>;
    context: ExternalCallContext;
    core: CoreClient;
  }): Promise<unknown>;

  // Resolve one of the plugin's own entities for an mk:// reference.
  resolveRef?(input: {
    entityType: string;
    entityId: string;
    context: ExternalCallContext;
  }): Promise<{ name: string; breadcrumb?: string[] } | null>;

  // Capability method invoked by another plugin through the core relay.
  capability?(input: {
    capability: string;
    method: string;
    args: unknown[];
    context: ExternalCallContext;
  }): Promise<unknown>;

  // `.mkx` participation: return an opaque, SELF-CONTAINED, self-versioned
  // payload; `importBlob` must refuse an incompatible version gracefully.
  exportBlob?(input: { scopeId: string }): Promise<Uint8Array>;
  importBlob?(input: { blob: Uint8Array }): Promise<void>;

  // Optional self-purge offered at uninstall.
  purge?(): Promise<void>;
}

// A route the PLUGIN owns, not the core: an inbound webhook from whatever
// third-party system the plugin integrates with (a sensor pushing a reading, a
// payment provider, a CI server). The core's HMAC signature does not apply —
// that key is shared with the CORE, and a third party has no way to produce
// it — so authenticating these calls is the plugin's own responsibility, and
// the runtime refuses to guess: it hands over method, path, headers and the
// raw body untouched.
export interface PublicRouteRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export interface PublicRouteResponse {
  status: number;
  body: unknown;
}

export type PublicRouteHandler = (
  req: PublicRouteRequest,
) => Promise<PublicRouteResponse> | PublicRouteResponse;

// A raw route: the node request/response pair handed over untouched, BEFORE
// the body is buffered, matched by path PREFIX. This is the escape hatch for
// surfaces `PublicRouteHandler`'s buffered JSON shape cannot express —
// streaming responses (SSE), custom response headers, non-JSON bodies. The
// handler owns everything: authentication, routing under its prefix, and
// ending the response. `/mk/*` never reaches a raw route, whatever the prefix.
export type RawRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export interface PluginOptions {
  manifest: ExternalPluginManifest;
  handlers: PluginHandlers;
  // Unsigned routes served by this plugin, keyed by path. Anything under
  // `/mk/` is reserved for the core contract and is rejected here, so a plugin
  // cannot accidentally shadow a signed endpoint with an unauthenticated one.
  publicRoutes?: Record<string, PublicRouteHandler>;
  // Unsigned STREAMING routes, keyed by path prefix ('/' claims the whole
  // non-/mk surface). Dispatched before public routes and before any body
  // buffering; same /mk/ reservation.
  rawRoutes?: Record<string, RawRouteHandler>;
  // Defaults read the conventional environment: MK_CORE_URL, MK_INSTALL_TOKEN,
  // MK_PLUGIN_SECRET, MK_PLUGIN_URL, PORT.
  coreUrl?: string;
  installToken?: string;
  pluginSecret?: string;
  baseUrl?: string;
  port?: number;
  // Called when the core issues the plugin secret for the first time — persist
  // it, or the next boot has to be installed again.
  onSecretIssued?(secret: string): void | Promise<void>;
  // Called when the stored secret turns out to be worthless — the core no
  // longer knows this plugin. Clear it from your storage, or every restart
  // repeats the same futile registration.
  onSecretForgotten?(): void | Promise<void>;
  // Where the pairing code is shown when the plugin has no credentials and
  // falls back to discovery (#144). Defaults to a loud console banner, which
  // is exactly where an admin running `docker logs` will look.
  onPairingCode?(code: string): void | Promise<void>;
  // Persistent event dedup (#193). The runtime always dedupes in-process; a
  // plugin whose handler must survive restarts without re-acting plugs its
  // own store here (a table keyed by eventId is enough). Consulted BEFORE the
  // handler; `add` is called after the handler ran without throwing, so a
  // crashed handler is retried by the core rather than remembered as done.
  eventDedup?: {
    has(eventId: string): boolean | Promise<boolean>;
    add(eventId: string): void | Promise<void>;
  };
}

export interface StartedPlugin {
  port: number;
  status: 'pending' | 'active';
  // A client for the plugin's OWN background work (schedulers, jobs). Bind it
  // to a scope with `.forScope(id)` or to the instance surface with
  // `.forInstance()`; credentials refresh themselves on demand.
  core: CoreClient;
  // Force a token refresh — e.g. after the admin approves new grants.
  refreshTokens(): Promise<BackgroundTokens | null>;
  stop(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });

// Discovery mode (#144): announce, show the pairing code, wait to be paired.
//
// The code is generated HERE, by the plugin, and printed to its own log. That
// is the whole point: an admin who can read this log is an admin who controls
// this container, and typing the code is how they say so. The core only ever
// sees its hash.
//
// The loop keeps announcing while nobody has opened the pairing window (#147),
// so the natural order — start the container, then go look for it — works, and
// an admin who opens the window ten minutes later needs no restart.
const PAIRING_POLL_MS = 3_000;
// How long to keep re-announcing while nobody has opened the pairing window.
// Long enough not to chatter, short enough that opening the window feels
// immediate — you start the container, wander to the UI, and it is there.
const ANNOUNCE_RETRY_MS = 20_000;
// How often to try the core again after a refused connection. Long enough not
// to fill a log while a stack boots, short enough that nobody waits for it.
const REGISTER_RETRY_MS = 15_000;
const PAIRING_GIVE_UP_MS = 24 * 60 * 60 * 1000;
// How often the banner is repeated while waiting to be paired.
const CODE_REPRINT_MS = 60_000;

interface AnnounceOutcome {
  accepted: boolean;
  error?: string;
}

const announceOnce = async (
  coreUrl: string,
  baseUrl: string,
  manifest: ExternalPluginManifest,
  announceKey: string,
  pairingCode: string,
): Promise<AnnounceOutcome> => {
  try {
    const res = await fetch(`${coreUrl}/api/external/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest, baseUrl, announceKey, pairingCode }),
    });
    const payload = (await res.json()) as { status?: string; error?: string };
    return payload.error
      ? { accepted: false, error: payload.error }
      : { accepted: true };
  } catch (err: unknown) {
    // The core being unreachable is not different from it saying no: both mean
    // "not yet", and both are worth retrying rather than exiting.
    return {
      accepted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

async function runDiscovery(
  coreUrl: string,
  baseUrl: string,
  manifest: ExternalPluginManifest,
  onPairingCode?: (code: string) => void | Promise<void>,
): Promise<string | null> {
  const announceKey = randomBytes(24).toString('base64url');
  // Four digits, like a device PIN. Brute force is not a threat here: the
  // code is submitted through an ADMIN-ONLY endpoint, so nobody but the admin
  // can try one at all. Its job is to prove that whoever is pairing can read
  // this container's log — and a shorter code is a code people retype
  // correctly.
  //
  // MK_PAIRING_CODE lets whoever STARTS the container choose it instead. That
  // is what makes a launcher possible: it knows the code before the container
  // exists, so it can put it on the admin's screen directly rather than
  // sending them to fish it out of a log. Only digits are accepted, so a
  // careless value cannot turn into a code nobody can type.
  const preset = (process.env['MK_PAIRING_CODE'] ?? '').trim();
  const pairingCode = /^\d{4,8}$/.test(preset)
    ? preset
    : String(randomInt(1000, 9999));

  const deadline = Date.now() + PAIRING_GIVE_UP_MS;
  let announced = false;
  let lastShownAt = 0;
  let lastComplaint = '';

  // Reprinted on a slow cadence rather than once, so `docker logs | tail`
  // always ends with the CURRENT code. A code printed once scrolls away, and a
  // log that still holds an older process's banner is worse than no banner —
  // it is a code that looks right and is not.
  const showCode = async (): Promise<void> => {
    if (Date.now() - lastShownAt < CODE_REPRINT_MS) return;
    lastShownAt = Date.now();
    if (onPairingCode) {
      await onPairingCode(pairingCode);
      return;
    }
    console.log(
      `\n[makekeeper] ==============================\n` +
        `[makekeeper]  PAIRING CODE: ${pairingCode}\n` +
        `[makekeeper]  Enter it in Settings -> External plugins\n` +
        `[makekeeper] ==============================\n`,
    );
  };

  while (Date.now() < deadline) {
    if (!announced) {
      const outcome = await announceOnce(
        coreUrl,
        baseUrl,
        manifest,
        announceKey,
        pairingCode,
      );
      if (outcome.accepted) {
        announced = true;
        await showCode();
      } else {
        // Say it once per distinct reason, not every 20 seconds — a log that
        // repeats itself is a log nobody reads.
        if (outcome.error !== lastComplaint) {
          lastComplaint = outcome.error ?? '';
          console.warn(
            `[makekeeper] waiting to be discovered (${outcome.error}). ` +
              `Open "Connect a plugin" in Settings -> External plugins; ` +
              `this container keeps trying, no restart needed.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_RETRY_MS));
        continue;
      }
    }

    await showCode();
    await new Promise((resolve) => setTimeout(resolve, PAIRING_POLL_MS));
    const claim = await fetch(`${coreUrl}/api/external/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pluginId: manifest.pluginId, announceKey }),
    })
      .then(
        (r) => r.json() as Promise<{ status?: string; pluginSecret?: string }>,
      )
      .catch(() => ({ status: 'waiting' as const }));

    if (claim.status === 'paired' && claim.pluginSecret) {
      console.log('[makekeeper] paired — waiting for permission approval');
      return claim.pluginSecret;
    }
    // The candidate expires with the window; if it is gone, announce again.
    if (claim.status === undefined || claim.status === 'unknown') {
      announced = false;
    }
  }
  console.warn('[makekeeper] gave up waiting to be paired');
  return null;
}

// The delivery-acceptance policy for `/mk/events` (#193), apart from the HTTP
// plumbing because the policy IS contract: an unknown envelope version is
// refused (the non-2xx makes the core retry and finally dead-letter it where
// the admin sees the incompatibility — never a silent half-parse), a known
// eventId is acknowledged without re-running the handler, and an event is
// remembered only AFTER its handler succeeded — a thrown handler must be
// retried by the core, not remembered as done. A missing schemaVersion is a
// pre-versioning core, which by definition still speaks version 1.
export async function acceptEventDelivery(
  event: ExternalWebhookEvent,
  seen: Set<string>,
  onEvent: (() => Promise<void>) | undefined,
  dedup?: PluginOptions['eventDedup'],
): Promise<{ status: number; body: { ok: true } | { error: string } }> {
  if (
    event.schemaVersion !== undefined &&
    event.schemaVersion !== EXTERNAL_EVENT_SCHEMA_VERSION
  ) {
    return { status: 400, body: { error: 'unsupported-schema-version' } };
  }
  if (seen.has(event.eventId)) return { status: 200, body: { ok: true } };
  if (await dedup?.has(event.eventId)) {
    seen.add(event.eventId);
    return { status: 200, body: { ok: true } };
  }
  await onEvent?.();
  seen.add(event.eventId);
  await dedup?.add(event.eventId);
  return { status: 200, body: { ok: true } };
}

export async function startPlugin(
  options: PluginOptions,
): Promise<StartedPlugin> {
  // Validate locally first: the same validator the core runs, so a bad
  // manifest is a boot error with a path, not a remote rejection code.
  const validated = validateExternalManifest(options.manifest);
  if (validated.ok === false) {
    const detail = validated.errors
      .map((e) => `${e.path}: ${e.code}${e.detail ? ` (${e.detail})` : ''}`)
      .join('; ');
    throw new Error(`invalid manifest — ${detail}`);
  }

  const coreUrl = options.coreUrl ?? process.env['MK_CORE_URL'] ?? '';
  const port = options.port ?? Number(process.env['PORT'] ?? 4400);
  const baseUrl =
    options.baseUrl ??
    process.env['MK_PLUGIN_URL'] ??
    `http://localhost:${port}`;
  let secret = options.pluginSecret ?? process.env['MK_PLUGIN_SECRET'] ?? '';
  const installToken =
    options.installToken ?? process.env['MK_INSTALL_TOKEN'] ?? '';

  const seenEvents = new Set<string>();

  // Background credentials, fetched lazily and refreshed when the core rejects
  // them: grants change (consent, update, narrowing) and every change re-mints
  // tokens, so a cached one is expected to expire — that is the design, not a
  // failure mode to work around.
  let background: BackgroundTokens | null = null;
  const refreshTokens = async (): Promise<BackgroundTokens | null> => {
    if (!secret) return null;
    const res = await fetch(`${coreUrl}/api/external/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pluginId: options.manifest.pluginId,
        pluginSecret: secret,
      }),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (typeof payload !== 'object' || payload === null || 'error' in payload) {
      background = null;
      return null;
    }
    background = payload as BackgroundTokens;
    return background;
  };

  // Reserved-prefix check at startup, not per request: a shadowing route is a
  // programming error, and it should fail loudly at boot.
  for (const route of [
    ...Object.keys(options.publicRoutes ?? {}),
    ...Object.keys(options.rawRoutes ?? {}),
  ]) {
    if (route === '/mk' || route.startsWith('/mk/')) {
      throw new Error(
        `public route "${route}" collides with the reserved /mk/ prefix`,
      );
    }
  }

  // Longest-prefix match over the raw routes, with /mk/* categorically
  // excluded so even a '/' prefix cannot shadow the signed contract surface.
  const matchRawRoute = (path: string): RawRouteHandler | undefined => {
    if (path === '/mk' || path.startsWith('/mk/')) return undefined;
    const routes = options.rawRoutes ?? {};
    let best: string | undefined;
    for (const prefix of Object.keys(routes)) {
      const hit =
        prefix === '/' ||
        path === prefix ||
        path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
      if (hit && (best === undefined || prefix.length > best.length)) {
        best = prefix;
      }
    }
    return best === undefined ? undefined : routes[best];
  };

  const server = createServer((req, res) => {
    // Raw routes dispatch before ANY buffering: a streaming body must reach
    // the handler as a stream, and its response leaves as one.
    const rawRoute = matchRawRoute(
      new URL(req.url ?? '/', 'http://plugin.local').pathname,
    );
    if (rawRoute) {
      void Promise.resolve(rawRoute(req, res)).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
      return;
    }
    void (async () => {
      const raw = await readBody(req);
      const send = (code: number, body: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? '/', 'http://plugin.local');
      const path = url.pathname;

      // Plugin-owned routes run BEFORE signature verification — they are not
      // core traffic and could never carry a valid signature.
      const publicRoute = options.publicRoutes?.[path];
      if (publicRoute) {
        try {
          const result = await publicRoute({
            method: req.method ?? 'GET',
            path,
            query: url.searchParams,
            headers: req.headers,
            rawBody: raw,
          });
          return send(result.status, result.body);
        } catch (err: unknown) {
          return send(500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Health answers without a body but still signed: an unauthenticated
      // liveness probe would let anyone map the plugin's presence.
      const verdict = verifySignedRequest({
        // Verify against exactly what the core signed — the raw target
        // including any query string — not the routing pathname. They are
        // identical for today's endpoints; keeping them distinct means a
        // future signed call with a query cannot silently fail to verify.
        method: req.method ?? 'POST',
        path: req.url ?? '',
        headers: req.headers,
        rawBody: raw,
        secret,
      });
      if (verdict.ok === false) {
        return send(401, { error: verdict.reason });
      }

      const body: Record<string, unknown> = raw ? JSON.parse(raw) : {};
      const core = new CoreClient(
        coreUrl,
        () =>
          typeof (body['context'] as ExternalCallContext | undefined)
            ?.delegatedToken === 'string'
            ? ((body['context'] as ExternalCallContext)
                .delegatedToken as string)
            : null,
        () => background,
        () =>
          (body['context'] as ExternalCallContext | undefined)?.scopeId ?? null,
        refreshTokens,
      );

      try {
        switch (path) {
          case PLUGIN_HEALTH_PATH:
            return send(200, { ok: true, version: options.manifest.version });

          case PLUGIN_RENDER_PATH: {
            const input = body as unknown as ExternalRenderRequest;
            const screen = await options.handlers.render({
              screen: input.screen,
              params: input.params ?? {},
              form: input.form,
              context: input.context,
              core,
            });
            return send(200, { screen });
          }

          case PLUGIN_ACTION_PATH: {
            if (!options.handlers.action)
              return send(404, { error: 'no-action-handler' });
            const input = body as unknown as ExternalActionRequest;
            const result = await options.handlers.action({
              screen: input.screen,
              action: input.action,
              params: input.params ?? {},
              form: input.form,
              context: input.context,
              core,
            });
            return send(200, result);
          }

          case '/mk/events': {
            const event = body as unknown as ExternalWebhookEvent;
            // Idempotency by eventId is a CONTRACT rule, so the runtime keeps
            // it rather than trusting each author to remember; the policy
            // itself lives in acceptEventDelivery.
            const handler = options.handlers.onEvent;
            const accepted = await acceptEventDelivery(
              event,
              seenEvents,
              handler ? () => handler({ event, core }) : undefined,
              options.eventDedup,
            );
            return send(accepted.status, accepted.body);
          }

          case PLUGIN_TOOL_PATH: {
            if (!options.handlers.tool)
              return send(404, { error: 'no-tool-handler' });
            const input = body as unknown as ExternalToolRequest;
            const result = await options.handlers.tool({
              tool: input.tool,
              args: input.args ?? {},
              context: input.context,
              core,
            });
            return send(200, { result });
          }

          case PLUGIN_RESOLVE_REF_PATH: {
            if (!options.handlers.resolveRef)
              return send(404, { error: 'no-ref-handler' });
            const input = body as unknown as ExternalResolveRefRequest;
            const resolved = await options.handlers.resolveRef(input);
            return resolved
              ? send(200, resolved)
              : send(404, { error: 'not-found' });
          }

          case PLUGIN_CAPABILITY_PATH: {
            if (!options.handlers.capability)
              return send(404, { error: 'no-capability-handler' });
            const result = await options.handlers.capability({
              capability: String(body['capability'] ?? ''),
              method: String(body['method'] ?? ''),
              args: Array.isArray(body['args']) ? body['args'] : [],
              context: body['context'] as ExternalCallContext,
            });
            return send(200, { result });
          }

          case PLUGIN_EXPORT_PATH: {
            if (!options.handlers.exportBlob)
              return send(404, { error: 'no-export-handler' });
            const blob = await options.handlers.exportBlob({
              scopeId: String(body['scopeId'] ?? ''),
            });
            return send(200, { blob: Buffer.from(blob).toString('base64') });
          }

          case PLUGIN_IMPORT_PATH: {
            if (!options.handlers.importBlob)
              return send(404, { error: 'no-import-handler' });
            await options.handlers.importBlob({
              blob: Buffer.from(String(body['blob'] ?? ''), 'base64'),
            });
            return send(200, { ok: true });
          }

          case PLUGIN_PURGE_PATH: {
            if (!options.handlers.purge)
              return send(404, { error: 'no-purge-handler' });
            await options.handlers.purge();
            return send(200, { ok: true });
          }

          default:
            return send(404, { error: 'unknown-path' });
        }
      } catch (err: unknown) {
        return send(500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  // Three ways in, tried in order of decreasing certainty:
  //   1. a stored SECRET   — an installed plugin re-announcing;
  //   2. an INSTALL TOKEN  — the headless path (Ansible, prebuilt stacks);
  //   3. DISCOVERY         — no credentials at all: announce and wait to be
  //                          paired by an admin who reads the code below.
  if (!secret && !installToken) {
    // Deliberately NOT awaited. Pairing waits on a human, and a plugin's own
    // work — a printer connection, a scheduler, an inbound webhook — must not
    // wait with it: the container is useful the moment it starts, and the
    // admin may reach the UI minutes later. The secret is assigned when it
    // arrives, and the request verifier reads it live.
    void runDiscovery(
      coreUrl,
      baseUrl,
      options.manifest,
      options.onPairingCode,
    ).then(async (paired) => {
      if (!paired) return;
      secret = paired;
      await options.onSecretIssued?.(paired);
      await refreshTokens();
    });
  }

  // Discovery ran and nobody paired us: stay up and serve nothing rather than
  // exiting. The admin may open the pairing window in a minute, and a
  // container that killed itself would need another restart to be found.
  if (!secret && !installToken) {
    return {
      port,
      status: 'pending',
      core: new CoreClient(
        coreUrl,
        () => null,
        () => background,
        () => undefined,
        refreshTokens,
      ),
      refreshTokens,
      stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  const pendingHandle = (): StartedPlugin => ({
    port,
    status: 'pending',
    core: new CoreClient(
      coreUrl,
      () => null,
      () => background,
      () => undefined,
      refreshTokens,
    ),
    refreshTokens,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });

  // Register (or re-announce). A plugin that already holds a secret presents
  // it; only a first install needs the one-time token.
  //
  // The core being unreachable is a NORMAL state, not a failure: containers
  // start in whatever order the stack decides, the core restarts for updates,
  // and a plugin is expected to outlive both. So this retries in the
  // background and the container keeps serving meanwhile — it used to throw
  // out of startPlugin on a refused connection, which killed the container and
  // left an admin reading a stack trace to learn that the core was not up yet.
  const registerOnce = async (): Promise<
    | {
        outcome: 'registered';
        status: 'pending' | 'active';
        pluginSecret?: string;
      }
    | { outcome: 'rejected'; error: string }
    | { outcome: 'unreachable'; detail: string }
  > => {
    try {
      const res = await fetch(`${coreUrl}${EXTERNAL_REGISTER_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          secret
            ? { pluginSecret: secret, baseUrl, manifest: options.manifest }
            : { installToken, baseUrl, manifest: options.manifest },
        ),
      });
      const payload: unknown = await res.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload
      ) {
        return {
          outcome: 'rejected',
          error: String((payload as { error: string }).error),
        };
      }
      return {
        outcome: 'registered',
        ...(payload as { status: 'pending' | 'active'; pluginSecret?: string }),
      };
    } catch (err: unknown) {
      return {
        outcome: 'unreachable',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // A rejection is about THIS plugin (an unknown secret, a spent token) and is
  // handled once; an unreachable core is about the world and is retried.
  const applyRejection = async (error: string): Promise<void> => {
    // A stored secret the core does not recognise means we were uninstalled
    // while this container kept its volume — a very ordinary state after an
    // admin removes a plugin, or after a core is restored from a backup. The
    // right answer is to forget the secret and ask to be discovered again;
    // exiting here left a dead container whose only clue was a log nobody was
    // watching.
    if (error === 'unknown-plugin' || error === 'bad-secret') {
      console.warn(
        `[makekeeper] the core does not recognise this plugin (${error}) — ` +
          `forgetting the stored secret and asking to be discovered again.`,
      );
      secret = '';
      await options.onSecretForgotten?.();
      void runDiscovery(
        coreUrl,
        baseUrl,
        options.manifest,
        options.onPairingCode,
      ).then(async (paired) => {
        if (!paired) return;
        secret = paired;
        await options.onSecretIssued?.(paired);
        await refreshTokens();
      });
      return;
    }
    // Anything else (a taken id, a spent install token) is a real
    // configuration problem, but still not a reason to die: the container
    // stays up saying what is wrong, where an admin can read it at leisure.
    console.error(`[makekeeper] registration failed: ${error}`);
  };

  const adoptRegistration = async (registered: {
    status: 'pending' | 'active';
    pluginSecret?: string;
  }): Promise<void> => {
    if (registered.pluginSecret) {
      secret = registered.pluginSecret;
      await options.onSecretIssued?.(secret);
    }
    // Only an approved plugin has grants to mint tokens from; a pending one
    // simply has none yet, and asking again later is the normal path.
    if (registered.status === 'active') await refreshTokens();
  };

  const first = await registerOnce();

  if (first.outcome === 'unreachable') {
    console.warn(
      `[makekeeper] the core at ${coreUrl} is not reachable (${first.detail}) — ` +
        `serving anyway and retrying every ${REGISTER_RETRY_MS / 1000}s.`,
    );
    const retry = setInterval(() => {
      void (async () => {
        const attempt = await registerOnce();
        if (attempt.outcome === 'unreachable') return;
        clearInterval(retry);
        if (attempt.outcome === 'rejected') {
          await applyRejection(attempt.error);
          return;
        }
        console.log(
          `[makekeeper] the core is back — registered as ${attempt.status}.`,
        );
        await adoptRegistration(attempt);
      })();
    }, REGISTER_RETRY_MS);
    // Nothing keeps the process alive on this timer alone; the server does.
    retry.unref?.();
    return pendingHandle();
  }

  if (first.outcome === 'rejected') {
    await applyRejection(first.error);
    return pendingHandle();
  }

  await adoptRegistration(first);

  return {
    port,
    status: first.status,
    core: new CoreClient(
      coreUrl,
      () => null,
      () => background,
      () => undefined,
      refreshTokens,
    ),
    refreshTokens,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
