import { isHomeAssistantFailure } from '@makekeeper/plugin-contract';
import { HomeAssistantClientService } from './homeassistant-client.service';

// Every branch an admin can land in, and the exact request that leaves this
// process. The second half matters most: the body below is what a household
// server will accept or reject, and no type can check it.

interface StubbedFetch extends jest.Mock {
  calls: unknown[][];
}

const settingsStub = (
  baseUrl: string | null = 'http://ha.local:8123',
  token: string | null = 'tok',
) => ({
  getInternal: jest.fn().mockResolvedValue({
    baseUrl,
    token,
    hasToken: Boolean(token),
  }),
  isConfiguredSync: () => Boolean(baseUrl && token),
});

const answer = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

function client(settings = settingsStub()): {
  service: HomeAssistantClientService;
  fetchMock: StubbedFetch;
} {
  const fetchMock = jest.fn() as StubbedFetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  return {
    service: new HomeAssistantClientService(settings as never),
    fetchMock,
  };
}

describe('HomeAssistantClientService failures', () => {
  it('asks nobody anything while there is no address or token', async () => {
    const { service, fetchMock } = client(settingsStub(null, null));
    const result = await service.getStates();
    expect(result).toEqual({
      ok: false,
      errorKey: 'homeassistant.errors.notConfigured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells a refused connection apart from a timeout', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.getStates()).toMatchObject({
      errorKey: 'homeassistant.errors.unreachable',
    });

    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    expect(await service.getStates()).toMatchObject({
      errorKey: 'homeassistant.errors.timeout',
    });
  });

  it('maps each status to its own cause, and keeps a little of the body', async () => {
    const cases: [number, string][] = [
      [401, 'homeassistant.errors.unauthorized'],
      [403, 'homeassistant.errors.unauthorized'],
      [404, 'homeassistant.errors.notFound'],
      [400, 'homeassistant.errors.badRequest'],
      [500, 'homeassistant.errors.serverError'],
    ];
    for (const [status, errorKey] of cases) {
      const { service, fetchMock } = client();
      fetchMock.mockResolvedValueOnce(answer(status, 'why not'));
      const result = await service.getStates();
      expect(result).toMatchObject({
        ok: false,
        errorKey,
        status,
        detail: 'why not',
        params: { status: String(status) },
      });
    }
  });

  it('refuses an answer that is not the JSON it claims to be', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, 'not json at all'));
    expect(await service.getStates()).toMatchObject({
      errorKey: 'homeassistant.errors.badResponse',
    });
  });
});

describe('HomeAssistantClientService.getStates', () => {
  const states = [
    {
      entity_id: 'button.b1_print',
      state: 'idle',
      attributes: { friendly_name: 'Workshop B1' },
    },
    { entity_id: 'light.kitchen', state: 'on', attributes: {} },
    { entity_id: 'sensor.b1_battery', state: '80' },
  ];

  it('carries the token and reads the names Home Assistant gives', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, states));
    const result = await service.getStates();
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data.entities).toEqual([
      {
        entityId: 'button.b1_print',
        state: 'idle',
        friendlyName: 'Workshop B1',
      },
      { entityId: 'light.kitchen', state: 'on', friendlyName: null },
      { entityId: 'sensor.b1_battery', state: '80', friendlyName: null },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/states');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('narrows to an integration through a rendered template', async () => {
    const { service, fetchMock } = client();
    fetchMock
      .mockResolvedValueOnce(answer(200, ['button.b1_print']))
      .mockResolvedValueOnce(answer(200, states));
    const result = await service.getStates({ integration: 'niimbot' });
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data.integrationFilterApplied).toBe(true);
    expect(result.data.entities.map((e) => e.entityId)).toEqual([
      'button.b1_print',
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/template');
    expect(JSON.parse(init.body).template).toContain(
      "integration_entities('niimbot')",
    );
  });

  it('says so, and lists everything, when the template cannot be rendered', async () => {
    const { service, fetchMock } = client();
    fetchMock
      .mockResolvedValueOnce(answer(400, 'templates are off'))
      .mockResolvedValueOnce(answer(200, states));
    const result = await service.getStates({ integration: 'niimbot' });
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    // The caller must be able to tell "no printers" from "could not ask".
    expect(result.data.integrationFilterApplied).toBe(false);
    expect(result.data.entities).toHaveLength(3);
  });

  it('keeps only the entity domains asked for', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, states));
    const result = await service.getStates({ domains: ['light'] });
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data.entities.map((e) => e.entityId)).toEqual([
      'light.kitchen',
    ]);
  });
});

