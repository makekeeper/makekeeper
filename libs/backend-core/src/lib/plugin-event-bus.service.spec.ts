import { PluginEventBusService } from './plugin-event-bus.service';
import type { PluginConfigService } from './plugin-config.service';

// Focused coverage of the plugin event bus (#58): dispatch + enabled-plugin
// gating + listener-error isolation, without booting Nest DI.
describe('PluginEventBusService', () => {
  interface DemoPayload {
    value: number;
  }

  const build = (enabled: (id: string) => boolean): PluginEventBusService =>
    new PluginEventBusService({
      isEnabled: enabled,
    } as PluginConfigService);

  it('delivers the payload to every enabled listener', async () => {
    const bus = build(() => true);
    const seen: number[] = [];
    bus.on<DemoPayload>('inventory', 'demo.event', (p) => {
      seen.push(p.value);
    });
    bus.on<DemoPayload>('projects', 'demo.event', (p) => {
      seen.push(p.value * 10);
    });
    await bus.emit<DemoPayload>('demo.event', { value: 2 });
    expect(seen).toEqual([2, 20]);
  });

  it('skips listeners whose plugin is disabled at emit time', async () => {
    let inventoryEnabled = false;
    const bus = build((id) => (id === 'inventory' ? inventoryEnabled : true));
    const seen: number[] = [];
    bus.on<DemoPayload>('inventory', 'demo.event', (p) => {
      seen.push(p.value);
    });
    await bus.emit<DemoPayload>('demo.event', { value: 1 });
    inventoryEnabled = true;
    await bus.emit<DemoPayload>('demo.event', { value: 2 });
    expect(seen).toEqual([2]);
  });

  it('isolates a throwing listener from the emitter and other listeners', async () => {
    const bus = build(() => true);
    const seen: number[] = [];
    bus.on<DemoPayload>('inventory', 'demo.event', () => {
      throw new Error('listener boom');
    });
    bus.on<DemoPayload>('projects', 'demo.event', (p) => {
      seen.push(p.value);
    });
    await expect(
      bus.emit<DemoPayload>('demo.event', { value: 3 }),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([3]);
  });

  it('awaits async listeners before resolving the emission', async () => {
    const bus = build(() => true);
    let applied = false;
    bus.on<DemoPayload>('inventory', 'demo.event', async () => {
      await Promise.resolve();
      applied = true;
    });
    await bus.emit<DemoPayload>('demo.event', { value: 4 });
    expect(applied).toBe(true);
  });

  it('is a no-op for an event with no listeners', async () => {
    const bus = build(() => true);
    await expect(
      bus.emit<DemoPayload>('demo.unknown', { value: 5 }),
    ).resolves.toBeUndefined();
  });
});
