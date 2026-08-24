import { TransliterationService } from '@makekeeper/backend-core';
import { LlmClient } from './llm-client';
import { LlmProviderError, LlmUsage, ProviderConfig } from './chat.types';

// LlmClient talks to three provider dialects over `fetch`. These tests stub
// `fetch` to drive each dialect deterministically — the whole point of pulling
// the wire protocol out of ChatService was to make this reachable without a
// Prisma/registry/realtime stack behind it.

// Minimal stand-ins for the collaborators (both are tiny here): i18n echoes
// keys, attachments never resolves an image (no vision in these cases).
const i18n = {
  t: (key: string): string => key,
  resolveTool: <T>(tool: T): T => tool,
};
const attachments = {
  readForVisionAsBase64: async (): Promise<null> => null,
  findMetaByUrls: async (): Promise<Map<string, unknown>> => new Map(),
};

const makeClient = (): LlmClient =>
  new LlmClient(
    // The two constructor deps, structurally typed for the test.
    i18n as never,
    attachments as never,
    // Real, not stubbed: under Jest it reads the actual asset folder, so these
    // tests exercise the shipped tables end to end.
    new TransliterationService(),
  );

const baseProvider = (provider: string): ProviderConfig => ({
  provider,
  apiKey: 'test-key',
  baseUrl: null,
  modelName: 'test-model',
  organizationId: null,
  apiVersion: null,
  imageDetail: null,
  reasoningEffort: null,
});

// A fetch stub returning one JSON body; captures the request for assertions.
function stubFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('LlmClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses a Gemini text reply and reports usage', async () => {
    const fetchMock = stubFetch(200, {
      candidates: [{ content: { parts: [{ text: 'hello from gemini' }] } }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 3,
        totalTokenCount: 8,
      },
    });
    const usages: LlmUsage[] = [];
    const result = await makeClient().complete(
      baseProvider('gemini'),
      'system',
      [{ role: 'user', content: 'hi' }],
      [],
      'en',
      async (u) => void usages.push(u),
    );

    expect(result).toBe('hello from gemini');
    expect(usages).toEqual([
      { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    ]);
    // Hit the Gemini generateContent endpoint for the configured model.
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v1beta/models/test-model:generateContent',
    );
  });

  it('surfaces a Gemini function call as a tool-call result', async () => {
    stubFetch(200, {
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'add_item', args: { qty: 2 } } }],
          },
        },
      ],
    });
    const result = await makeClient().complete(
      baseProvider('gemini'),
      'system',
      [{ role: 'user', content: 'add 2' }],
      [],
    );
    expect(result).toEqual({
      isToolCall: true,
      name: 'add_item',
      args: { qty: 2 },
      thoughtSignature: undefined,
    });
  });

  it('parses an OpenAI chat completion', async () => {
    const fetchMock = stubFetch(200, {
      choices: [{ message: { content: 'hello from openai' } }],
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    });
    const result = await makeClient().complete(
      baseProvider('openai'),
      'system',
      [{ role: 'user', content: 'hi' }],
      [],
    );
    expect(result).toBe('hello from openai');
    expect(fetchMock.mock.calls[0][0]).toContain('/chat/completions');
  });

  it('parses an Ollama reply', async () => {
    stubFetch(200, {
      message: { content: 'hello from ollama' },
      prompt_eval_count: 2,
      eval_count: 3,
    });
    const result = await makeClient().complete(
      { ...baseProvider('ollama'), baseUrl: 'http://localhost:11434' },
      'system',
      [{ role: 'user', content: 'hi' }],
      [],
    );
    expect(result).toBe('hello from ollama');
  });

  it('throws LlmProviderError with provider + status on a non-OK response', async () => {
    stubFetch(503, { error: { message: 'model overloaded' } });
    await expect(
      makeClient().complete(
        baseProvider('gemini'),
        'system',
        [{ role: 'user', content: 'hi' }],
        [],
      ),
    ).rejects.toMatchObject({
      name: 'LlmProviderError',
      provider: 'Gemini',
      status: 503,
      message: 'model overloaded',
    });
  });

  it('does not record usage when the provider call fails', async () => {
    stubFetch(500, { error: 'boom' });
    const usages: LlmUsage[] = [];
    await expect(
      makeClient().complete(
        baseProvider('openai'),
        'system',
        [{ role: 'user', content: 'hi' }],
        [],
        'en',
        async (u) => void usages.push(u),
      ),
    ).rejects.toBeInstanceOf(LlmProviderError);
    expect(usages).toEqual([]);
  });
});