describe('HomeAssistantClientService.getDevices', () => {
  it('asks the device registry the only way REST can — through a template', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(
      answer(200, [
        { id: 'dev-b1', name: 'Niimbot B1' },
        { id: 'dev-a', name: 'Another' },
      ]),
    );
    const result = await service.getDevices('niimbot');
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data.devices).toEqual([
      { deviceId: 'dev-a', name: 'Another' },
      { deviceId: 'dev-b1', name: 'Niimbot B1' },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/template');
    const { template } = JSON.parse(init.body);
    expect(template).toContain("integration_entities('niimbot')");
    expect(template).toContain('device_id(e)');
    expect(template).toContain('name_by_user');
  });

  it('falls back to the device id when a device has no name', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, [{ id: 'dev-b1' }]));
    const result = await service.getDevices('niimbot');
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data.devices).toEqual([
      { deviceId: 'dev-b1', name: 'dev-b1' },
    ]);
  });

  it('reports an instance that will not render the template', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(400, 'templates are off'));
    expect(await service.getDevices('niimbot')).toMatchObject({
      ok: false,
      errorKey: 'homeassistant.errors.badRequest',
    });
  });
});

describe('HomeAssistantClientService.callService', () => {
  it('flattens the target into the body, where the REST API wants it', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, []));
    const result = await service.callService('niimbot', 'print', {
      target: { entityId: 'button.b1_print' },
      data: { density: 3 },
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/services/niimbot/print');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      density: 3,
      entity_id: 'button.b1_print',
    });
  });

  it('aims at a device when that is the target', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, []));
    await service.callService('niimbot', 'print', {
      target: { deviceId: 'dev-b1' },
      data: { copies: 1 },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      copies: 1,
      device_id: 'dev-b1',
    });
  });

  it('asks for the action response only when told to', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(
      answer(200, { service_response: { image: 'data:…' } }),
    );
    const result = await service.callService('niimbot', 'print', {
      returnResponse: true,
    });
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://ha.local:8123/api/services/niimbot/print?return_response',
    );
    expect(result.data.response).toEqual({ image: 'data:…' });
  });
});

describe('HomeAssistantClientService.probe', () => {
  it('reports the version and what the token can see', async () => {
    const { service, fetchMock } = client();
    fetchMock
      .mockResolvedValueOnce(answer(200, { message: 'API running.' }))
      .mockResolvedValueOnce(
        answer(200, { version: '2026.10.1', components: ['http', 'niimbot'] }),
      )
      .mockResolvedValueOnce(
        answer(200, [{ entity_id: 'button.b1_print', state: 'idle' }]),
      );
    const result = await service.probe();
    if (isHomeAssistantFailure(result)) throw new Error(result.errorKey);
    expect(result.data).toEqual({ version: '2026.10.1', entityCount: 1 });
  });

  it('refuses something that answers but is not Home Assistant', async () => {
    const { service, fetchMock } = client();
    fetchMock.mockResolvedValueOnce(answer(200, { message: 'hello' }));
    expect(await service.probe()).toMatchObject({
      errorKey: 'homeassistant.errors.badResponse',
    });
  });

  it('probes with credentials typed but not yet saved', async () => {
    const { service, fetchMock } = client(settingsStub(null, null));
    fetchMock
      .mockResolvedValueOnce(answer(200, { message: 'API running.' }))
      .mockResolvedValueOnce(answer(200, { version: '2026.10.1' }))
      .mockResolvedValueOnce(answer(200, []));
    const result = await service.probe({
      baseUrl: 'http://typed.local:8123',
      token: 'typed',
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://typed.local:8123/api/');
    expect(init.headers.authorization).toBe('Bearer typed');
  });
});
