import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getErrorMessage } from '@makekeeper/backend-core';
import {
  isHomeAssistantFailure,
  type HomeAssistantApiCapability,
  type HomeAssistantDevice,
  type HomeAssistantEntityState,
  type HomeAssistantResult,
  type HomeAssistantServiceCall,
  type HomeAssistantStates,
  type HomeAssistantStatesFilter,
} from '@makekeeper/plugin-contract';
import { HomeAssistantSettingsService } from './homeassistant-settings.service';

// Everything this instance says to Home Assistant goes through here (#364).
//
// One `fetch` wrapper with one error map, because the whole value of the
// gateway is that a consumer gets ONE vocabulary of failures ("unreachable",
// "unauthorized") instead of each of them inventing its own reading of a 401.
// Nothing throws: a transport failure is an ordinary outcome of asking a
// household appliance a question, and `HomeAssistantResult` is how it is said.

const TIMEOUT_MS = 8000;
// Enough of an error body to recognise a cause (Home Assistant answers a
// missing action with a sentence naming it), far too little to carry a token
// into a log.
const DETAIL_LIMIT = 200;

export interface HomeAssistantCredentials {
  baseUrl?: string | null;
  token?: string | null;
}

export interface HomeAssistantProbe {
  version: string;
  // How many entities the token may read. A working connection that can see
  // nothing is a token with no permissions, and an admin needs to be able to
  // tell those two apart.
  entityCount: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function entityStateOf(value: unknown): HomeAssistantEntityState | null {
  if (!isRecord(value)) return null;
  const { entity_id: entityId, state, attributes } = value;
  if (typeof entityId !== 'string') return null;
  const friendly = isRecord(attributes) ? attributes['friendly_name'] : null;
  return {
    entityId,
    state: typeof state === 'string' ? state : '',
    friendlyName: typeof friendly === 'string' ? friendly : null,
  };
}

@Injectable()
export class HomeAssistantClientService
  implements HomeAssistantApiCapability, OnModuleInit
{
  private readonly logger = new Logger(HomeAssistantClientService.name);

  constructor(private readonly settings: HomeAssistantSettingsService) {}

  // The capability's `isConfigured()` is synchronous — it is read while
  // deciding whether a surface exists at all, and an await there would make
  // every print dialog wait on a database. So the settings row is warmed once
  // at boot and kept warm by its own cache; a cold cache answers "not
  // configured", which is also what an instance with no row should say.
  async onModuleInit(): Promise<void> {
    await this.settings.getInternal();
  }

  isConfigured(): boolean {
    return this.settings.isConfiguredSync();
  }

  // ── The wire ──────────────────────────────────────────────────────────────

  private async request(
    path: string,
    init?: { method?: 'GET' | 'POST'; body?: unknown },
    // Credentials the admin has TYPED but not saved yet. The connection check
    // tests what is on the screen — a button that tests the previous token
    // after someone pasted a new one reports on the wrong thing — and a blank
    // token there still means "keep", so the stored one is used.
    override?: HomeAssistantCredentials,
  ): Promise<HomeAssistantResult<{ status: number; text: string }>> {
    const stored = await this.settings.getInternal();
    const baseUrl = override?.baseUrl ?? stored.baseUrl;
    const token = override?.token ?? stored.token;
    if (!baseUrl || !token) {
      return { ok: false, errorKey: 'homeassistant.errors.notConfigured' };
    }
    const method = init?.method ?? 'GET';
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init?.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout and a refused connection are different answers to an admin:
      // one means "it is there and slow or hung", the other "nothing answers
      // at this address".
      const timedOut =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      this.logger.debug(
        `Home Assistant ${method} ${path} failed: ${getErrorMessage(err)}`,
      );
      return {
        ok: false,
        errorKey: timedOut
          ? 'homeassistant.errors.timeout'
          : 'homeassistant.errors.unreachable',
      };
    }
    const text = await res.text().catch(() => '');
    if (res.ok) return { ok: true, data: { status: res.status, text } };
    return {
      ok: false,
      errorKey: this.errorKeyForStatus(res.status),
      params: { status: String(res.status) },
      status: res.status,
      detail: text.slice(0, DETAIL_LIMIT),
    };
  }

  private errorKeyForStatus(status: number): string {
    if (status === 401 || status === 403)
      return 'homeassistant.errors.unauthorized';
    if (status === 404) return 'homeassistant.errors.notFound';
    if (status >= 500) return 'homeassistant.errors.serverError';
    return 'homeassistant.errors.badRequest';
  }

  private async requestJson(
    path: string,
    init?: { method?: 'GET' | 'POST'; body?: unknown },
    override?: HomeAssistantCredentials,
  ): Promise<HomeAssistantResult<unknown>> {
    const res = await this.request(path, init, override);
    if (isHomeAssistantFailure(res)) return res;
    if (res.data.text === '') return { ok: true, data: null };
    try {
      const parsed: unknown = JSON.parse(res.data.text);
      return { ok: true, data: parsed };
    } catch {
      return { ok: false, errorKey: 'homeassistant.errors.badResponse' };
    }
  }

  // ── The capability ────────────────────────────────────────────────────────

  getStates(
    filter?: HomeAssistantStatesFilter,
  ): Promise<HomeAssistantResult<HomeAssistantStates>> {
    return this.statesWith(undefined, filter);
  }

