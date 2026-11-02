import { TransliterationService } from '@makekeeper/backend-core';
import { AgentTool, PermissionLevel } from '@makekeeper/plugin-contract';
import { LlmClient } from './llm-client';
import {
  HistoryMessage,
  LlmProviderError,
  LlmUsage,
  ProviderConfig,
} from './chat.types';

// Request shapes per dialect (#374). Every vendor field asserted here was
// checked against the vendor's official SDK types (openai 7.47,
// @anthropic-ai/sdk 1.3, @google/genai 2.32, ollama 0.6.4,
// @openrouter/sdk 1.5) — no live keys were available, so these tests are the
// contract the code is held to.

const i18n = {
  t: (key: string): string => key,
  resolveTool: (tool: AgentTool) => ({
    name: tool.name,
    description: tool.descriptionKey,
    parameters: tool.parameters,
  }),
};

// One stored picture, served as the vision rendition.
const attachments = {
  readForVisionAsBase64: async (
    url: string,
  ): Promise<{ mimeType: string; data: string } | null> =>
    url === '/api/uploads/img'
      ? { mimeType: 'image/jpeg', data: 'QUJD' }
      : null,
  findMetaByUrls: async (): Promise<Map<string, unknown>> => new Map(),
};

const client = (): LlmClient =>
  new LlmClient(
    i18n as never,
    attachments as never,
    new TransliterationService(),
  );

const config = (
  provider: string,
  extra: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  provider,
  apiKey: 'test-key',
  baseUrl: null,
  modelName: 'test-model',
  organizationId: null,
  apiVersion: null,
  imageDetail: null,
  reasoningEffort: null,
  ...extra,
});

const tool: AgentTool = {
  name: 'find_item',
  descriptionKey: 'inventory.tools.findItem',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', descriptionKey: 'q' } },
    required: ['query'],
  },
  permission: PermissionLevel.READ,
  pluginId: 'inventory',
  pluginLabelKey: 'plugins.inventory.name',
  handler: async () => null,
};

interface Reply {
  status: number;
  body: unknown;
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

// Walks a parsed JSON body; undefined as soon as the path leaves it.
const at = (value: unknown, ...path: Array<string | number>): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? Reflect.get(node, key)
        : undefined,
    value,
  );

// Answers the calls in order (the last reply repeats) and records each request.
function stubFetch(...replies: Reply[]): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const reply = replies[Math.min(i++, replies.length - 1)];
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const text =
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return { calls };
}

// A finished tool round: the call, its result, then the user's follow-up.
const toolRound: HistoryMessage[] = [
  { role: 'user', content: 'where are the M3 screws?' },
  {
    role: 'assistant',
    content: JSON.stringify({
      type: 'tool_call',
      name: 'find_item',
      args: { query: 'M3' },
    }),
  },
  {
    role: 'user',
    content: JSON.stringify({
      type: 'tool_response',
      name: 'find_item',
      response: { found: 1 },
    }),
  },
];

afterEach(() => jest.restoreAllMocks());

