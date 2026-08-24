import { Injectable, Logger } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PluginConfigService, getErrorMessage } from '@makekeeper/backend-core';
import { publicPathCovers } from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { externalManifest } from '../manifest';

// The public-path proxy of the external-plugins host (#250).
//
// Web-facing URL:      /plugins/<pluginId>/<subpath>
// Canonical namespace: /api/external/pub/<pluginId>/<subpath>
//
// nginx owns the face: an `auth_request` sub-request asks THIS service where
// a plugin id goes (cached ~30s), then streams the original request directly
// to the plugin container. When the container is not reachable from the web
// container — a dev plugin on the host's loopback — the answer is the literal
// `pipe`, and nginx re-targets the request at the canonical namespace, where
// `createExternalPubPipe` streams it through the core as a raw byte pipe: no
// body parsing, no deserialization, both directions streamed.

export type PubResolution =
  | { ok: true; mode: 'direct' | 'pipe'; target: string }
  | { ok: false };

// Loopback base URLs are unreachable from the web container in a compose
// stack (its "localhost" is itself), so those plugins are served through the
// core, which registered them and therefore CAN reach them.
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '::1' ||
  hostname === '[::1]' ||
  hostname.startsWith('127.');

// One subpath grammar for both entry points: `<pluginId>[/<rest>][?query]`.
const PUB_URI_RE =
  /^(?:\/plugins|\/api\/external\/pub)\/([a-z][a-z0-9-]{1,31})(\/[^?]*)?(\?.*)?$/;

@Injectable()
export class ExternalPubService {
  private readonly logger = new Logger(ExternalPubService.name);

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly pluginConfig: PluginConfigService,
  ) {}

  // Resolves a full request URI (either face) to a proxy decision.
  async resolveUri(uri: string): Promise<PubResolution> {
    const match = uri.match(PUB_URI_RE);
    if (!match) return { ok: false };
    const subpath = (match[2] ?? '/').replace(/^\/+/, '');
    return this.resolve(match[1], subpath, match[3] ?? '');
  }

  async resolve(
    pluginId: string,
    subpath: string,
    query: string,
  ): Promise<PubResolution> {
    // The host plugin off means the whole surface is off — the middleware
    // runs before the guard chain, so PluginEnabledGuard cannot cover it.
    if (!this.pluginConfig.isEnabled(externalManifest.id)) return { ok: false };
    // The signed /mk/* surface is never public, even under a declared ''.
    if (subpath === 'mk' || subpath.startsWith('mk/')) return { ok: false };
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return { ok: false };
    if (!publicPathCovers(plugin.manifest.publicPaths ?? [], subpath)) {
      return { ok: false };
    }
    let base: URL;
    try {
      base = new URL(plugin.baseUrl);
    } catch {
      return { ok: false };
    }
    const root = plugin.baseUrl.replace(/\/+$/, '');
    return {
      ok: true,
      mode: isLoopbackHost(base.hostname) ? 'pipe' : 'direct',
      target: `${root}/${subpath}${query}`,
    };
  }
}

// Hop-by-hop headers must not be forwarded in either direction (RFC 9110
// §7.6.1); node manages framing itself.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const PIPE_TIMEOUT_MS = 600_000;

// Raw byte pipe for the canonical namespace. Mounted in main.ts BEFORE the
// body parsers and outside the Nest router: a matched request is fully
// handled here (never `next()`d), so nothing downstream ever parses its body
// — no deserialization means no parse-DoS surface, and SSE/streaming bodies
// flow both ways untouched. Size is capped by nginx's client_max_body_size.
export function createExternalPubPipe(
  pub: ExternalPubService,
  logger: Logger = new Logger('ExternalPubPipe'),
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const uri = req.url ?? '';
    if (!uri.startsWith('/api/external/pub/')) return next();

    const fail = (status: number, code: string): void => {
      if (!res.headersSent) {
        res.writeHead(status, { 'content-type': 'application/json' });
      }
      // Machine code, not prose — the consumer is a foreign HTTP client.
      res.end(JSON.stringify({ error: code }));
    };

    void pub
      .resolveUri(uri)
      .then((resolution) => {
        if (!resolution.ok) return fail(404, 'not-found');
        const target = new URL(resolution.target);
        const requestFn =
          target.protocol === 'https:' ? httpsRequest : httpRequest;
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          if (HOP_BY_HOP.has(name) || name === 'host') continue;
          headers[name] = value;
        }
        const upstream = requestFn(
          target,
          { method: req.method, headers },
          (upstreamRes) => {
            const outHeaders: Record<string, string | string[]> = {};
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
              if (value === undefined || HOP_BY_HOP.has(name)) continue;
              outHeaders[name] = value;
            }
            res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
            upstreamRes.pipe(res);
          },
        );
        upstream.setTimeout(PIPE_TIMEOUT_MS, () => upstream.destroy());
        upstream.on('error', (err) => {
          logger.warn(`public-path pipe failed: ${getErrorMessage(err)}`);
          fail(502, 'unavailable');
        });
        // A client that vanishes mid-stream must not leave the upstream
        // request dangling for the full timeout.
        res.on('close', () => {
          if (!res.writableEnded) upstream.destroy();
        });
        req.pipe(upstream);
      })
      .catch((err: unknown) => {
        logger.warn(`public-path resolve failed: ${getErrorMessage(err)}`);
        fail(502, 'unavailable');
      });
  };
}
