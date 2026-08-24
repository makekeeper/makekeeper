import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@makekeeper/backend-core';
import {
  ExternalActionRequest,
  ExternalRenderRequest,
  ExternalResolveRefRequest,
  PLUGIN_ACTION_PATH,
  PLUGIN_HEALTH_PATH,
  PLUGIN_RENDER_PATH,
  PLUGIN_RESOLVE_REF_PATH,
  sanitizeUiScreen,
  UiActionResult,
  UiCommand,
  UiText,
  UiScreen,
} from '@makekeeper/plugin-contract';
import {
  ExternalBreakerService,
  ExternalSurface,
} from './external-breaker.service';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalTokensService } from './external-tokens.service';
import { callerUserId, deriveUserRef } from './external-user-ref';
import { ExternalScopeRefService } from './external-scope-ref.service';

// The server-driven render proxy (#134). Everything the SPA sees of an
// external plugin's content passes through here:
//   1. the plugin must be ACTIVE (a pending/disabled/unknown one is invisible);
//   2. the surface's budget and the circuit breaker apply;
//   3. the returned tree is SANITIZED against the contract vocabulary before
//      it can reach the browser — unknown node types are skipped, malformed
//      ones dropped, so a plugin can never inject anything the renderer does
//      not already know how to draw safely.
//
// Failures are returned as discriminated results, never thrown: the frontend
// maps them to the per-surface degradation (error card / silent drop).

export type ExternalRenderFailure =
  | 'unavailable' // not installed / not active / breaker open
  | 'timeout'
  // The container answered 401: it holds a different secret from the one this
  // installation was issued, which is what a container that lost its state
  // looks like. One cure, so it gets its own code.
  | 'unauthorized'
  | 'error'; // network, non-2xx, unparseable or invalid payload

export type ExternalRenderResult =
  | { ok: true; screen: UiScreen; dropped: string[] }
  | { ok: false; failure: ExternalRenderFailure };

export type ExternalActionResult =
  | { ok: true; result: UiActionResult; dropped: string[] }
  | { ok: false; failure: ExternalRenderFailure };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Commands are a tiny closed vocabulary; validate structurally so the client
// never receives a half-shaped command it would have to guard against. Each
// command is REBUILT field by field — casting the raw object through would
// smuggle whatever else the plugin attached straight to the SPA.
const readText = (value: unknown): UiText | null => {
  if (!isRecord(value) || typeof value['key'] !== 'string') return null;
  const text: UiText = { key: value['key'] };
  if (isRecord(value['params'])) {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(value['params'])) {
      if (typeof v === 'string' || typeof v === 'number') params[k] = v;
    }
    text.params = params;
  }
  return text;
};

const readStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
};

const sanitizeCommands = (value: unknown): UiCommand[] => {
  if (!Array.isArray(value)) return [];
  const out: UiCommand[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const command = raw['command'];
    if (command === 'toast') {
      const tone = raw['tone'];
      const text = readText(raw['text']);
      if ((tone === 'success' || tone === 'error') && text) {
        out.push({ command: 'toast', tone, text });
      }
    } else if (command === 'navigate') {
      out.push({
        command: 'navigate',
        screen: typeof raw['screen'] === 'string' ? raw['screen'] : undefined,
        params: readStringMap(raw['params']),
        ref: typeof raw['ref'] === 'string' ? raw['ref'] : undefined,
      });
    } else if (command === 'refresh') {
      const tone = isRecord(raw['toast']) ? raw['toast']['tone'] : undefined;
      const text = isRecord(raw['toast'])
        ? readText(raw['toast']['text'])
        : null;
      out.push({
        command: 'refresh',
        toast:
          (tone === 'success' || tone === 'error') && text
            ? { tone, text }
            : undefined,
      });
    }
  }
  return out;
};

@Injectable()
export class ExternalRenderService {
  private readonly logger = new Logger(ExternalRenderService.name);

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly tokens: ExternalTokensService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  async render(
    pluginId: string,
    screen: string,
    params: Record<string, string>,
    surface: ExternalSurface,
    // Present when a `reloadOnChange` field triggered this render: what the
    // user has typed so far, so the plugin can draw the form that belongs to
    // the current choice (contract 1.2).
    form?: Record<string, string | number | boolean>,
  ): Promise<ExternalRenderResult> {
    const call = await this.call(pluginId, surface, async (plugin, ctx) => {
      const body: ExternalRenderRequest = {
        screen,
        params,
        form,
        context: ctx,
      };
      return this.signer.post(
        plugin.baseUrl,
        plugin.secret,
        PLUGIN_RENDER_PATH,
        body,
        this.breaker.budget(surface),
      );
    });
    if (call.ok === false) return call;

    const payload = call.body;
    const sanitized =
      isRecord(payload) && payload['screen'] !== undefined
        ? sanitizeUiScreen(payload['screen'])
        : null;
    if (!sanitized) return { ok: false, failure: 'error' };
    if (sanitized.dropped.length > 0) {
      this.logger.debug(
        `external plugin ${pluginId} sent ${sanitized.dropped.length} unrenderable node(s) on screen ${screen}`,
      );
    }
    return { ok: true, screen: sanitized.screen, dropped: sanitized.dropped };
  }

