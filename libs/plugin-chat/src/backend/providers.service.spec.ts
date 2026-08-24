import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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

// One stand for every describe here: the only thing that varies between them is
// which `aIProviderConfig` methods the case under test reaches for.
// `PluginI18nService`/`RequestContextService` are the real (dependency-free)
// resolvers; `SecretBoxService` encrypts by identity so a test can assert on the
// stored apiKey directly — the crypto itself is covered by crypto-box.spec.
const buildService = async (
  aIProviderConfig: Record<string, unknown>,
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
      {
        provide: SecretAccessService,
        useValue: { recordOutOfSessionUse: jest.fn() },
      },
    ],
  }).compile();
  return moduleRef.get(ProviderService);
};

// The `data` Prisma was asked to write — the assertion target throughout, since
// these tests are about what gets persisted, not what comes back.
const writtenData = (mock: jest.Mock): Record<string, unknown> =>
  mock.mock.calls[0][0].data;

// Covers the imageDetail/reasoningEffort normalization added for #13: the
// "auto"/"default" sentinels collapse to null, an explicit level is stored, and
// both fields are dropped for providers that don't use them (non-openai).
describe('ProviderService — imageDetail/reasoningEffort normalization', () => {
  let service: ProviderService;
  let createMock: jest.Mock;

  beforeEach(async () => {
    // Echo back the row Prisma was asked to create so toPublic can project it.
    createMock = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ apiKey: null, ...args.data }),
    );
    service = await buildService({
      create: createMock,
      count: jest.fn().mockResolvedValue(1),
    });
  });

  const written = (): Record<string, unknown> => writtenData(createMock);

  it('stores an explicit "high" detail and reasoning level for openai', async () => {
    await service.create({
      name: 'o',
      provider: 'openai',
      apiKey: 'k',
      modelName: 'gpt-5',
      imageDetail: 'high',
      reasoningEffort: 'high',
    });
    expect(written().imageDetail).toBe('high');
    expect(written().reasoningEffort).toBe('high');
  });

  it('collapses the "auto"/"default" sentinels to null', async () => {
    await service.create({
      name: 'o',
      provider: 'openai',
      apiKey: 'k',
      modelName: 'gpt-5',
      imageDetail: 'auto',
      reasoningEffort: 'default',
    });
    expect(written().imageDetail).toBeNull();
    expect(written().reasoningEffort).toBeNull();
  });

  it('drops both fields for a provider that does not use them', async () => {
    await service.create({
      name: 'g',
      provider: 'gemini',
      apiKey: 'k',
      modelName: 'gemini-2.5-flash',
      imageDetail: 'high',
      reasoningEffort: 'high',
    });
    expect(written().imageDetail).toBeNull();
    expect(written().reasoningEffort).toBeNull();
  });
});

// Covers #220: an optional field the user emptied must actually be cleared,
// while a blank apiKey keeps its "leave the stored secret alone" meaning and a
// partial PATCH (the sharing switches) still leaves untouched fields intact.
describe('ProviderService — clearing optional fields on update', () => {
  let service: ProviderService;
  let updateMock: jest.Mock;

  // A saved OpenAI connection with every optional field populated.
  const existingRow = {
    id: 'prov_1',
    name: 'o',
    provider: 'openai',
    apiKey: 'stored-cipher',
    baseUrl: 'https://proxy.example/v1',
    modelName: 'gpt-5',
    organizationId: 'org-123',
    apiVersion: null,
    imageDetail: null,
    reasoningEffort: null,
    isDefault: true,
    ownerUserId: null,
    sharedWith: 'everyone',
  };

  beforeEach(async () => {
    updateMock = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existingRow, ...args.data }),
    );
    service = await buildService({
      findUnique: jest.fn().mockResolvedValue(existingRow),
      update: updateMock,
    });
  });

  const written = (): Record<string, unknown> => writtenData(updateMock);

  it('clears an emptied organizationId instead of keeping the stored one', async () => {
    await service.update('prov_1', { organizationId: '' });
    expect(written().organizationId).toBeNull();
  });

  it('clears an emptied apiVersion for anthropic', async () => {
    await service.update('prov_1', { provider: 'anthropic', apiVersion: '' });
    expect(written().apiVersion).toBeNull();
  });

  it('stores an emptied baseUrl as null, not as a blank string', async () => {
    await service.update('prov_1', { baseUrl: '   ' });
    expect(written().baseUrl).toBeNull();
  });

  it('keeps the stored value for a field the caller omitted entirely', async () => {
    // The sharing switches PATCH `sharedWith` alone — nothing else may change.
    await service.update('prov_1', { sharedWith: 'none' });
    expect(written().organizationId).toBe('org-123');
    expect(written().baseUrl).toBe('https://proxy.example/v1');
    expect(written().apiKey).toBe('stored-cipher');
  });

  it('keeps the stored secret when the apiKey is blank or omitted', async () => {
    await service.update('prov_1', { apiKey: '', organizationId: '' });
    expect(written().apiKey).toBe('stored-cipher');
  });

  it('removes the stored secret on an explicit null', async () => {
    await service.update('prov_1', { provider: 'custom', apiKey: null });
    expect(written().apiKey).toBeNull();
  });

  it('refuses to remove the key of a provider that requires one', async () => {
    await expect(service.update('prov_1', { apiKey: null })).rejects.toThrow(
      BadRequestException,
    );
  });
});
