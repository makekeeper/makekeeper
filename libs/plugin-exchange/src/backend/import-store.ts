import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { promises as fsp } from 'fs';
import { join } from 'path';
import {
  AppConfigService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import type { MkManifest } from './archive';

// Short-lived server-side cache of an uploaded, extracted archive between the
// inspect and execute steps of the import wizard. The token is unguessable and
// single-use; entries expire after one hour and their directories are removed.

export interface PendingImport {
  token: string;
  dir: string;
  manifest: MkManifest;
  // Section keys present in the archive AND declared/enabled on this instance.
  importableSections: string[];
  createdAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;

@Injectable()
export class ExchangeImportStore implements OnModuleDestroy {
  private readonly logger = new Logger(ExchangeImportStore.name);
  private readonly pending = new Map<string, PendingImport>();
  // `unref()` keeps the sweeper from holding the process open in tests.
  private readonly sweeper = setInterval(
    () => void this.sweep(),
    SWEEP_MS,
  ).unref();

  constructor(private readonly config: AppConfigService) {}

  // Root for everything exchange writes temporarily (uploads, extractions,
  // export staging) — lives under the uploads root so deployments already
  // persist/clean one tree.
  tmpRoot(): string {
    return join(this.config.getUploadsRoot(), 'exchange-tmp');
  }

  async createDir(): Promise<{ token: string; dir: string }> {
    const token = 'imp_' + generateUuid();
    const dir = join(this.tmpRoot(), token);
    await fsp.mkdir(dir, { recursive: true });
    return { token, dir };
  }

  put(entry: Omit<PendingImport, 'createdAt'>): void {
    this.pending.set(entry.token, { ...entry, createdAt: Date.now() });
  }

  get(token: string): PendingImport | null {
    const entry = this.pending.get(token);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > TTL_MS) {
      void this.remove(token);
      return null;
    }
    return entry;
  }

  async remove(token: string): Promise<void> {
    const entry = this.pending.get(token);
    this.pending.delete(token);
    if (entry) {
      await fsp.rm(entry.dir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`Failed to clean import dir: ${getErrorMessage(err)}`);
      });
    }
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [token, entry] of this.pending) {
      if (now - entry.createdAt > TTL_MS) await this.remove(token);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }
}