  private async statesWith(
    override?: HomeAssistantCredentials,
    filter?: HomeAssistantStatesFilter,
  ): Promise<HomeAssistantResult<HomeAssistantStates>> {
    // The integration filter first, because its failure is not fatal: the
    // entity REGISTRY (the only place that records which integration owns an
    // entity) is exposed over Home Assistant's WebSocket API alone, so the
    // filter is answered by rendering a template — and an instance that
    // refuses templates still has a usable, merely wider, list.
    let allowed: string[] | null = null;
    if (filter?.integration) {
      allowed = await this.integrationEntityIds(filter.integration, override);
    }

    const res = await this.requestJson('/api/states', undefined, override);
    if (isHomeAssistantFailure(res)) return res;
    if (!Array.isArray(res.data)) {
      return { ok: false, errorKey: 'homeassistant.errors.badResponse' };
    }
    const allowedSet = allowed === null ? null : new Set(allowed);
    const entities = res.data
      .map(entityStateOf)
      .filter((row): row is HomeAssistantEntityState => row !== null)
      .filter((row) => allowedSet === null || allowedSet.has(row.entityId))
      .filter(
        (row) =>
          filter?.domains === undefined ||
          filter.domains.includes(row.entityId.split('.')[0] ?? ''),
      )
      .sort((a, b) => a.entityId.localeCompare(b.entityId));
    return {
      ok: true,
      data: {
        entities,
        integrationFilterApplied:
          filter?.integration === undefined || allowed !== null,
      },
    };
  }

  // `null` means the question could not be answered — never "the integration
  // has no entities", which the caller must not confuse with it.
  private async integrationEntityIds(
    integration: string,
    override?: HomeAssistantCredentials,
  ): Promise<string[] | null> {
    const res = await this.requestJson(
      '/api/template',
      {
        method: 'POST',
        body: {
          // `tojson` so the answer is parseable: the endpoint renders a template
          // to TEXT, and Jinja's own list repr is Python's, with single quotes.
          template: `{{ integration_entities('${integration.replace(/'/g, '')}') | list | tojson }}`,
        },
      },
      override,
    );
    if (isHomeAssistantFailure(res) || !isStringArray(res.data)) return null;
    return res.data;
  }

  // One template, one answer: the integration's devices with the names the
  // household gave them. `device_id()` and `device_attr()` are the only way to
  // reach the device registry without the WebSocket API, and `name_by_user`
  // comes first because a renamed device is renamed for a reason.
  async getDevices(
    integration: string,
  ): Promise<HomeAssistantResult<{ devices: HomeAssistantDevice[] }>> {
    const safe = integration.replace(/'/g, '');
    const template =
      `{% set ns = namespace(rows=[]) %}` +
      `{% for e in integration_entities('${safe}') %}` +
      `{% set d = device_id(e) %}` +
      `{% if d and d not in (ns.rows | map(attribute='id') | list) %}` +
      `{% set ns.rows = ns.rows + [{'id': d, ` +
      `'name': device_attr(d, 'name_by_user') or device_attr(d, 'name') or d}] %}` +
      `{% endif %}{% endfor %}{{ ns.rows | tojson }}`;
    const res = await this.requestJson('/api/template', {
      method: 'POST',
      body: { template },
    });
    if (isHomeAssistantFailure(res)) return res;
    if (!Array.isArray(res.data)) {
      return { ok: false, errorKey: 'homeassistant.errors.badResponse' };
    }
    const devices = res.data
      .map((row): HomeAssistantDevice | null => {
        if (!isRecord(row)) return null;
        const { id, name } = row;
        if (typeof id !== 'string') return null;
        return { deviceId: id, name: typeof name === 'string' ? name : id };
      })
      .filter((device): device is HomeAssistantDevice => device !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: { devices } };
  }

  async callService(
    domain: string,
    service: string,
    call?: HomeAssistantServiceCall,
  ): Promise<HomeAssistantResult<{ response?: unknown }>> {
    // Home Assistant's REST endpoint has no `target` envelope — the target is
    // part of the action's data — so the structured form the capability takes
    // is flattened here, once, instead of at every call site.
    const entityId = call?.target?.entityId;
    const deviceId = call?.target?.deviceId;
    const body: Record<string, unknown> = {
      ...(call?.data ?? {}),
      ...(entityId === undefined ? {} : { entity_id: entityId }),
      ...(deviceId === undefined ? {} : { device_id: deviceId }),
    };
    const query = call?.returnResponse === true ? '?return_response' : '';
    const res = await this.requestJson(
      `/api/services/${domain}/${service}${query}`,
      { method: 'POST', body },
    );
    if (isHomeAssistantFailure(res)) return res;
    const response = isRecord(res.data) ? res.data['service_response'] : null;
    return { ok: true, data: { response: response ?? undefined } };
  }

  // ── The connection check ──────────────────────────────────────────────────

  // Two questions, in the order that makes a failure legible: is anything
  // there, and what is it. Deliberately nothing about any integration — this
  // plugin is a transport, and "can it print" is a question for whoever owns
  // the printer (which is also why `probe` has no idea what a Niimbot is).
  async probe(
    override?: HomeAssistantCredentials,
  ): Promise<HomeAssistantResult<HomeAssistantProbe>> {
    const root = await this.requestJson('/api/', undefined, override);
    if (isHomeAssistantFailure(root)) return root;
    const message = isRecord(root.data) ? root.data['message'] : null;
    if (typeof message !== 'string' || !message.includes('API running')) {
      return { ok: false, errorKey: 'homeassistant.errors.badResponse' };
    }
    const config = await this.requestJson('/api/config', undefined, override);
    if (isHomeAssistantFailure(config)) return config;
    if (!isRecord(config.data)) {
      return { ok: false, errorKey: 'homeassistant.errors.badResponse' };
    }
    const version = config.data['version'];
    const states = await this.statesWith(override);
    return {
      ok: true,
      data: {
        version: typeof version === 'string' ? version : '',
        entityCount: isHomeAssistantFailure(states)
          ? 0
          : states.data.entities.length,
      },
    };
  }
}
