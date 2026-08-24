import { Injectable, Logger } from '@nestjs/common';
import { PluginConfigService } from './plugin-config.service';

interface RegisteredCapability {
  pluginId: string;
  capabilityId: string;
  impl: unknown;
}

// In-memory registry of the service surfaces plugins offer each other (#58),
// mirroring `StatsRegistryService`: the owning plugin registers in
// `onModuleInit()`, consumers resolve per call. Enable-state filtering reuses
// `PluginConfigService.isEnabled`, so a disabled plugin's capability vanishes
// exactly like its agent tools — the consumer gets `null` and degrades.
@Injectable()
export class CapabilityRegistryService {
  private readonly logger = new Logger(CapabilityRegistryService.name);
  private readonly capabilities = new Map<string, RegisteredCapability>();

  constructor(private readonly pluginConfig: PluginConfigService) {}

  registerCapability<T>(pluginId: string, capabilityId: string, impl: T): void {
    if (this.capabilities.has(capabilityId)) {
      this.logger.warn(
        `Capability "${capabilityId}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.capabilities.set(capabilityId, { pluginId, capabilityId, impl });
  }

  // Removes a registration. Internal plugins never need this (their offers
  // live as long as the process), but an EXTERNAL plugin's offer set changes
  // at runtime — on consent, update, disable or uninstall — so its owner
  // re-publishes from scratch rather than leaving a stale id resolving.
  unregisterCapability(capabilityId: string): void {
    this.capabilities.delete(capabilityId);
  }

  // The registered implementation, or null when nothing registered it OR its
  // owning plugin is currently disabled. Resolve per call, never cache the
  // result — enablement can flip at runtime.
  getCapability<T>(capabilityId: string): T | null {
    const entry = this.capabilities.get(capabilityId);
    if (!entry) return null;
    if (!this.pluginConfig.isEnabled(entry.pluginId)) return null;
    // The registry stores implementations untyped; the capability id IS the
    // type contract (each id is bound to one interface in plugin-contract's
    // capabilities.ts), so this narrowing cannot be expressed as a guard.
    return entry.impl as T;
  }
}
