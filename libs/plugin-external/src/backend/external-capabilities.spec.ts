import { ExternalCapabilitiesService } from './external-capabilities.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalSettingsService } from './external-settings.service';
import type { ExternalScopeRefService } from './external-scope-ref.service';
import type {
  CapabilityRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalSignerService } from './external-signer.service';
import type { ExternalPluginManifest } from '@makekeeper/plugin-contract';

const manifest = (
  pluginId: string,
  capabilities: Array<{ id: string; version: string }>,
): ExternalPluginManifest => ({
  contract: { major: 1, minor: 0 },
  pluginId,
  version: '1',
  nameKey: 'name',
  icon: 'Blocks',
  scopeModel: 'instance',
  permissions: [],
  i18n: { en: { name: 'X' } },
  screens: [],
  capabilities,
});

// Typed like the real signer so an ok and a failing stub are the same type.
type SignerResult = {
  ok: boolean;
  status: number;
  body: unknown;
  errorCode?: string;
};

const okPost = (): jest.Mock<Promise<SignerResult>> =>
  jest.fn(async () => ({ ok: true, status: 200, body: { result: 42 } }));

const makeService = (
  plugins: Array<{
    pluginId: string;
    capabilities: Array<{ id: string; version: string }>;
  }>,
  post: jest.Mock<Promise<SignerResult>> = okPost(),
) => {
  const registered = new Map<string, { pluginId: string; impl: object }>();
  const capabilityRegistry = {
    registerCapability: (pluginId: string, id: string, impl: object) => {
      registered.set(id, { pluginId, impl });
    },
    getCapability: <T>(id: string): T | null =>
      (registered.get(id)?.impl as T) ?? null,
  } as unknown as CapabilityRegistryService;

  const active = plugins.map((p) => ({
    pluginId: p.pluginId,
    baseUrl: `http://${p.pluginId}`,
    manifest: manifest(p.pluginId, p.capabilities),
    grants: [],
    secret: 's',
    scopeId: null,
    assistantEnabled: false,
  }));
  const registry = {
    listActive: async () => active,
    getActive: async (id: string) =>
      active.find((p) => p.pluginId === id) ?? null,
  } as unknown as ExternalRegistryService;

  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref-${scopeId}` : null,
  } as unknown as ExternalScopeRefService;
  const service = new ExternalCapabilitiesService(
    registry,
    capabilityRegistry,
    { post } as unknown as ExternalSignerService,
    new ExternalBreakerService(
      new ExternalSettingsService(
        {} as unknown as ConstructorParameters<
          typeof ExternalSettingsService
        >[0],
      ),
    ),
    { get: () => ({ locale: 'en' }) } as unknown as RequestContextService,
    scopeRefs,
  );
  return { service, registered, post, capabilityRegistry };
};

describe('ExternalCapabilitiesService', () => {
  it("publishes a capability declared under the plugin's own prefix", async () => {
    const { service, registered } = makeService([
      {
        pluginId: 'weather',
        capabilities: [{ id: 'weather.forecast', version: '1' }],
      },
    ]);
    await service.syncOffered();
    expect([...registered.keys()]).toEqual(['weather.forecast']);
    expect(registered.get('weather.forecast')?.pluginId).toBe('weather');
  });

  it("refuses a capability claiming another plugin's namespace", async () => {
    // The collision guard of decision #13: ids are namespaced, so a plugin
    // cannot squat on `chat.*` and intercept its consumers.
    const { service, registered } = makeService([
      {
        pluginId: 'weather',
        capabilities: [{ id: 'chat.vision-completion', version: '1' }],
      },
    ]);
    await service.syncOffered();
    expect(registered.size).toBe(0);
  });

  it("relays a consumer's method call to the owning container", async () => {
    const { service, registered, post } = makeService([
      {
        pluginId: 'weather',
        capabilities: [{ id: 'weather.forecast', version: '1' }],
      },
    ]);
    await service.syncOffered();
    const impl = registered.get('weather.forecast')?.impl as {
      lookup: (city: string) => Promise<unknown>;
    };
    await expect(impl.lookup('Berlin')).resolves.toBe(42);
    const [baseUrl, , path, body] = post.mock.calls[0] as unknown as [
      string,
      string,
      string,
      { capability: string; method: string; args: unknown[] },
    ];
    expect(baseUrl).toBe('http://weather');
    expect(path).toBe('/mk/capability');
    expect(body).toMatchObject({
      capability: 'weather.forecast',
      method: 'lookup',
      args: ['Berlin'],
    });
  });

  it('degrades a failed relay to null, matching the "feature absent" contract', async () => {
    const post: jest.Mock<Promise<SignerResult>> = jest.fn(async () => ({
      ok: false,
      status: 500,
      body: null,
      errorCode: 'http',
    }));
    const { service, registered } = makeService(
      [
        {
          pluginId: 'weather',
          capabilities: [{ id: 'weather.forecast', version: '1' }],
        },
      ],
      post,
    );
    await service.syncOffered();
    const impl = registered.get('weather.forecast')?.impl as {
      lookup: () => Promise<unknown>;
    };
    await expect(impl.lookup()).resolves.toBeNull();
  });

  it('answers an unknown capability and a failing owner identically to the consumer', async () => {
    const { service, capabilityRegistry } = makeService([]);
    await service.syncOffered();
    await expect(
      service.invokeForExternal({
        capability: 'nobody.here',
        method: 'x',
        args: [],
      }),
    ).resolves.toEqual({ ok: false, error: 'unknown-capability' });

    // An owner whose method throws must not leak its failure shape either.
    (
      capabilityRegistry as unknown as {
        getCapability: (id: string) => unknown;
      }
    ).getCapability = () => ({
      boom: async () => {
        throw new Error('internal detail');
      },
    });
    await expect(
      service.invokeForExternal({
        capability: 'a.b',
        method: 'boom',
        args: [],
      }),
    ).resolves.toEqual({ ok: false, error: 'failed' });
  });
});
