import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  RequestContextService,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_PRINT_DRIVER_METHODS,
  PLUGIN_CAPABILITY_PATH,
  encodeRasterPayload,
  externalPrintDriverCapabilityId,
  printDriverCapability,
  type PrintDriverCapability,
  type PrintDriverDescriptor,
  type PrintJobOptions,
  type PrintRaster,
  type PrintResult,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';
import { ExternalScopeRefService } from './external-scope-ref.service';

// External plugins as PRINT DRIVERS (#362).
//
// The browser-side driver (#359) only exists in Chromium, so the answer for an
// iPhone — and for a shared printer several people print to — is a process next
// to the machine: an external plugin container with a radio of its own. It
// registers through the same `printing` contract the browser driver uses, so
// `codes` offers "Print on <it>" without learning that anything changed.
//
// Declared in the manifest rather than left to an ordinary capability for the
// same reason a delivery channel is: what the admin approves here is a piece of
// hardware in their workshop, and the label they see must come from a field they
// confirmed.
//
// The DESCRIPTOR is manifest data, answered without touching the container:
// every print dialog asks what can print, and that question must not wake a
// Raspberry Pi. Only the print itself travels.
@Injectable()
export class ExternalPrintersService {
  private readonly logger = new Logger(ExternalPrintersService.name);
  // Capability ids published for external plugins, so a re-sync withdraws
  // exactly what it published.
  private readonly published = new Set<string>();

  constructor(
    private readonly registry: ExternalRegistryService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  async syncAll(): Promise<void> {
    for (const plugin of await this.registry.listActive()) {
      this.publish(plugin.pluginId, plugin.manifest.printDriver ?? null);
    }
  }

  async syncPlugin(pluginId: string): Promise<void> {
    const plugin = await this.registry.getActive(pluginId);
    this.publish(pluginId, plugin?.manifest.printDriver ?? null);
  }

  private publish(
    pluginId: string,
    decl: { labelKey: string; maxWidthDots: number; dpi: number } | null,
  ): void {
    const capabilityId = printDriverCapability(pluginId);
    if (!decl) {
      if (this.published.delete(pluginId)) {
        this.capabilities.unregisterCapability(capabilityId);
      }
      return;
    }
    this.published.add(pluginId);
    const descriptor: PrintDriverDescriptor = {
      id: capabilityId,
      pluginId,
      nameKey: decl.labelKey,
      maxWidthDots: decl.maxWidthDots,
      dpi: decl.dpi,
    };
    this.capabilities.registerCapability<PrintDriverCapability>(
      pluginId,
      capabilityId,
      {
        describe: () => Promise.resolve(descriptor),
        print: (raster, options) => this.print(pluginId, raster, options),
      },
    );
  }

  private async print(
    pluginId: string,
    raster: PrintRaster,
    options: PrintJobOptions,
  ): Promise<PrintResult> {
    // The contract's own wire shape for a page: the relay is JSON, and a raster
    // is kept as bytes precisely so a remote driver can print the very page a
    // browser rendered.
    const result = await this.call(
      pluginId,
      EXTERNAL_PRINT_DRIVER_METHODS.print,
      encodeRasterPayload(raster, options.copies ?? 1),
    );
    // A container that answered something we cannot read is a failed print, not
    // a successful one — printing is the rare relay where optimism costs paper.
    if (typeof result !== 'object' || result === null) {
      return { ok: false, errorKey: 'external.printer.errors.unreachable' };
    }
    const answer = result as { ok?: unknown; errorKey?: unknown };
    if (answer.ok === true) return { ok: true };
    return {
      ok: false,
      errorKey:
        typeof answer.errorKey === 'string' && answer.errorKey !== ''
          ? // The plugin's OWN i18n key, resolved from its own bundle by
            // whoever displays it — the same path every external label takes.
            answer.errorKey
          : 'external.printer.errors.failed',
    };
  }

  private async call(
    pluginId: string,
    method: string,
    args: unknown,
  ): Promise<unknown> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin || this.breaker.shouldSkip(pluginId)) return null;
    const request = this.context.get();
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_CAPABILITY_PATH,
      {
        capability: externalPrintDriverCapabilityId(pluginId),
        method,
        args: [args],
        context: {
          // The opaque scope reference every relay carries (decision #5): a
          // printer never learns who anybody is.
          scopeId:
            (await this.scopeRefs.toRef(pluginId, request?.scopeId ?? null)) ??
            '',
          locale: request?.locale ?? 'en',
        },
      },
      // A print is a physical act with a motor in it — connect, feed, burn 240
      // rows at 10 ms a packet — so it gets the long `hook` budget rather than
      // the 10 s sized for answering a question.
      this.breaker.budget('hook'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      this.logger.warn(`print relay to ${pluginId} failed`);
      return null;
    }
    this.breaker.recordSuccess(pluginId);
    const payload = res.body;
    return typeof payload === 'object' &&
      payload !== null &&
      'result' in payload
      ? (payload as { result: unknown }).result
      : null;
  }
}
