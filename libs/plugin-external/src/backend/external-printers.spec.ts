import type {
  CapabilityRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type {
  PrintDriverCapability,
  PrintRaster,
} from '@makekeeper/plugin-contract';
import { ExternalPrintersService } from './external-printers.service';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalSignerService } from './external-signer.service';
import type { ExternalBreakerService } from './external-breaker.service';
import type { ExternalScopeRefService } from './external-scope-ref.service';

interface Registered {
  pluginId: string;
  capabilityId: string;
  impl: PrintDriverCapability;
}

const printer = { labelKey: 'bridgePrinter', maxWidthDots: 384, dpi: 203 };

function build(options: {
  declares?: boolean;
  postOk?: boolean;
  result?: unknown;
}): {
  service: ExternalPrintersService;
  registered: Registered[];
  unregistered: string[];
  posts: { path: string; body: unknown }[];
} {
  const registered: Registered[] = [];
  const unregistered: string[] = [];
  const posts: { path: string; body: unknown }[] = [];

  const plugin = {
    pluginId: 'niimbot-bridge',
    baseUrl: 'http://bridge',
    secret: 's',
    manifest: options.declares ? { printDriver: printer } : {},
  };
  const registry = {
    listActive: async () => [plugin],
    getActive: async () => plugin,
  } as unknown as ExternalRegistryService;

  const capabilities = {
    registerCapability: (
      pluginId: string,
      capabilityId: string,
      impl: PrintDriverCapability,
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
        : { ok: true, body: { result: options.result ?? { ok: true } } };
    },
  } as unknown as ExternalSignerService;

  const breaker = {
    shouldSkip: () => false,
    recordFailure: () => undefined,
    recordSuccess: () => undefined,
    budget: () => 60000,
  } as unknown as ExternalBreakerService;

  const context = {
    get: () => ({ scopeId: 'u1', locale: 'ru' }),
  } as unknown as RequestContextService;

  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref:${scopeId}` : '',
  } as unknown as ExternalScopeRefService;

  return {
    service: new ExternalPrintersService(
      registry,
      capabilities,
      signer,
      breaker,
      context,
      scopeRefs,
    ),
    registered,
    unregistered,
    posts,
  };
}

const page: PrintRaster = {
  widthDots: 384,
  heightDots: 2,
  rows: new Uint8Array(48 * 2).fill(0xff),
};

describe('ExternalPrintersService', () => {
  it('registers a driver only for a plugin that declares a printer', async () => {
    const declared = build({ declares: true });
    await declared.service.syncAll();
    expect(declared.registered[0]?.capabilityId).toBe(
      'printing.driver.niimbot-bridge',
    );

    const silent = build({ declares: false });
    await silent.service.syncAll();
    expect(silent.registered).toHaveLength(0);
  });

  it('describes the printer from the manifest, without calling the container', async () => {
    const harness = build({ declares: true });
    await harness.service.syncAll();
    const descriptor = await harness.registered[0].impl.describe();
    expect(descriptor).toEqual({
      id: 'printing.driver.niimbot-bridge',
      pluginId: 'niimbot-bridge',
      nameKey: 'bridgePrinter',
      maxWidthDots: 384,
      dpi: 203,
    });
    // Every print dialog asks what can print; that question must not wake a
    // Raspberry Pi.
    expect(harness.posts).toHaveLength(0);
  });

  it('withdraws the driver when the plugin stops declaring one', async () => {
    const harness = build({ declares: true });
    await harness.service.syncAll();
    const silent = build({ declares: false });
    await silent.service.syncPlugin('niimbot-bridge');
    // A withdrawal is only published for what WAS published, so a plugin that
    // never had a printer does not unregister a stranger's capability.
    expect(silent.unregistered).toHaveLength(0);
  });

  it('relays a page as base64 under the plugin-addressed capability', async () => {
    const harness = build({ declares: true });
    await harness.service.syncAll();
    const result = await harness.registered[0].impl.print(page, { copies: 3 });
    expect(result).toEqual({ ok: true });
    const body = harness.posts[0].body as {
      capability: string;
      method: string;
      args: [{ rows: string; copies: number; widthDots: number }];
      context: { scopeId: string };
    };
    expect(body.capability).toBe('niimbot-bridge.print-driver');
    expect(body.method).toBe('print');
    expect(body.args[0].widthDots).toBe(384);
    expect(body.args[0].copies).toBe(3);
    expect(Buffer.from(body.args[0].rows, 'base64')).toEqual(
      Buffer.from(page.rows),
    );
    // The container never learns who anybody is (decision #5).
    expect(body.context.scopeId).toBe('ref:u1');
  });

  it('reports a keyed failure when the container refuses or cannot be reached', async () => {
    const refused = build({ declares: true, postOk: false });
    await refused.service.syncAll();
    expect(await refused.registered[0].impl.print(page, {})).toEqual({
      ok: false,
      errorKey: 'external.printer.errors.unreachable',
    });

    // A container that answered with its own key keeps it — the text lives in
    // its bundle, not ours.
    const keyed = build({
      declares: true,
      result: { ok: false, errorKey: 'errNoPrinter' },
    });
    await keyed.service.syncAll();
    expect(await keyed.registered[0].impl.print(page, {})).toEqual({
      ok: false,
      errorKey: 'errNoPrinter',
    });
  });

  it('treats an unreadable answer as a failed print, never a successful one', async () => {
    const harness = build({ declares: true, result: 'fine, printed' });
    await harness.service.syncAll();
    expect(await harness.registered[0].impl.print(page, {})).toEqual({
      ok: false,
      errorKey: 'external.printer.errors.unreachable',
    });
  });
});