// #112: a non-image attachment is ANNOUNCED, never inlined. The line is built
// at request time from row metadata, so nothing is persisted and no file is
// opened to describe it.
describe('LlmClient attachment notes', () => {
  const stlMeta = {
    id: 'att_1',
    projectId: 'p1',
    filename: 'bracket.stl',
    mimeType: 'application/octet-stream',
    sizeBytes: 2048,
    isImage: false,
  };

  const clientWithMeta = (
    metaByUrl: Map<string, typeof stlMeta>,
    readSpy?: jest.Mock,
  ): LlmClient =>
    new LlmClient(
      i18n as never,
      {
        readForVisionAsBase64: readSpy ?? (async (): Promise<null> => null),
        findMetaByUrls: async (): Promise<Map<string, typeof stlMeta>> =>
          metaByUrl,
      } as never,
      new TransliterationService(),
    );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('speaks the note in place of an empty attachment message', async () => {
    const fetchMock = stubFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });
    const client = clientWithMeta(new Map([['/api/uploads/att_1', stlMeta]]));

    await client.complete(
      baseProvider('openai'),
      'system',
      [{ role: 'user', content: '', imageData: '/api/uploads/att_1' }],
      [],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages[body.messages.length - 1];
    // The i18n stub echoes keys, so the note is identifiable by its key.
    expect(userMessage.content).toBe('chat.prompt.attachedFileNote');
  });

  it('keeps the user text and appends the note when both are present', async () => {
    const fetchMock = stubFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });
    const client = clientWithMeta(new Map([['/api/uploads/att_1', stlMeta]]));

    await client.complete(
      baseProvider('openai'),
      'system',
      [
        {
          role: 'user',
          content: 'what temperature is this printed at?',
          imageData: '/api/uploads/att_1',
        },
      ],
      [],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages[body.messages.length - 1];
    expect(userMessage.content).toContain(
      'what temperature is this printed at?',
    );
    expect(userMessage.content).toContain('chat.prompt.attachedFileNote');
  });

  // A picture is in the request as pixels already — describing it again would
  // only spend tokens telling the model what it can see.
  it('does not announce a picture', async () => {
    const fetchMock = stubFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });
    const client = clientWithMeta(
      new Map([
        [
          '/api/uploads/att_2',
          { ...stlMeta, id: 'att_2', filename: 'photo.jpg', isImage: true },
        ],
      ]),
    );

    await client.complete(
      baseProvider('openai'),
      'system',
      [{ role: 'user', content: '', imageData: '/api/uploads/att_2' }],
      [],
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages[body.messages.length - 1];
    expect(userMessage.content).toBe('');
  });

  it('announces the file to Gemini and Ollama too', async () => {
    for (const provider of ['gemini', 'ollama']) {
      const fetchMock = stubFetch(
        200,
        provider === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }
          : { message: { content: 'ok' } },
      );
      const client = clientWithMeta(new Map([['/api/uploads/att_1', stlMeta]]));

      await client.complete(
        baseProvider(provider),
        'system',
        [{ role: 'user', content: '', imageData: '/api/uploads/att_1' }],
        [],
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(JSON.stringify(body)).toContain('chat.prompt.attachedFileNote');
    }
  });
});

