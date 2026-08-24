import { CapabilityRegistryService } from './capability-registry.service';
import type { PluginConfigService } from './plugin-config.service';

// Focused coverage of the capability registry (#58): register + resolve +
// enabled-plugin gating, without booting Nest DI.
describe('CapabilityRegistryService', () => {
  interface EchoCapability {
    echo(value: string): string;
  }

  const build = (enabled: (id: string) => boolean): CapabilityRegistryService =>
    new CapabilityRegistryService({
      isEnabled: enabled,
    } as PluginConfigService);

  const echoImpl: EchoCapability = { echo: (value) => value };

  it('resolves a registered capability while its owner is enabled', () => {
    const registry = build(() => true);
    registry.registerCapability('chat', 'chat.echo', echoImpl);
    expect(
      registry.getCapability<EchoCapability>('chat.echo')?.echo('hi'),
    ).toBe('hi');
  });

  it('returns null for an unregistered capability id', () => {
    const registry = build(() => true);
    expect(registry.getCapability<EchoCapability>('chat.echo')).toBeNull();
  });

  it('returns null while the owning plugin is disabled', () => {
    const registry = build((id) => id !== 'chat');
    registry.registerCapability('chat', 'chat.echo', echoImpl);
    expect(registry.getCapability<EchoCapability>('chat.echo')).toBeNull();
  });

  it('resolves per call, so re-enabling the owner restores the capability', () => {
    let chatEnabled = false;
    const registry = build(() => chatEnabled);
    registry.registerCapability('chat', 'chat.echo', echoImpl);
    expect(registry.getCapability<EchoCapability>('chat.echo')).toBeNull();
    chatEnabled = true;
    expect(registry.getCapability<EchoCapability>('chat.echo')).not.toBeNull();
  });

  it('overwrites on duplicate registration (last writer wins)', () => {
    const registry = build(() => true);
    registry.registerCapability('chat', 'chat.echo', echoImpl);
    registry.registerCapability('other', 'chat.echo', {
      echo: () => 'override',
    } satisfies EchoCapability);
    expect(
      registry.getCapability<EchoCapability>('chat.echo')?.echo('hi'),
    ).toBe('override');
  });
});