describe('Anthropic Messages API', () => {
  const ok = {
    status: 200,
    body: {
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'In box A3.' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
      },
    },
  };

  it('sends a Messages request the API accepts', async () => {
    const { calls } = stubFetch(ok);
    const usages: LlmUsage[] = [];
    const result = await client().complete(
      config('anthropic'),
      'SYSTEM',
      toolRound,
      [tool],
      'en',
      async (u) => void usages.push(u),
    );

    expect(result).toBe('In box A3.');
    expect(usages).toEqual([
      { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
    ]);
    const [call] = calls;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('test-key');
    expect(call.headers['anthropic-version']).toBe('2026-10-21');
    expect(at(call.body, 'model')).toBe('test-model');
    expect(at(call.body, 'max_tokens')).toBeGreaterThan(0);
    expect(at(call.body, 'system')).toBe('SYSTEM');
    expect(at(call.body, 'tools')).toEqual([
      {
        name: 'find_item',
        description: 'inventory.tools.findItem',
        input_schema: tool.parameters,
      },
    ]);
    expect(at(call.body, 'tool_choice')).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
    // tool_use in the assistant turn, its tool_result in the next user turn,
    // matched by id.
    expect(at(call.body, 'messages')).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'where are the M3 screws?' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'find_item',
            input: { query: 'M3' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: '{"found":1}',
          },
        ],
      },
    ]);
  });

  it('returns a tool_use block as a tool call', async () => {
    stubFetch({
      status: 200,
      body: {
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'find_item',
            input: { query: 'M3' },
          },
        ],
        stop_reason: 'tool_use',
      },
    });
    const result = await client().complete(
      config('anthropic'),
      's',
      [{ role: 'user', content: 'find M3' }],
      [tool],
    );
    expect(result).toEqual({
      isToolCall: true,
      callId: 'toolu_1',
      name: 'find_item',
      args: { query: 'M3' },
    });
  });

  it('turns an orphaned tool result into text instead of a 400', async () => {
    // What the agent loop stores when the model calls an unregistered tool:
    // a result with no call before it.
    const { calls } = stubFetch(ok);
    await client().complete(
      config('anthropic'),
      's',
      [
        { role: 'user', content: 'hi' },
        {
          role: 'user',
          content: JSON.stringify({
            type: 'tool_response',
            name: 'gone',
            response: { error: 'x' },
          }),
        },
      ],
      [],
    );
    expect(at(calls[0].body, 'messages')).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'text', text: 'chat.prompt.functionResultNote' },
        ],
      },
    ]);
    expect(at(calls[0].body, 'tools')).toBeUndefined();
  });

  it('inlines a picture as a base64 image block before the text', async () => {
    const { calls } = stubFetch(ok);
    await client().complete(
      config('anthropic'),
      's',
      [
        {
          role: 'user',
          content: 'what is this?',
          imageData: '/api/uploads/img',
        },
      ],
      [],
    );
    expect(at(calls[0].body, 'messages', 0, 'content')).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
      },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('reports a rejected key as an auth failure', async () => {
    stubFetch({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });
    const err = await client()
      .complete(config('anthropic'), 's', [{ role: 'user', content: 'x' }], [])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err).toMatchObject({
      provider: 'Anthropic',
      status: 401,
      reason: 'auth',
      message: 'invalid x-api-key',
    });
  });
});

describe('OpenAI-compatible dialect', () => {
  const ok = {
    status: 200,
    body: { choices: [{ message: { content: 'done' } }] },
  };

  it('pairs tool calls with results by a shared id', async () => {
    const { calls } = stubFetch(ok);
    await client().complete(config('openai'), 's', toolRound, [tool]);
    expect(at(calls[0].body, 'messages', 2, 'tool_calls', 0, 'id')).toBe(
      'call_1',
    );
    expect(at(calls[0].body, 'messages', 3)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"found":1}',
    });
  });

  it('calls a custom gateway with the OpenAI dialect (it used to throw)', async () => {
    const { calls } = stubFetch(ok);
    const result = await client().complete(
      config('custom', { apiKey: null, baseUrl: 'https://gw.example/v1/' }),
      's',
      [{ role: 'user', content: 'hi' }],
      [],
    );
    expect(result).toBe('done');
    expect(calls[0].url).toBe('https://gw.example/v1/chat/completions');
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  it('calls OpenRouter with its endpoint and attribution headers', async () => {
    const { calls } = stubFetch(ok);
    await client().complete(
      config('openrouter', { modelName: 'anthropic/claude-sonnet-5.5' }),
      's',
      [{ role: 'user', content: 'hi' }],
      [tool],
    );
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'HTTP-Referer': 'https://github.com/makekeeper/makekeeper',
      'X-OpenRouter-Title': 'MakeKeeper',
    });
    expect(at(calls[0].body, 'model')).toBe('anthropic/claude-sonnet-5.5');
  });

  it('survives malformed tool-call arguments', async () => {
    stubFetch({
      status: 200,
      body: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'c1',
                  function: { name: 'find_item', arguments: '{bad' },
                },
              ],
            },
          },
        ],
      },
    });
    const result = await client().complete(
      config('openai'),
      's',
      [{ role: 'user', content: 'x' }],
      [tool],
    );
    expect(result).toEqual({
      isToolCall: true,
      callId: 'c1',
      name: 'find_item',
      args: {},
    });
  });
});