  async action(
    pluginId: string,
    request: Omit<ExternalActionRequest, 'context'>,
  ): Promise<ExternalActionResult> {
    // An action is a deliberate user act on a screen already open: it gets the
    // screen budget, not the guest-surface one.
    const call = await this.call(pluginId, 'screen', async (plugin, ctx) => {
      const body: ExternalActionRequest = { ...request, context: ctx };
      return this.signer.post(
        plugin.baseUrl,
        plugin.secret,
        PLUGIN_ACTION_PATH,
        body,
        this.breaker.budget('screen'),
      );
    });
    if (call.ok === false) return call;

    const payload = call.body;
    if (!isRecord(payload)) return { ok: false, failure: 'error' };

    if (payload['screen'] !== undefined) {
      const sanitized = sanitizeUiScreen(payload['screen']);
      if (!sanitized) return { ok: false, failure: 'error' };
      return {
        ok: true,
        result: { screen: sanitized.screen },
        dropped: sanitized.dropped,
      };
    }
    const commands = sanitizeCommands(payload['commands']);
    return { ok: true, result: { commands }, dropped: [] };
  }

  // ORef resolution (#134): mk://<externalPluginId>/<type>/<id> → display name.
  // Tight budget — a dead resolver degrades the link to plain text rather than
  // stalling a chat message.
  async resolveRef(
    pluginId: string,
    entityType: string,
    entityId: string,
  ): Promise<{ name: string; breadcrumb?: string[] } | null> {
    const call = await this.call(pluginId, 'ref', async (plugin, ctx) => {
      const body: ExternalResolveRefRequest = {
        entityType,
        entityId,
        context: ctx,
      };
      return this.signer.post(
        plugin.baseUrl,
        plugin.secret,
        PLUGIN_RESOLVE_REF_PATH,
        body,
        this.breaker.budget('ref'),
      );
    });
    if (call.ok === false) return null;
    const payload = call.body;
    if (!isRecord(payload) || typeof payload['name'] !== 'string') return null;
    const breadcrumb = Array.isArray(payload['breadcrumb'])
      ? payload['breadcrumb'].filter((b): b is string => typeof b === 'string')
      : undefined;
    return { name: payload['name'], breadcrumb };
  }

  // The recovery probe: a cheap signed health call that lets the breaker close.
  async probeHealth(pluginId: string): Promise<boolean> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return false;
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_HEALTH_PATH,
      {},
      this.breaker.budget('ref'),
    );
    if (res.ok) this.breaker.recordSuccess(pluginId);
    else this.breaker.recordFailure(pluginId);
    return res.ok;
  }

  // Shared pipeline: activity check → breaker → delegated token minting →
  // signed call → breaker bookkeeping.
  private async call(
    pluginId: string,
    surface: ExternalSurface,
    fn: (
      plugin: { baseUrl: string; secret: string },
      ctx: {
        scopeId: string;
        locale: string;
        delegatedToken?: string;
        userRef?: string;
      },
    ) => Promise<{
      ok: boolean;
      body: unknown;
      status?: number;
      errorCode?: string;
    }>,
  ): Promise<
    { ok: true; body: unknown } | { ok: false; failure: ExternalRenderFailure }
  > {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return { ok: false, failure: 'unavailable' };
    if (this.breaker.shouldSkip(pluginId)) {
      return { ok: false, failure: 'unavailable' };
    }

    const request = this.context.get();
    // The plugin sees the OPAQUE scope reference, never the internal id
    // (decision #5); the delegated token below keeps the real id core-side.
    const scopeId =
      (await this.scopeRefs.toRef(pluginId, request?.scopeId ?? null)) ?? '';
    const locale = request?.locale ?? 'en';
    // The plugin acts as the CALLING USER for the duration of this render:
    // a short-lived delegated token, never standing authority (decision #5).
    const delegatedToken = await this.tokens.issueDelegated(
      pluginId,
      request?.userId ?? null,
      request?.scopeId ?? null,
    );

    // Who is asking, pseudonymously (#156). Only for a call that HAS a user:
    // background work is nobody, and saying otherwise would invite a plugin to
    // attribute a scheduled job to whoever happened to trigger it.
    const userId = callerUserId(request);
    const salt = userId ? await this.registry.userRefSalt(pluginId) : null;
    const userRef = userId && salt ? deriveUserRef(salt, userId) : undefined;

    const res = await fn(plugin, { scopeId, locale, delegatedToken, userRef });
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      if (res.status === 401) {
        this.logger.warn(
          `external plugin rejected our signature: ${pluginId} — its container ` +
            `does not hold this installation's secret (re-pair it)`,
        );
      }
      return {
        ok: false,
        failure:
          res.status === 401
            ? 'unauthorized'
            : res.errorCode === 'timeout'
              ? 'timeout'
              : 'error',
      };
    }
    this.breaker.recordSuccess(pluginId);
    return { ok: true, body: res.body };
  }
}
