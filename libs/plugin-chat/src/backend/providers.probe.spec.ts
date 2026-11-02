import { Test } from '@nestjs/testing';
import {
  KeyringService,
  PrismaService,
  PluginI18nService,
  RequestContextService,
  SecretAccessService,
  SecretBoxService,
  TransliterationService,
} from '@makekeeper/backend-core';
import { ProviderService } from './providers.service';
import { LlmClient } from './llm-client';
import { LlmProviderError } from './chat.types';

// The connection test and the model list (#374). The test used to pass as
// soon as a key could list models, while every Anthropic chat turn failed;
// these cases pin the order credentials → real chat turn, and that a
// connection without a model is reported as "not checked", never as a pass.

const probe = jest.fn();

const build = async (
  aIProviderConfig: Record<string, unknown> = {},
): Promise<ProviderService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProviderService,
      TransliterationService,
      PluginI18nService,
      RequestContextService,
      { provide: PrismaService, useValue: { aIProviderConfig } },
      {
        provide: SecretBoxService,
        useValue: {
          encrypt: (v: string) => v,
          decrypt: (v: string) => v,
          isEncrypted: () => false,
        },
      },
      { provide: KeyringService, useValue: { getDek: () => null } },
      { provide: SecretAccessService, useValue: {} },
      { provide: LlmClient, useValue: { probe } },
    ],
  }).compile();
  return moduleRef.get(ProviderService);
};

const listing = (status: number, body: unknown): jest.Mock => {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};

const anthropicModels = {
  data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }],
};

beforeEach(() => probe.mockReset());
afterEach(() => jest.restoreAllMocks());

describe('ProviderService.testConnection', () => {
  it('fails at the credentials step without trying a turn', async () => {
    listing(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    const service = await build();
    const result = await service.testConnection({
      provider: 'anthropic',
      apiKey: 'bad',
      modelName: 'claude-opus-5-5',
    });
    expect(result).toEqual({
      ok: false,
      stage: 'credentials',
      reason: 'auth',
      detail: 'invalid x-api-key',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('passes only after a real chat turn succeeds', async () => {
    const fetchMock = listing(200, anthropicModels);
    probe.mockResolvedValue(undefined);
    const service = await build();
    const result = await service.testConnection({
      provider: 'anthropic',
      apiKey: 'k',
      modelName: 'claude-opus-5-5',
    });
    expect(result).toEqual({ ok: true, chat: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.anthropic.com/v1/models?limit=1000',
    );
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        apiKey: 'k',
        baseUrl: 'https://api.anthropic.com/v1',
        modelName: 'claude-opus-5-5',
      }),
      undefined,
      expect.anything(),
    );
  });

  it('reports a failed turn at the chat stage with its reason', async () => {
    listing(200, anthropicModels);
    probe.mockRejectedValue(
      new LlmProviderError('Anthropic', 404, 'model: claude-x', 'model'),
    );
    const service = await build();
    expect(
      await service.testConnection({
        provider: 'anthropic',
        apiKey: 'k',
        modelName: 'claude-x',
      }),
    ).toEqual({
      ok: false,
      stage: 'chat',
      reason: 'model',
      detail: 'model: claude-x',
    });
  });

  it('says the chat was not checked when no model is given', async () => {
    listing(200, anthropicModels);
    const service = await build();
    expect(
      await service.testConnection({ provider: 'anthropic', apiKey: 'k' }),
    ).toEqual({ ok: true, chat: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it('tries the chat on a custom gateway that has no model list', async () => {
    listing(404, 'Not Found');
    probe.mockResolvedValue(undefined);
    const service = await build();
    expect(
      await service.testConnection({
        provider: 'custom',
        baseUrl: 'https://gw.example/v1',
        modelName: 'local-model',
      }),
    ).toEqual({ ok: true, chat: true });
  });

  it('asks for a key before calling anyone', async () => {
    const fetchMock = listing(200, {});
    const service = await build();
    expect(await service.testConnection({ provider: 'openrouter' })).toEqual({
      ok: false,
      stage: 'credentials',
      reason: 'missingKey',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads an unreachable host as such', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const service = await build();
    expect(
      await service.testConnection({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        modelName: 'qwen3',
      }),
    ).toMatchObject({ ok: false, stage: 'credentials', reason: 'unreachable' });
  });
});

describe('ProviderService.listModels', () => {
  it('lists a stored connection with its stored key', async () => {
    const fetchMock = listing(200, anthropicModels);
    const service = await build({
      findUnique: jest.fn().mockResolvedValue({
        id: 'prov_1',
        ownerUserId: null,
        apiKey: 'stored-key',
      }),
    });
    expect(
      await service.listModels({ provider: 'anthropic', id: 'prov_1' }),
    ).toEqual({
      ok: true,
      models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'x-api-key': 'stored-key',
      'anthropic-version': '2026-10-21',
    });
  });

  it('refuses a private address for an untrusted caller', async () => {
    const fetchMock = listing(200, {});
    const service = await build();
    expect(
      await service.listModels(
        { provider: 'custom', baseUrl: 'http://169.254.169.254/v1' },
        undefined,
        { blockPrivateHosts: true },
      ),
    ).toEqual({ ok: false, reason: 'blockedHost' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
