import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { TransliterationService } from '@makekeeper/backend-core';
import { LlmClient } from './llm-client';
import type { ProviderConfig } from './chat.types';

// The unit tests for labelling stub `fetch`, which skips the layer that matters
// most here: undici validates header values as a ByteString and THROWS on a
// non-ASCII one, taking the whole chat turn with it. This spec therefore drives
// a real socket — a local http server standing in for a proxy — so the
// transliteration is proven to prevent that crash rather than assumed to.

const i18n = {
  t: (key: string): string => key,
  resolveTool: <T>(tool: T): T => tool,
};
const attachments = {
  readForVisionAsBase64: async (): Promise<null> => null,
  findMetaByUrls: async (): Promise<Map<string, unknown>> => new Map(),
};

describe('proxy label over a real socket (#235)', () => {
  let server: Server;
  let seen: Record<string, string | string[] | undefined>[] = [];
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.headers);
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    seen = [];
  });

  const client = (): LlmClient =>
    new LlmClient(
      i18n as never,
      attachments as never,
      new TransliterationService(),
    );

  const connection = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl,
    modelName: 'test-model',
    organizationId: null,
    apiVersion: null,
    imageDetail: null,
    reasoningEffort: null,
    proxyLabel: 'makekeeper-prod',
    proxyLabelSegments: 'label,user,project',
    ...over,
  });

  it('delivers a Cyrillic-sourced label as a valid header value', async () => {
    const result = await client().complete(
      connection(),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: 'Ремонт кухни v2.0' },
    );

    expect(result).toBe('pong');
    expect(seen).toHaveLength(1);
    expect(seen[0]['x-litellm-tags']).toBe(
      'makekeeper-prod.ivan.remont-kuhni-v2-0',
    );
    expect(seen[0]['user-agent']).toBe(
      'MakeKeeper (makekeeper-prod.ivan.remont-kuhni-v2-0)',
    );
  });

  it('would have crashed the request without transliteration', async () => {
    // Pins the reason the rule exists: the raw name cannot even be put into a
    // header, so "just send the project title" was never an option.
    expect(() => new Headers({ 'x-litellm-tags': 'Ремонт кухни' })).toThrow();
  });

  it('labels a project-only configuration, with no connection text at all', async () => {
    // The connection segment is switchable, so "no label typed" is not the same
    // as "nothing to send" — this configuration is legitimate and must work.
    await client().complete(
      { ...connection(), proxyLabel: null, proxyLabelSegments: 'project' },
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: 'Ремонт кухни' },
    );
    expect(seen[0]['x-litellm-tags']).toBe('remont-kuhni');
    expect(seen[0]['authorization']).toBe('Bearer test-key');
  });

  it('sends nothing when the whole composition is placeholders', async () => {
    await client().complete(
      {
        ...connection(),
        proxyLabel: null,
        proxyLabelSegments: 'label,project',
      },
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: null },
    );
    expect(seen[0]['x-litellm-tags']).toBeUndefined();
    expect(seen[0]['authorization']).toBe('Bearer test-key');
  });

  it('mirrors the value into an operator-named header on the wire', async () => {
    await client().complete(
      connection({
        proxyHeaderName: 'x-tailnet-tag',
        proxyLabelSegments: 'label',
      }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    expect(seen[0]['x-tailnet-tag']).toBe('makekeeper-prod');
  });
});
