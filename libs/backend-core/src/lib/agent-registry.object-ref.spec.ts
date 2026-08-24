import { AgentRegistryService } from './agent-registry.service';
import type { PrismaService } from './prisma.service';
import type { PluginConfigService } from './plugin-config.service';

// Focused coverage of the ORef resolver registry (#16): parse + ownership routing +
// enabled-plugin gating + exists/not, without booting Nest DI.
describe('AgentRegistryService.resolveObjectRef', () => {
  const build = (enabled: (id: string) => boolean): AgentRegistryService =>
    new AgentRegistryService(
      {} as PrismaService,
      {
        isEnabled: enabled,
      } as PluginConfigService,
    );

  const registerStorage = (service: AgentRegistryService): void => {
    service.registerObjectRefResolver('storages', 'storage', async (ref) =>
      ref.entityId === 'known'
        ? {
            displayName: 'Office',
            breadcrumb: `Office${ref.fragment ? ` / ${ref.fragment}` : ''}`,
          }
        : null,
    );
  };

  it('resolves a known ref to its info, echoing the canonical string', async () => {
    const service = build(() => true);
    registerStorage(service);
    expect(
      await service.resolveObjectRef('mk://storages/storage/known#B1'),
    ).toEqual({
      ref: 'mk://storages/storage/known#B1',
      exists: true,
      displayName: 'Office',
      breadcrumb: 'Office / B1',
    });
  });

  it('reports exists:false when the resolver runs but the id is unknown', async () => {
    const service = build(() => true);
    registerStorage(service);
    expect(
      await service.resolveObjectRef('mk://storages/storage/ghost'),
    ).toEqual({
      ref: 'mk://storages/storage/ghost',
      exists: false,
      displayName: '',
    });
  });

  it('returns null for an unparseable ref', async () => {
    const service = build(() => true);
    registerStorage(service);
    expect(await service.resolveObjectRef('not-a-ref')).toBeNull();
  });

  it('returns null when no resolver is registered for the type', async () => {
    const service = build(() => true);
    registerStorage(service);
    expect(
      await service.resolveObjectRef('mk://storages/shelf/known'),
    ).toBeNull();
  });

  it('returns null when the owning plugin is disabled', async () => {
    const service = build((id) => id !== 'storages');
    registerStorage(service);
    expect(
      await service.resolveObjectRef('mk://storages/storage/known'),
    ).toBeNull();
  });

  it('never throws when a resolver throws — the turn survives', async () => {
    const service = build(() => true);
    service.registerObjectRefResolver('storages', 'storage', async () => {
      throw new Error('boom');
    });
    expect(
      await service.resolveObjectRef('mk://storages/storage/known'),
    ).toBeNull();
  });
});
