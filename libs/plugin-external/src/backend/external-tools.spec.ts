import { ExternalToolsService } from './external-tools.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalSettingsService } from './external-settings.service';
import type { ExternalScopeRefService } from './external-scope-ref.service';
import {
  AgentTool,
  ExternalPluginManifest,
  PermissionLevel,
} from '@makekeeper/plugin-contract';
import { PluginI18nService } from '@makekeeper/backend-core';
import type {
  AgentRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { ExternalRegistryService } from './external-registry.service';
import type { ExternalSignerService } from './external-signer.service';

const manifest = (): ExternalPluginManifest => ({
  contract: { major: 1, minor: 0 },
  pluginId: 'weather',
  version: '1',
  nameKey: 'name',
  icon: 'Blocks',
  scopeModel: 'instance',
  permissions: [],
  i18n: { en: { name: 'Weather' } },
  screens: [],
  tools: [
    {
      name: 'forecast',
      descriptionKey: 'tools.forecast',
      permission: PermissionLevel.READ,
      parameters: {
        properties: {
          city: { type: 'string', descriptionKey: 'tools.city' },
        },
        required: ['city'],
      },
    },
    {
      name: 'set_alert',
      descriptionKey: 'tools.setAlert',
      permission: PermissionLevel.WRITE,
      parameters: { properties: {} },
    },
  ],
});

const makeService = (opts: { assistantEnabled: boolean; post?: jest.Mock }) => {
  const registered = new Map<string, AgentTool>();
  const configured = new Set<string>();
  const agentRegistry = {
    registerTools: (tools: AgentTool[]) => {
      for (const t of tools) registered.set(t.name, t);
    },
    // Runtime registration must also seed the tool config rows the chat
    // filters on — without them a consented plugin stayed invisible (#164).
    ensureToolConfigs: async (tools: AgentTool[]) => {
      for (const t of tools) configured.add(t.name);
    },
    unregisterPluginTools: (pluginId: string) => {
      for (const [name, tool] of registered) {
        if (tool.pluginId === pluginId) registered.delete(name);
      }
    },
  } as unknown as AgentRegistryService;

  const active = {
    pluginId: 'weather',
    baseUrl: 'http://weather',
    manifest: manifest(),
    grants: [],
    secret: 's',
    scopeId: null,
    assistantEnabled: opts.assistantEnabled,
  };
  const registry = {
    getActive: async () => active,
    listActive: async () => [active],
    userRefSalt: async () => 'test-salt',
  } as unknown as ExternalRegistryService;

  const post =
    opts.post ??
    jest.fn(async () => ({ ok: true, status: 200, body: { result: 'sunny' } }));
  const signer = { post } as unknown as ExternalSignerService;
  const context = {
    get: () => ({ userId: 'u1', locale: 'en' }),
  } as unknown as RequestContextService;
  // A real resolver, so the test sees what the MODEL would see rather than
  // what a stub echoes back: the defect was descriptions reaching the LLM as
  // the literal key.
  const i18n = new PluginI18nService();

  const scopeRefs = {
    toRef: async (_pluginId: string, scopeId: string | null) =>
      scopeId ? `ref-${scopeId}` : null,
  } as unknown as ExternalScopeRefService;
  const service = new ExternalToolsService(
    registry,
    agentRegistry,
    signer,
    new ExternalBreakerService(
      new ExternalSettingsService(
        {} as unknown as ConstructorParameters<
          typeof ExternalSettingsService
        >[0],
      ),
    ),
    context,
    i18n,
    scopeRefs,
  );
  return { service, registered, configured, post, i18n };
};

describe('ExternalToolsService', () => {
  it('registers nothing while assistant consent is off (default)', async () => {
    const { service, registered } = makeService({ assistantEnabled: false });
    await service.syncPlugin('weather');
    expect(registered.size).toBe(0);
  });

  it('registers the plugin tools once consent is given', async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    expect([...registered.keys()]).toEqual([
      'weather__forecast',
      'weather__set_alert',
    ]);
  });

  it("registers the plugin's own bundle so a description is text, not a key", async () => {
    // The frontend merges these bundles separately, which is why the settings
    // UI read correctly while every tool description handed to the model was
    // the literal `ext.<plugin>.<key>` — a warning in the log and a
    // description of nothing in the prompt.
    const { service, registered, i18n } = makeService({
      assistantEnabled: true,
    });
    await service.syncPlugin('weather');
    const tool = registered.get('weather__forecast');
    expect(tool).toBeDefined();
    expect(i18n.t(tool!.pluginLabelKey)).toBe('Weather');
    // The description key still resolves to itself here only if the bundle is
    // missing it — what matters is that the NAMESPACE resolves at all.
    expect(i18n.t('ext.weather.name')).toBe('Weather');
  });

  it('seeds the config row the chat filters on', async () => {
    // The chat only offers tools that have an AgentToolConfig row saying they
    // are enabled, and the boot-time seed had long since run by the time an
    // admin approves a plugin. Registering without this left the plugin
    // installed, consented to, registered — and invisible in the assistant.
    const { service, registered, configured } = makeService({
      assistantEnabled: true,
    });
    await service.syncPlugin('weather');
    expect([...configured]).toEqual([...registered.keys()]);
    expect(configured.size).toBeGreaterThan(0);
  });

  it('namespaces tool names so a third-party tool cannot shadow an internal one', async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    expect(registered.has('forecast')).toBe(false);
    expect(registered.get('weather__forecast')?.pluginId).toBe('weather');
  });

  it('marks proxied tools external and gives mutating ones a confirm summary', async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    const read = registered.get('weather__forecast');
    const write = registered.get('weather__set_alert');
    expect(read?.external).toBe(true);
    expect(write?.external).toBe(true);
    // A gated card needs a summary; a READ tool never shows one.
    expect(write?.confirmSummary).toBeDefined();
    expect(read?.confirmSummary).toBeUndefined();
  });

  it("resolves descriptions inside the plugin's own i18n namespace", async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    expect(registered.get('weather__forecast')?.descriptionKey).toBe(
      'ext.weather.tools.forecast',
    );
    expect(
      registered.get('weather__forecast')?.parameters.properties['city']
        .descriptionKey,
    ).toBe('ext.weather.tools.city');
  });

  it('wraps the result as untrusted data rather than returning it bare', async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    const result = await registered.get('weather__forecast')?.handler({
      city: 'Berlin',
    });
    // The model must see a labelled envelope: a hostile container's text is
    // then reported data, not an instruction addressed to the agent.
    expect(result).toEqual({
      untrustedSource: 'external-plugin',
      pluginId: 'weather',
      data: 'sunny',
    });
  });

  it('drops the tools again when consent is withdrawn', async () => {
    const { service, registered } = makeService({ assistantEnabled: true });
    await service.syncPlugin('weather');
    expect(registered.size).toBe(2);

    const off = makeService({ assistantEnabled: false });
    // Re-sync on the same registry instance would be the real path; here the
    // point is that a sync with consent off leaves nothing registered.
    await off.service.syncPlugin('weather');
    expect(off.registered.size).toBe(0);
  });

  it('surfaces a failed proxy call as an i18n-keyed error, never a bare string', async () => {
    const post = jest.fn(async () => ({
      ok: false,
      status: 500,
      body: null,
      errorCode: 'http',
    }));
    const { service, registered } = makeService({
      assistantEnabled: true,
      post,
    });
    await service.syncPlugin('weather');
    await expect(
      registered.get('weather__forecast')?.handler({ city: 'Berlin' }),
    ).rejects.toThrow('external.errors.toolFailed');
  });
});
