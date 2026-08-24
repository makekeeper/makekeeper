import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  ExternalInvokeCapabilityRequest,
  PLUGIN_CAPABILITY_PATH,
  isValidCapabilityId,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalScopeRefService } from './external-scope-ref.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';

// Cross-plugin capabilities for external plugins (#138, decision #13) — a free
// market with two guardrails.
//
// OFFERING: any plugin may publish capabilities, but the id MUST carry its own
// `<pluginId>.` prefix, so collisions are impossible by construction rather
// than by a first-come-first-served race. The core registers a forwarding
// implementation: consumers call methods, the call is relayed to the container.
//
// CONSUMING: `capability:<id>` is a manifest permission the admin confirmed.
// Between two THIRD-PARTY plugins the core relays opaque JSON and validates
// nothing about the contract — that is the authors' responsibility, stated in
// the SDK docs, so a "plugin X broke plugin Y" report has an address.

export type CapabilityResult =
  | { ok: true; result: unknown }
  | { ok: false; error: 'unknown-capability' | 'unavailable' | 'failed' };

@Injectable()
export class ExternalCapabilitiesService {
  private readonly logger = new Logger(ExternalCapabilitiesService.name);
  // Capabilities registered on behalf of external plugins, so a re-sync can
  // tell "ours" from an internal plugin's registration.
  private readonly offered = new Map<string, string>();

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  // Publishes every active plugin's declared capabilities as forwarding
  // implementations. A consumer sees an ordinary object whose methods return
  // promises; each call becomes one signed relay to the owning container.
  // Re-publishes ONE plugin's offers. Called whenever its active state can
  // change (approve, enable, disable, uninstall) — registration at boot alone
  // would leave a plugin approved later with no capabilities registered.
  async syncPlugin(pluginId: string): Promise<void> {
    // Drop what we previously published for it, so a withdrawn or renamed
    // capability stops resolving instead of lingering.
    for (const [id, owner] of this.offered) {
      if (owner === pluginId) {
        this.offered.delete(id);
        this.capabilities.unregisterCapability(id);
      }
    }
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return;
    this.publish(plugin.pluginId, plugin.manifest.capabilities ?? []);
  }

  async syncOffered(): Promise<void> {
    for (const plugin of await this.registry.listActive()) {
      this.publish(plugin.pluginId, plugin.manifest.capabilities ?? []);
    }
  }

  private publish(
    pluginId: string,
    declarations: Array<{ id: string; version: string }>,
  ): void {
    for (const decl of declarations) {
      // Belt and braces: the manifest validator already enforces the prefix
      // rule, but registration is the point where a bad id would poison a
      // shared namespace, so it is re-checked here.
      if (
        !isValidCapabilityId(decl.id) ||
        !decl.id.startsWith(`${pluginId}.`)
      ) {
        this.logger.warn(
          `refusing capability with foreign prefix: ${decl.id} (plugin ${pluginId})`,
        );
        continue;
      }
      this.offered.set(decl.id, pluginId);
      this.capabilities.registerCapability(
        pluginId,
        decl.id,
        this.forwarder(pluginId, decl.id),
      );
    }
  }

  // A Proxy whose every property is an async method relaying (method, args).
  // The capability id binds the shape; the core stays untyped in the middle,
  // exactly as CapabilityRegistryService already documents for internal ones.
  private forwarder(pluginId: string, capabilityId: string): object {
    return new Proxy(
      {},
      {
        get: (_target, method: string | symbol) => {
          if (typeof method !== 'string') return undefined;
          return async (...args: unknown[]): Promise<unknown> => {
            const res = await this.callOwner(
              pluginId,
              capabilityId,
              method,
              args,
            );
            // A relay failure reads as "the feature doesn't exist right now",
            // matching the null-means-absent contract consumers already handle.
            return res.ok === true ? res.result : null;
          };
        },
      },
    );
  }

  private async callOwner(
    pluginId: string,
    capability: string,
    method: string,
    args: unknown[],
  ): Promise<CapabilityResult> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return { ok: false, error: 'unavailable' };
    if (this.breaker.shouldSkip(pluginId)) {
      return { ok: false, error: 'unavailable' };
    }
    const request = this.context.get();
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_CAPABILITY_PATH,
      {
        capability,
        method,
        args,
        context: {
          // Opaque scope reference, never the internal id (decision #5).
          scopeId:
            (await this.scopeRefs.toRef(pluginId, request?.scopeId ?? null)) ??
            '',
          locale: request?.locale ?? 'en',
        },
      },
      this.breaker.budget('tool'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      return { ok: false, error: 'failed' };
    }
    this.breaker.recordSuccess(pluginId);
    const payload = res.body;
    const result =
      typeof payload === 'object' && payload !== null && 'result' in payload
        ? (payload as { result: unknown }).result
        : null;
    return { ok: true, result };
  }

  // The CONSUMING direction: an external plugin invoking a capability (an
  // internal plugin's, or another external one's). Permission is checked by
  // the caller (controller) against the plugin's grants.
  async invokeForExternal(
    request: ExternalInvokeCapabilityRequest,
  ): Promise<CapabilityResult> {
    const impl = this.capabilities.getCapability<Record<string, unknown>>(
      request.capability,
    );
    // null means "unregistered or its owner is disabled" — one indistinguishable
    // answer on purpose: to a consumer, the feature simply does not exist.
    if (!impl) return { ok: false, error: 'unknown-capability' };
    const method = impl[request.method];
    if (typeof method !== 'function') {
      return { ok: false, error: 'unknown-capability' };
    }
    try {
      const fn = method as (...args: unknown[]) => Promise<unknown>;
      const result = await fn.apply(impl, request.args ?? []);
      return { ok: true, result };
    } catch {
      // The owner's failure is the owner's business; the consumer gets a
      // uniform, non-leaky answer.
      return { ok: false, error: 'failed' };
    }
  }
}
