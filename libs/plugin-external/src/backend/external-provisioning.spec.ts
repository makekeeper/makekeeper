import { ExternalProvisioningService } from './external-provisioning.service';
import type {
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalTokensService } from './external-tokens.service';
import type { ExternalScopeRefService } from './external-scope-ref.service';
import type { ExternalPluginManifest } from '@makekeeper/plugin-contract';

const manifest = (
  scopeModel: 'instance' | 'per-scope',
): ExternalPluginManifest => ({
  contract: { major: 1, minor: 0 },
  pluginId: 'demo',
  version: '1',
  nameKey: 'name',
  icon: 'Blocks',
  scopeModel,
  permissions: [],
  i18n: { en: { name: 'Demo' } },
  screens: [],
});

const makeService = (opts: {
  scopeModel: 'instance' | 'per-scope';
  grants: string[];
  users: string[];
  boundScopeId?: string | null;
}) => {
  const issued: Array<{ cls: string; scopeId: string | null }> = [];
  const revoked: string[] = [];
  const tokens = {
    revokeBackgroundForPlugin: async (pluginId: string) => {
      revoked.push(pluginId);
    },
    issueBackground: async (
      _pluginId: string,
      cls: string,
      scopeId: string | null,
    ) => {
      issued.push({ cls, scopeId });
      return `tok-${cls}-${scopeId ?? 'none'}`;
    },
  } as unknown as ExternalTokensService;

  const registry = {
    getActive: async () => ({
      pluginId: 'demo',
      baseUrl: 'http://demo',
      manifest: manifest(opts.scopeModel),
      grants: opts.grants,
      secret: 's',
      scopeId: opts.boundScopeId ?? null,
      assistantEnabled: false,
    }),
  } as unknown as ExternalRegistryService;

  const prisma = {
    user: { findMany: async () => opts.users.map((id) => ({ id })) },
  } as unknown as PrismaService;
  const context = {
    runWithoutScope: <T>(_r: string, fn: () => Promise<T>) => fn(),
  } as unknown as RequestContextService;

  // The plugin-facing scope reference is opaque (decision #5): the stub makes
  // the translation visible so the assertions can prove raw ids never leak.
  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref-${scopeId}` : null,
  } as unknown as ExternalScopeRefService;

  return {
    service: new ExternalProvisioningService(
      prisma,
      registry,
      tokens,
      context,
      scopeRefs,
    ),
    issued,
    revoked,
  };
};

describe('ExternalProvisioningService', () => {
  it('revokes the previous background tokens before minting new ones', async () => {
    const { service, revoked } = makeService({
      scopeModel: 'instance',
      grants: [],
      users: [],
    });
    await service.provision('demo');
    // A token must never outlive the grant state it was minted under.
    expect(revoked).toEqual(['demo']);
  });

  it('gives a single-user instance one implicit scope', async () => {
    const { service, issued } = makeService({
      scopeModel: 'instance',
      grants: ['inventory:read'],
      users: [],
    });
    const result = await service.provision('demo');
    expect(issued).toEqual([{ cls: 'background-scoped', scopeId: null }]);
    expect(result?.scoped).toEqual([
      { scopeId: null, token: 'tok-background-scoped-none' },
    ]);
    expect(result?.instance).toBeNull();
  });

  it('binds an `instance` plugin to exactly one scope, even with many users', async () => {
    const { service, issued } = makeService({
      scopeModel: 'instance',
      grants: [],
      users: ['u1', 'u2', 'u3'],
      boundScopeId: 'u2',
    });
    await service.provision('demo');
    expect(issued).toEqual([{ cls: 'background-scoped', scopeId: 'u2' }]);
  });

  it('gives a `per-scope` plugin one token per scope', async () => {
    const { service, issued } = makeService({
      scopeModel: 'per-scope',
      grants: [],
      users: ['u1', 'u2'],
    });
    const result = await service.provision('demo');
    expect(issued).toEqual([
      { cls: 'background-scoped', scopeId: 'u1' },
      { cls: 'background-scoped', scopeId: 'u2' },
    ]);
    // The PLUGIN sees opaque references; the token rows keep the raw ids.
    expect(result?.scoped.map((s) => s.scopeId)).toEqual(['ref-u1', 'ref-u2']);
  });

  it('adds an instance token only when an instance grant exists', async () => {
    const without = makeService({
      scopeModel: 'instance',
      grants: ['inventory:read'],
      users: ['u1'],
    });
    expect((await without.service.provision('demo'))?.instance).toBeNull();

    const with_ = makeService({
      scopeModel: 'instance',
      grants: ['instance:inventory:read'],
      users: ['u1'],
    });
    const result = await with_.service.provision('demo');
    expect(result?.instance).toBe('tok-background-instance-none');
    expect(with_.issued).toContainEqual({
      cls: 'background-instance',
      scopeId: null,
    });
  });
});
