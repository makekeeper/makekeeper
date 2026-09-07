import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The receiver (`deploy/telemetry/worker.js`) is deployed by hand to Cloudflare
// and has no test runner of its own, so it is exercised from here (#343). It is
// the half of the contract a reviewer is least likely to re-read, and the half
// where a hole is silent: a validator that quietly accepts an extra field turns
// "exactly this is sent" into a claim nobody is checking.
//
// Loaded by evaluating the file rather than importing it: the worker is an ES
// module of plain JavaScript — kept that way so it deploys with `wrangler
// deploy` and no build step — and this suite runs under CommonJS Jest, which
// cannot import one. The only edit is to the `export default` line, so what
// runs here is otherwise the deployed source, character for character.
type Ping = Record<string, unknown>;
type Worker = {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const WORKER_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'deploy',
  'telemetry',
  'worker.js',
);

const VALID: Ping = {
  instanceId: 'cd0f9c99-3de9-4695-8e1b-ee98dbc54624',
  version: '0.17.0+',
  installMethod: 'compose',
  plugins: ['inventory', 'projects'],
  locale: 'ru',
};

describe('telemetry receiver (#343)', () => {
  let worker: Worker;
  let writes: { sql: string; args: unknown[] }[];
  let env: unknown;

  beforeAll(() => {
    const source = readFileSync(WORKER_PATH, 'utf8').replace(
      'export default',
      'globalThis.__telemetryWorker =',
    );
    new Function(source)();
    const scope = globalThis as unknown as { __telemetryWorker?: Worker };
    if (!scope.__telemetryWorker)
      throw new Error(`no worker in ${WORKER_PATH}`);
    worker = scope.__telemetryWorker;
  });

  beforeEach(() => {
    writes = [];
    env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: async () => writes.push({ sql, args }),
          }),
        }),
      },
    };
  });

  const post = (body: unknown, path = '/v1/ping'): Promise<Response> =>
    worker.fetch(
      new Request(`https://ping.test${path}`, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
    );

  it('accepts a ping and writes exactly one row', async () => {
    const response = await post(VALID);

    expect(response.status).toBe(204);
    expect(writes).toHaveLength(1);
    // A date, never a timestamp: the questions this data answers are counted in
    // days, and a time of day would describe the sender's habits.
    expect(writes[0].args[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(writes[0].args[4]).toBe('inventory,projects');
  });

  // The rule that keeps the documented payload honest: a field nobody has
  // agreed to send cannot slip in behind a released client.
  it('refuses a body carrying anything extra', async () => {
    const response = await post({ ...VALID, hostname: 'workshop.example' });

    expect(response.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['a missing field', { instanceId: VALID['instanceId'] }],
    ['a non-uuid id', { ...VALID, instanceId: 'workshop-1' }],
    [
      'a junk install method',
      { ...VALID, installMethod: "'; DROP TABLE x;--" },
    ],
    ['a plugin list that is not a list', { ...VALID, plugins: 'inventory' }],
    ['a plugin id with spaces', { ...VALID, plugins: ['my plugin'] }],
  ])('refuses %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('refuses a body that is not JSON at all', async () => {
    expect((await post('not json')).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('refuses an oversized body before parsing it', async () => {
    const huge = JSON.stringify({ ...VALID, version: 'x'.repeat(4000) });

    expect((await post(huge)).status).toBe(413);
    expect(writes).toHaveLength(0);
  });

  it('serves nothing but the ping route', async () => {
    expect((await post(VALID, '/')).status).toBe(404);
    expect(
      (await worker.fetch(new Request('https://ping.test/v1/ping'), env))
        .status,
    ).toBe(405);
    expect(writes).toHaveLength(0);
  });
});