describe('Gemini generateContent', () => {
  it('sends the key as a header, the prompt as systemInstruction and results as user turns', async () => {
    const { calls } = stubFetch({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    });
    await client().complete(config('gemini'), 'SYSTEM', toolRound, [tool]);
    const [call] = calls;
    expect(call.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
    );
    expect(call.url).not.toContain('key=');
    expect(call.headers['x-goog-api-key']).toBe('test-key');
    expect(at(call.body, 'systemInstruction')).toEqual({
      parts: [{ text: 'SYSTEM' }],
    });
    // Only `user` and `model` roles exist in the Gemini API.
    expect(at(call.body, 'contents', 0, 'role')).toBe('user');
    expect(at(call.body, 'contents', 1, 'role')).toBe('model');
    expect(at(call.body, 'contents', 2, 'role')).toBe('user');
    expect(at(call.body, 'contents', 3)).toBeUndefined();
    expect(
      at(call.body, 'contents', 2, 'parts', 0, 'functionResponse', 'name'),
    ).toBe('find_item');
  });
});

describe('Ollama /api/chat', () => {
  it('offers tools natively and reads tool_calls back', async () => {
    const { calls } = stubFetch({
      status: 200,
      body: {
        message: {
          content: '',
          tool_calls: [
            { function: { name: 'find_item', arguments: { query: 'M3' } } },
          ],
        },
      },
    });
    const result = await client().complete(
      config('ollama', { apiKey: null, baseUrl: 'http://localhost:11434' }),
      's',
      toolRound,
      [tool],
    );
    expect(result).toEqual({
      isToolCall: true,
      name: 'find_item',
      args: { query: 'M3' },
    });
    const body = calls[0].body;
    expect(at(body, 'tools', 0, 'function', 'name')).toBe('find_item');
    expect(at(body, 'messages', 2)).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { function: { name: 'find_item', arguments: { query: 'M3' } } },
      ],
    });
    expect(at(body, 'messages', 3)).toEqual({
      role: 'tool',
      tool_name: 'find_item',
      content: '{"found":1}',
    });
  });

  it('retries without tools when the model has no tool support', async () => {
    const { calls } = stubFetch(
      {
        status: 400,
        body: {
          error: 'registry.ollama.ai/library/gemma:2b does not support tools',
        },
      },
      { status: 200, body: { message: { content: 'plain answer' } } },
    );
    const result = await client().complete(
      config('ollama', { apiKey: null, baseUrl: 'http://localhost:11434' }),
      's',
      toolRound,
      [tool],
    );
    expect(result).toBe('plain answer');
    expect(calls).toHaveLength(2);
    expect(at(calls[1].body, 'tools')).toBeUndefined();
    // The tool round falls back to the text notes models without tools read.
    expect(at(calls[1].body, 'messages', 2, 'content')).toBe(
      'chat.prompt.functionCallNote',
    );
  });

  it('reports an unreachable server as a provider failure', async () => {
    global.fetch = jest.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
      });
    }) as unknown as typeof fetch;
    const err = await client()
      .complete(
        config('ollama', { apiKey: null, baseUrl: 'http://localhost:11434' }),
        's',
        [{ role: 'user', content: 'x' }],
        [],
      )
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      provider: 'Ollama',
      status: 0,
      reason: 'unreachable',
    });
  });
});

describe('probe', () => {
  it('runs one real turn with a tool attached', async () => {
    const { calls } = stubFetch({
      status: 200,
      body: { content: [{ type: 'text', text: 'OK' }] },
    });
    await client().probe(config('anthropic'));
    expect(calls).toHaveLength(1);
    expect(at(calls[0].body, 'tools', 0, 'name')).toBe('connection_check');
    expect(at(calls[0].body, 'messages', 0, 'content', 0, 'text')).toBe(
      'chat.prompt.connectionProbe',
    );
  });
});
