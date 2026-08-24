import { Injectable, Logger } from '@nestjs/common';
import {
  ExchangeRegistryService,
  ExchangeSectionProvider,
  PrismaService,
  RequestContextService,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  ExternalExportRequest,
  PLUGIN_EXPORT_PATH,
  PLUGIN_IMPORT_PATH,
} from '@makekeeper/plugin-contract';
import { ExternalRegistryService } from './external-registry.service';
import { ExternalScopeRefService } from './external-scope-ref.service';
import { ExternalSignerService } from './external-signer.service';
import { ExternalBreakerService } from './external-breaker.service';

// External plugins in `.mkx` export/import (#138, decision #12).
//
// The blob is OPAQUE to the core: the plugin owns its own database, so asking
// it to map its domain into our record format would be the same tax as
// demanding multi-tenant storage — the very thing the scope-model default
// avoids. The core carries the bytes and never looks inside.
//
// Two rules the SDK documents and the core relies on: the blob is
// self-contained (no references to files outside it) and versioned BY THE
// PLUGIN, so its own `import` can refuse an incompatible payload.
//
// The blob travels through the archive's FILE channel, not as a JSON record —
// that is the path that streams disk-to-archive without buffering a whole
// payload in memory.

export const externalSectionKey = (pluginId: string): string =>
  `external.${pluginId}`;

// Section key → plugin id, or null for a non-external section.
export const pluginIdOfExternalSection = (key: string): string | null =>
  key.startsWith('external.') ? key.slice('external.'.length) : null;

const BLOB_FILE_ID = 'blob.bin';

@Injectable()
export class ExternalExchangeService {
  private readonly logger = new Logger(ExternalExchangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExternalRegistryService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly signer: ExternalSignerService,
    private readonly breaker: ExternalBreakerService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  // Registers one section provider per exchange-participating plugin. Called
  // at boot and whenever the active set changes.
  async syncProviders(): Promise<void> {
    for (const plugin of await this.registry.listActive()) {
      if (!plugin.manifest.exchange) continue;
      this.exchangeRegistry.registerSectionProvider(
        'external',
        this.buildProvider(plugin.pluginId),
      );
    }
  }

  private buildProvider(pluginId: string): ExchangeSectionProvider {
    return {
      sectionKey: externalSectionKey(pluginId),
      exportSection: async (ctx) => {
        const blob = await this.fetchBlob(pluginId, ctx.root.entityId);
        if (blob) await ctx.files.putFile(BLOB_FILE_ID, blob);
        // The records array stays empty on purpose: the payload is the file.
        return { records: [] };
      },
      inspectSection: async () => ({ count: 1 }),
      importSection: async (_records, ctx) => {
        const blob = await ctx.files.readFile(BLOB_FILE_ID);
        if (!blob) return { created: 0 };
        const applied = await this.pushBlob(pluginId, blob);
        if (!applied) {
          // The plugin is installed but refused or is unreachable: keep the
          // block rather than losing the user's data silently.
          await this.defer(pluginId, blob, ctx.scopeId);
        }
        return { created: 1 };
      },
    };
  }

  // `scopeId` is null for a DATASET root (the instance backup), where there is
  // no picked object. The wire field stays a string — the SDK already reads a
  // missing scope as the empty string — so an instance export reaches the
  // plugin as "no particular scope", which is what it means.
  private async fetchBlob(
    pluginId: string,
    scopeId: string | null,
  ): Promise<Uint8Array | null> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return null;
    // Opaque scope reference, never the internal id (decision #5).
    const body: ExternalExportRequest = {
      scopeId: (await this.scopeRefs.toRef(pluginId, scopeId)) ?? '',
    };
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_EXPORT_PATH,
      body,
      this.breaker.budget('hook'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      this.logger.warn(`external export hook failed: ${pluginId}`);
      return null;
    }
    this.breaker.recordSuccess(pluginId);
    // The hook answers with base64 so the opaque payload survives the JSON
    // transport unchanged; the core decodes and stores bytes.
    const payload = res.body;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('blob' in payload) ||
      typeof (payload as { blob: unknown }).blob !== 'string'
    ) {
      return null;
    }
    return Buffer.from((payload as { blob: string }).blob, 'base64');
  }

  private async pushBlob(pluginId: string, blob: Uint8Array): Promise<boolean> {
    const plugin = await this.registry.getActive(pluginId);
    if (!plugin) return false;
    const res = await this.signer.post(
      plugin.baseUrl,
      plugin.secret,
      PLUGIN_IMPORT_PATH,
      { blob: Buffer.from(blob).toString('base64') },
      this.breaker.budget('hook'),
    );
    if (!res.ok) {
      this.breaker.recordFailure(pluginId);
      return false;
    }
    this.breaker.recordSuccess(pluginId);
    return true;
  }

  // Park a block for a plugin that is not installed (or could not take it).
  async defer(
    pluginId: string,
    blob: Uint8Array,
    targetScopeId: string | null,
  ): Promise<void> {
    await this.context.runWithoutScope('exchange', async () => {
      await this.prisma.externalDeferredBlob.create({
        data: {
          id: generateUuid(),
          pluginId,
          blob: Buffer.from(blob),
          targetScopeId,
        },
      });
    });
    this.logger.log(`deferred exchange block stored for plugin: ${pluginId}`);
  }

  // Called when a plugin becomes active: hand it anything waiting.
  async applyDeferred(pluginId: string): Promise<number> {
    const pending = await this.prisma.externalDeferredBlob.findMany({
      where: { pluginId, appliedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    let applied = 0;
    for (const row of pending) {
      if (!(await this.pushBlob(pluginId, row.blob))) break;
      await this.prisma.externalDeferredBlob.update({
        where: { id: row.id },
        data: { appliedAt: new Date() },
      });
      applied += 1;
    }
    return applied;
  }

  // Admin visibility: what is waiting, and for whom.
  async listDeferred(): Promise<
    Array<{ id: string; pluginId: string; createdAt: string; size: number }>
  > {
    const rows = await this.prisma.externalDeferredBlob.findMany({
      where: { appliedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      pluginId: r.pluginId,
      createdAt: r.createdAt.toISOString(),
      size: r.blob.length,
    }));
  }

  async discardDeferred(id: string): Promise<void> {
    await this.prisma.externalDeferredBlob.delete({ where: { id } });
  }
}
