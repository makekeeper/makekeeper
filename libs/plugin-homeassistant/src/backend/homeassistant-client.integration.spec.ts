import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isHomeAssistantFailure } from '@makekeeper/plugin-contract';
import { HomeAssistantClientService } from './homeassistant-client.service';

// The client against a REAL socket.
//
// Its sibling spec mocks `fetch` and so proves only what this process intended
// to send; this one puts a server on a port and reads what actually arrived —
// the way to catch a missing header, a mangled query string or a body that is
// wrong in a way a mock happily accepts. The stub refuses what Home Assistant
// refuses (a bad token, an unknown action) rather than answering 200 to
// everything, because a stub that never says no hides the integration bug it
// exists to find.

interface Received {
  path: string;
  method: string | undefined;
  auth: string | undefined;
  body: Record<string, unknown>;
}

const TOKEN = 'test-token';

function stub(received: Received[]): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const path = req.url ?? '';
      received.push({
        path,
        method: req.method,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : {},
      });
      const reply = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          typeof payload === 'string' ? payload : JSON.stringify(payload),
        );
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return reply(401, { message: 'Unauthorized' });
      }
      if (path === '/api/') return reply(200, { message: 'API running.' });
      if (path === '/api/config') {
        return reply(200, { version: '2026.10.1', components: ['niimbot'] });
      }
      if (path === '/api/template') {
        // Renders to TEXT — which is why the caller asks for `tojson`.
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(JSON.stringify(['button.b1_print']));
      }
      if (path === '/api/states') {
        return reply(200, [
          {
            entity_id: 'button.b1_print',
            state: 'idle',
            attributes: { friendly_name: 'Workshop B1' },
          },
          { entity_id: 'light.kitchen', state: 'on', attributes: {} },
        ]);
      }
      if (path.startsWith('/api/services/niimbot/print')) {
        return reply(200, []);
      }
      return reply(404, { message: 'Service other.print not found.' });
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

describe('HomeAssistantClientService over a real socket', () => {
  let server: Server;
  let received: Received[];
  let service: HomeAssistantClientService;

  beforeEach(async () => {
    received = [];
    server = await stub(received);
    const { port } = server.address() as AddressInfo;
    service = new HomeAssistantClientService({
      getInternal: async () => ({
        baseUrl: `http://127.0.0.1:${port}`,
        token: TOKEN,
        hasToken: true,
      }),
      isConfiguredSync: () => true,
    } as never);
  });

  afterEach(() => {
    server.close();
  });

  it('reports the version a real answer carries', async () => {
    const probe = await service.probe();
    if (isHomeAssistantFailure(probe)) throw new Error(probe.errorKey);
    expect(probe.data.version).toBe('2026.10.1');
    expect(probe.data.entityCount).toBe(2);
    expect(received.map((r) => r.path)).toEqual([
      '/api/',
      '/api/config',
      '/api/states',
    ]);
    expect(received.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('narrows to an integration through a template rendered as text', async () => {
    const states = await service.getStates({ integration: 'niimbot' });
    if (isHomeAssistantFailure(states)) throw new Error(states.errorKey);
    expect(states.data.integrationFilterApplied).toBe(true);
    expect(states.data.entities).toEqual([
      {
        entityId: 'button.b1_print',
        state: 'idle',
        friendlyName: 'Workshop B1',
      },
    ]);
    expect(received[0].method).toBe('POST');
    expect(String(received[0].body['template'])).toContain(
      "integration_entities('niimbot')",
    );
  });

  it('calls an action with the target inside the body', async () => {
    const result = await service.callService('niimbot', 'print', {
      target: { entityId: 'button.b1_print' },
      data: { density: 3, copies: 1 },
    });
    expect(result.ok).toBe(true);
    const call = received[0];
    expect(call.path).toBe('/api/services/niimbot/print');
    expect(call.body).toEqual({
      density: 3,
      copies: 1,
      entity_id: 'button.b1_print',
    });
  });

  it('is refused by a wrong token, as it should be', async () => {
    const wrong = new HomeAssistantClientService({
      getInternal: async () => ({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        token: 'not-the-token',
        hasToken: true,
      }),
      isConfiguredSync: () => true,
    } as never);
    expect(await wrong.probe()).toMatchObject({
      errorKey: 'homeassistant.errors.unauthorized',
      status: 401,
    });
  });

  it('reads an unknown action as what it is', async () => {
    const result = await service.callService('other', 'print', {});
    expect(result).toMatchObject({
      errorKey: 'homeassistant.errors.notFound',
      status: 404,
      detail: expect.stringContaining('not found'),
    });
  });
});
