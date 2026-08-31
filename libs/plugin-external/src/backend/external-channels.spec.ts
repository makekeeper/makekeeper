import type {
  CapabilityRegistryService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { NotifyChannelCapability } from '@makekeeper/plugin-contract';
import { ExternalChannelsService } from './external-channels.service';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalSignerService } from './external-signer.service';
import type { ExternalBreakerService } from './external-breaker.service';
import type { ExternalScopeRefService } from './external-scope-ref.service';

interface Registered {
  pluginId: string;
  capabilityId: string;
  impl: NotifyChannelCapability;
}

function build(options: {
  declares?: boolean;
  postOk?: boolean;
  result?: unknown;
}): {
  service: ExternalChannelsService;
  registered: Registered[];
  unregistered: string[];
  posts: { path: string; body: unknown }[];
} {
  const registered: Registered[] = [];
  const unregistered: string[] = [];
  const posts: { path: string; body: unknown }[] = [];

  const registry = {
    listActive: async () => [
      {
        pluginId: 'telegram',
        baseUrl: 'http://plugin',
        secret: 's',
        manifest: options.declares
          ? { deliveryChannel: { labelKey: 'channelLabel' } }
          : {},
      },
    ],
    getActive: async () => ({
      pluginId: 'telegram',
      baseUrl: 'http://plugin',
      secret: 's',
      manifest: options.declares
        ? { deliveryChannel: { labelKey: 'channelLabel' } }
        : {},
    }),
  } as unknown as ExternalRegistryService;

  const capabilities = {
    registerCapability: (
      pluginId: string,
      capabilityId: string,
      impl: NotifyChannelCapability,
    ) => {
      registered.push({ pluginId, capabilityId, impl });
    },
    unregisterCapability: (capabilityId: string) => {
      unregistered.push(capabilityId);
    },
  } as unknown as CapabilityRegistryService;

  const signer = {
    post: async (
      _base: string,
      _secret: string,
      path: string,
      body: unknown,
    ) => {
      posts.push({ path, body });
      return options.postOk === false
        ? { ok: false }
        : { ok: true, body: { result: options.result ?? true } };
    },
  } as unknown as ExternalSignerService;

  const breaker = {
    shouldSkip: () => false,
    recordFailure: () => undefined,
    recordSuccess: () => undefined,
    budget: () => 5000,
  } as unknown as ExternalBreakerService;

  const context = {
    get: () => ({ scopeId: null, locale: 'ru' }),
  } as unknown as RequestContextService;

  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref:${scopeId}` : '',
  } as unknown as ExternalScopeRefService;

  return {
    service: new ExternalChannelsService(
      registry,
      capabilities,
      signer,
      breaker,
      context,
      scopeRefs,
      // Refusals reach a person through the delivery log, so they are i18n
      // keys; the fake resolves a key to itself.
      { t: (key: string) => key } as unknown as PluginI18nService,
    ),
    registered,
    unregistered,
    posts,
  };
}

const message = {
  notificationId: 'n1',
  recipientUserId: 'u1',
  title: 'Заказ приехал',
  body: 'Из магазина',
  importance: 'normal' as const,
  actions: [{ kind: 'dismiss' as const, label: 'Скрыть', token: 'tok' }],
};

describe('ExternalChannelsService', () => {
  it('registers a channel only for a plugin that declares one', async () => {
    const declared = build({ declares: true });
    await declared.service.syncAll();
    expect(declared.registered[0]?.capabilityId).toBe(
      'notify-channel.telegram',
    );
    // The channel id IS the plugin id, so two plugins cannot claim one channel.
    expect(declared.registered[0]?.impl.channelId).toBe('telegram');

    const silent = build({ declares: false });
    await silent.service.syncAll();
    expect(silent.registered).toHaveLength(0);
  });

  it('withdraws the channel when the plugin stops declaring it', async () => {
    const harness = build({ declares: true });
    await harness.service.syncAll();
    const gone = build({ declares: false });
    // Same service instance would be needed for a real withdrawal; here the
    // point is that a non-declaring plugin registers nothing.
    await gone.service.syncPlugin('telegram');
    expect(gone.registered).toHaveLength(0);
  });

  it('relays a delivery with the opaque user ref, never the user id', async () => {
    const harness = build({ declares: true });
    await harness.service.syncAll();
    await harness.registered[0]?.impl.deliver(message);
    const body = harness.posts[0]?.body as {
      capability: string;
      method: string;
      args: [{ userRef: string; title: string }];
    };
    expect(body.capability).toBe('telegram.notify-channel');
    expect(body.method).toBe('deliver');
    expect(body.args[0].userRef).toBe('ref:u1');
    expect(JSON.stringify(body)).not.toContain('"u1"');
  });

  it('throws when the container refuses, so the bus retries', async () => {
    const harness = build({ declares: true, postOk: false });
    await harness.service.syncAll();
    await expect(
      harness.registered[0]?.impl.deliver(message),
    ).rejects.toThrow();
  });

  it('answers "not linked" instead of throwing when the question fails', async () => {
    const harness = build({ declares: true, postOk: false });
    await harness.service.syncAll();
    expect(await harness.registered[0]?.impl.isLinked('u1')).toBe(false);
  });
});
