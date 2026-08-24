import {
  EXTERNAL_INVOKE_CAPABILITY_PATH,
  EXTERNAL_NOTIFY_CHANGED_PATH,
} from '@makekeeper/plugin-contract';

// Typed client for the plugin → core direction (#139).
//
// Which token a call carries is not the author's decision to get wrong: an
// interactive call (inside a render/action/tool) uses the short-lived
// delegated token that came with the request, so the core sees the acting
// USER; background work uses the plugin's own background token. The client
// picks the delegated one whenever the current request supplied it.

export interface CoreOperation {
  name: string;
  pluginId: string;
  permission: string;
  descriptionKey: string;
  parameters: unknown;
}

export interface MetricSeries {
  pluginId: string;
  metricKey: string;
  from: string;
  to: string;
  points: Array<{
    date: string;
    value: number;
    scopeId?: string;
    dimensions?: Record<string, string>;
  }>;
}

// Background credentials a plugin holds between requests (#140). Provisioned
// by exchanging the registration secret; re-provisioned whenever grants change.
export interface BackgroundTokens {
  scoped: Array<{ scopeId: string | null; token: string }>;
  instance: string | null;
}

export class CoreClient {
  constructor(
    private readonly coreUrl: string,
    private readonly delegatedToken: () => string | null,
    private readonly background: () => BackgroundTokens | null = () => null,
    // Which background credential a background call should use. Scoped work
    // names its scope; instance-wide work asks for the instance token.
    private readonly scopeHint: () => string | null | undefined = () =>
      undefined,
    // Re-provisions the background credentials. Grants change on consent and
    // every change re-mints tokens server-side, so a held token EXPECTEDLY
    // dies mid-flight; a 401 on a background call triggers one refresh and
    // one retry instead of failing work that has every right to run.
    private readonly refreshBackground?: () => Promise<unknown>,
  ) {}

  private token(): string | null {
    const delegated = this.delegatedToken();
    if (delegated) return delegated;
    const tokens = this.background();
    if (!tokens) return null;
    const hint = this.scopeHint();
    if (hint === 'instance') return tokens.instance;
    const match = tokens.scoped.find((s) => s.scopeId === (hint ?? null));
    return match?.token ?? tokens.scoped[0]?.token ?? null;
  }

  // A client bound to one scope's background token — what a scheduler uses.
  forScope(scopeId: string | null): CoreClient {
    return new CoreClient(
      this.coreUrl,
      () => null,
      this.background,
      () => scopeId,
      this.refreshBackground,
    );
  }

  // A client bound to the instance token: aggregates across scopes, read-only.
  forInstance(): CoreClient {
    return new CoreClient(
      this.coreUrl,
      () => null,
      this.background,
      () => 'instance',
      this.refreshBackground,
    );
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<T> {
    let res = await this.send(path, init);
    // A 401 on a BACKGROUND token is the expected death of a re-minted
    // credential (consent, grant change) — refresh once and retry once. A
    // delegated token is not ours to refresh, and a second 401 is a real
    // refusal that must surface.
    if (
      res.status === 401 &&
      this.refreshBackground &&
      this.delegatedToken() === null
    ) {
      await this.refreshBackground();
      res = await this.send(path, init);
    }
    if (!res.ok) {
      const detail: unknown = await res.json().catch(() => null);
      throw new Error(
        `core call failed (${res.status}): ${JSON.stringify(detail)}`,
      );
    }
    return (await res.json()) as T;
  }

  private async send(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<Response> {
    const token = this.token();
    if (!token) throw new Error('no core token available for this call');
    return fetch(`${this.coreUrl}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  // Discovery: exactly the operations this plugin's grants allow.
  operations(): Promise<CoreOperation[]> {
    return this.call<CoreOperation[]>('/api/external/data/operations', {
      method: 'GET',
    });
  }

  // One capability-layer operation on the scoped surface.
  async invoke<T = unknown>(
    operation: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.call<{ result: T }>('/api/external/data/invoke', {
      method: 'POST',
      body: { operation, args },
    });
    return res.result;
  }

  // Instance surface: cross-scope aggregates (requires an instance grant).
  metrics(input: {
    pluginId: string;
    metricKey: string;
    days?: number;
    byScope?: boolean;
  }): Promise<MetricSeries> {
    const query = new URLSearchParams({
      pluginId: input.pluginId,
      metricKey: input.metricKey,
      ...(input.days ? { days: String(input.days) } : {}),
      ...(input.byScope ? { byScope: 'true' } : {}),
    });
    return this.call<MetricSeries>(
      `/api/external/instance/metrics?${query.toString()}`,
      { method: 'GET' },
    );
  }

  // Tell viewing clients that a screen's data changed. Signal only — the core
  // relays it over its own socket and the client refetches the render.
  async notifyChanged(screen: string, scopeId?: string): Promise<void> {
    await this.call(EXTERNAL_NOTIFY_CHANGED_PATH, {
      method: 'POST',
      body: { screen, scopeId },
    });
  }

  // Invoke a capability offered by another plugin (needs the capability grant).
  async capability<T = unknown>(
    capability: string,
    method: string,
    args: unknown[] = [],
  ): Promise<T> {
    const res = await this.call<{ result: T }>(
      EXTERNAL_INVOKE_CAPABILITY_PATH,
      { method: 'POST', body: { capability, method, args } },
    );
    return res.result;
  }
}
