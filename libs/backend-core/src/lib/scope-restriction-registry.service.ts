import { Injectable, Logger } from '@nestjs/common';
import type { ScopeRestrictionDescriptor } from '@makekeeper/plugin-contract';

// Registry of plugin-announced scope restrictions (see the contract in
// plugin-contract/scope-restriction.ts). Plugins register descriptors in their
// module's onModuleInit — the same pattern as agent tools — and the multiuser
// overlay consumes them generically for the sharing UI and enforcement.
@Injectable()
export class ScopeRestrictionRegistryService {
  private readonly logger = new Logger(ScopeRestrictionRegistryService.name);
  private readonly descriptors = new Map<string, ScopeRestrictionDescriptor>();

  register(descriptor: ScopeRestrictionDescriptor): void {
    const key = this.key(descriptor.pluginId, descriptor.resourceKey);
    if (this.descriptors.has(key)) {
      this.logger.warn(
        `Scope restriction "${key}" registered twice; keeping the last one.`,
      );
    }
    this.descriptors.set(key, descriptor);
  }

  getAll(): ScopeRestrictionDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  get(
    pluginId: string,
    resourceKey: string,
  ): ScopeRestrictionDescriptor | undefined {
    return this.descriptors.get(this.key(pluginId, resourceKey));
  }

  private key(pluginId: string, resourceKey: string): string {
    return `${pluginId}:${resourceKey}`;
  }
}
