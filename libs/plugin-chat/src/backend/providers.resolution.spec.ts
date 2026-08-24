import { Test } from '@nestjs/testing';
import {
  KeyringService,
  PluginI18nService,
  PrismaService,
  RequestContextService,
  SecretAccessService,
  SecretBoxService,
  TransliterationService,
} from '@makekeeper/backend-core';
import { ProviderService } from './providers.service';

// The owner-controlled credential-resolution chain: personal → workspace
// owner's shared → instance (visibility-gated). Single-user mode must stay
// byte-identical to the pre-feature behavior (instance default).
describe('ProviderService.resolveActiveConfig', () => {
  let service: ProviderService;
  let requestContext: RequestContextService;
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;

  // Rows keyed by intent; findFirst picks by simplified where-matching.
  const rows = {
    instance: {
      id: 'i1',
      name: 'Instance',
      ownerUserId: null,
      isDefault: true,
      sharedWith: 'everyone',
    },
    instancePrivate: {
      id: 'i2',
      name: 'InstancePrivate',
      ownerUserId: null,
      isDefault: true,
      sharedWith: 'none',
    },
    personal: {
      id: 'p1',
      name: 'Personal',
      ownerUserId: 'me',
      isDefault: true,
      sharedWith: 'none',
    },
    ownersShared: {
      id: 'o1',
      name: 'OwnersShared',
      ownerUserId: 'owner',
      isDefault: true,
      sharedWith: 'workspace-guests',
    },
  };

  beforeEach(async () => {
    findFirst = jest.fn().mockResolvedValue(null);
    findUnique = jest.fn().mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        TransliterationService,
        PluginI18nService,
        RequestContextService,
        {
          provide: PrismaService,
          useValue: {
            aIProviderConfig: { findFirst },
            user: { findUnique },
          },
        },
        // Secret layer (#63) is exercised in dedicated specs; resolution tests
        // only need it present. isEncrypted:false keeps stored keys treated as
        // legacy plaintext, so the resolved config is byte-identical to before.
        {
          provide: SecretBoxService,
          useValue: {
            isEncrypted: () => false,
            decrypt: (v: string) => v,
            encrypt: (v: string) => v,
          },
        },
        { provide: KeyringService, useValue: { getDek: () => null } },
        {
          provide: SecretAccessService,
          useValue: { recordOutOfSessionUse: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(ProviderService);
    requestContext = moduleRef.get(RequestContextService);
  });

  const whereOf = (call: number): Record<string, unknown> =>
    findFirst.mock.calls[call][0].where;

  it('single-user mode: instance default, no visibility filter', async () => {
    findFirst.mockResolvedValueOnce(rows.instance);
    const result = await service.resolveActiveConfig();
    expect(result?.id).toBe('i1');
    expect(whereOf(0)).toEqual({ ownerUserId: null, isDefault: true });
  });

  it('prefers the caller’s own connection', async () => {
    findFirst.mockResolvedValueOnce(rows.personal);
    const result = await requestContext.run(
      { userId: 'me', scopeId: 'me' },
      () => service.resolveActiveConfig(),
    );
    expect(result?.id).toBe('p1');
    expect(whereOf(0)).toEqual({ ownerUserId: 'me', isDefault: true });
  });

  it('in a foreign workspace the owner’s guest-shared connection outranks the instance one', async () => {
    findFirst
      .mockResolvedValueOnce(null) // no personal
      .mockResolvedValueOnce(rows.ownersShared);
    const result = await requestContext.run(
      { userId: 'me', scopeId: 'owner' },
      () => service.resolveActiveConfig(),
    );
    expect(result?.id).toBe('o1');
    expect(whereOf(1)).toEqual({
      ownerUserId: 'owner',
      sharedWith: 'workspace-guests',
    });
  });

  it('an admin-owned workspace shares its guest-marked INSTANCE connections', async () => {
    findFirst
      .mockResolvedValueOnce(null) // no personal of the guest
      .mockResolvedValueOnce(null) // no personal guest-shared rows of the owner
      .mockResolvedValueOnce({
        id: 'ig',
        name: 'InstanceGuests',
        ownerUserId: null,
        isDefault: false,
        sharedWith: 'workspace-guests',
      });
    findUnique.mockResolvedValueOnce({ isAdmin: true });
    const result = await requestContext.run(
      { userId: 'me', scopeId: 'admin' },
      () => service.resolveActiveConfig(),
    );
    expect(result?.id).toBe('ig');
    expect(whereOf(2)).toEqual({
      ownerUserId: null,
      sharedWith: 'workspace-guests',
    });
  });

  it('regular users without their own fall back to instance connections shared with everyone', async () => {
    findFirst
      .mockResolvedValueOnce(null) // no personal
      .mockResolvedValueOnce(rows.instance);
    const result = await requestContext.run(
      { userId: 'me', scopeId: 'me', isAdmin: false },
      () => service.resolveActiveConfig(),
    );
    expect(result?.id).toBe('i1');
    expect(whereOf(1)).toEqual({
      ownerUserId: null,
      isDefault: true,
      sharedWith: 'everyone',
    });
  });

  it('admins reach the instance default regardless of its sharing level', async () => {
    findFirst
      .mockResolvedValueOnce(null) // no personal
      .mockResolvedValueOnce(rows.instancePrivate);
    const result = await requestContext.run(
      { userId: 'root', scopeId: 'root', isAdmin: true },
      () => service.resolveActiveConfig(),
    );
    expect(result?.id).toBe('i2');
    expect(whereOf(1)).toEqual({ ownerUserId: null, isDefault: true });
  });
});