describe('proxy request labelling (#233)', () => {
  const openAiBody = {
    choices: [{ message: { content: 'ok' } }],
  };

  // The label only ever rides in headers, so every assertion here reads them.
  const headersOf = (fn: jest.Mock): Record<string, string> =>
    (fn.mock.calls[0][1] as { headers: Record<string, string> }).headers;

  const labelled = (over: Partial<ProviderConfig>): ProviderConfig => ({
    ...baseProvider('openai'),
    proxyLabel: 'makekeeper-prod',
    proxyLabelSegments: 'label,user,project',
    ...over,
  });

  it('sends nothing while the endpoint is the vendor default', async () => {
    // The heuristic IS the proxy detection: no custom endpoint, no proxy
    // presumed, so the label stays home even though it is configured.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({ baseUrl: 'https://api.openai.com/v1' }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: 'Ремонт кухни' },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBeUndefined();
  });

  it('sends nothing when a blank baseUrl leaves the vendor default in force', async () => {
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({ baseUrl: null }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: null },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBeUndefined();
  });

  it('labels the request once the endpoint is the operator’s own', async () => {
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({ baseUrl: 'https://llm.example.internal/v1' }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: 'Ремонт кухни v2.0' },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBe(
      'makekeeper-prod.ivan.remont-kuhni-v2-0',
    );
  });

  it('carries the label in User-Agent, replacing the anonymous default', async () => {
    // Aperture's request table shows User-Agent with no admin configuration at
    // all — the one place the label is visible out of the box.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({ baseUrl: 'https://llm.example.internal/v1' }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: 'Ремонт кухни v2.0' },
    );
    expect(headersOf(fetchMock)['User-Agent']).toBe(
      'MakeKeeper (makekeeper-prod.ivan.remont-kuhni-v2-0)',
    );
  });

  it('leaves User-Agent alone while no label is sent', async () => {
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({ baseUrl: 'https://api.openai.com/v1' }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: null },
    );
    expect(headersOf(fetchMock)['User-Agent']).toBeUndefined();
  });

  it('mirrors the value into the operator-named header', async () => {
    // Aperture's header is named by the tailnet admin — unguessable, hence the field.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({
        baseUrl: 'https://llm.example.internal/v1',
        proxyHeaderName: 'x-tailnet-tag',
      }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    const headers = headersOf(fetchMock);
    expect(headers['x-tailnet-tag']).toBe('makekeeper-prod.none.none');
    expect(headers['x-litellm-tags']).toBe('makekeeper-prod.none.none');
  });

  it('cannot displace the client’s own auth header, whatever the name', async () => {
    // The structural defence: the client writes its headers last. This holds
    // even if the save-time denylist ever falls behind the code.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({
        baseUrl: 'https://llm.example.internal/v1',
        proxyHeaderName: 'Authorization',
      }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    expect(headersOf(fetchMock)['Authorization']).toBe('Bearer test-key');
  });

  it('sends nothing when the connection carries no labelling settings at all', async () => {
    // No label and no segments stored ⇒ the default single `label` segment,
    // which resolves to the placeholder ⇒ nothing worth identifying.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      { ...baseProvider('openai'), baseUrl: 'https://llm.example.internal/v1' },
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: null },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBeUndefined();
  });

  it('labels a user-only configuration, with the connection segment switched off', async () => {
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({
        baseUrl: 'https://llm.example.internal/v1',
        proxyLabel: null,
        proxyLabelSegments: 'user',
      }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: 'Иван', project: null },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBe('ivan');
  });

  it('sends nothing when every segment resolves to the placeholder', async () => {
    // A row of `none` identifies no one; better no header than a meaningless tag.
    const fetchMock = stubFetch(200, openAiBody);
    await makeClient().complete(
      labelled({
        baseUrl: 'https://llm.example.internal/v1',
        proxyLabel: '!!!',
        proxyLabelSegments: 'label,user',
      }),
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBeUndefined();
  });

  it('labels the ollama dialect too — the gate is on the connection, not the dialect', async () => {
    const fetchMock = stubFetch(200, { message: { content: 'ok' } });
    await makeClient().complete(
      {
        ...baseProvider('ollama'),
        baseUrl: 'http://gateway.example.internal:4000',
        proxyLabel: 'makekeeper-prod',
        proxyLabelSegments: 'label',
      },
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    expect(headersOf(fetchMock)['x-litellm-tags']).toBe('makekeeper-prod');
  });

  it('leaves a local ollama at its default endpoint unlabelled', async () => {
    const fetchMock = stubFetch(200, { message: { content: 'ok' } });
    await makeClient().complete(
      {
        ...baseProvider('ollama'),
        baseUrl: 'http://localhost:11434/',
        proxyLabel: 'makekeeper-prod',
        proxyLabelSegments: 'label',
      },
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      undefined,
      { user: null, project: null },
    );
    // Trailing slash and vendor default are the same endpoint.
    expect(headersOf(fetchMock)['x-litellm-tags']).toBeUndefined();
  });
});
