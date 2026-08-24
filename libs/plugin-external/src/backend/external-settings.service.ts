import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService, getErrorMessage } from '@makekeeper/backend-core';
import {
  EXTERNAL_SURFACES,
  ExternalSurface,
  SURFACE_BUDGET_MS,
} from './external-breaker.service';
import { readStoredRecord } from './persisted';

// Admin-tunable per-surface time budgets (decision #8 of #131: "budgets are
// admin-tunable defaults"). Stored as a singleton row; the code defaults in
// SURFACE_BUDGET_MS keep applying for every surface the admin never touched.
//
// The overrides are cached in memory because budget() sits on every proxied
// call — a DB read per render would cost more than the budget it fetches.

const INSTANCE_ID = 'instance';

// Sanity rails, not policy: below the floor a budget only produces noise, and
// above the ceiling a hung plugin holds a request slot for minutes.
const MIN_BUDGET_MS = 100;
const MAX_BUDGET_MS = 600_000;

export type SurfaceBudgets = Record<ExternalSurface, number>;

@Injectable()
export class ExternalSettingsService implements OnModuleInit {
  private readonly logger = new Logger(ExternalSettingsService.name);
  private overrides: Partial<SurfaceBudgets> = {};

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  budgetFor(surface: ExternalSurface): number {
    return this.overrides[surface] ?? SURFACE_BUDGET_MS[surface];
  }

  effectiveBudgets(): SurfaceBudgets {
    return { ...SURFACE_BUDGET_MS, ...this.overrides };
  }

  defaultBudgets(): SurfaceBudgets {
    return { ...SURFACE_BUDGET_MS };
  }

  // Partial save: only the surfaces present change; a value equal to the code
  // default drops its override so future default changes reach the instance.
  async saveBudgets(update: Partial<SurfaceBudgets>): Promise<SurfaceBudgets> {
    const next: Partial<SurfaceBudgets> = { ...this.overrides };
    for (const surface of EXTERNAL_SURFACES) {
      const value = update[surface];
      if (value === undefined) continue;
      const clamped = Math.round(
        Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, value)),
      );
      if (clamped === SURFACE_BUDGET_MS[surface]) delete next[surface];
      else next[surface] = clamped;
    }
    await this.prisma.externalSettings.upsert({
      where: { id: INSTANCE_ID },
      create: { id: INSTANCE_ID, budgetsJson: JSON.stringify(next) },
      update: { budgetsJson: JSON.stringify(next) },
    });
    this.overrides = next;
    return this.effectiveBudgets();
  }

  private async reload(): Promise<void> {
    try {
      const row = await this.prisma.externalSettings.findUnique({
        where: { id: INSTANCE_ID },
      });
      if (!row?.budgetsJson) return;
      const raw = readStoredRecord(row.budgetsJson) ?? {};
      const loaded: Partial<SurfaceBudgets> = {};
      for (const surface of EXTERNAL_SURFACES) {
        const value = raw[surface];
        if (typeof value === 'number' && Number.isFinite(value)) {
          loaded[surface] = Math.min(
            MAX_BUDGET_MS,
            Math.max(MIN_BUDGET_MS, Math.round(value)),
          );
        }
      }
      this.overrides = loaded;
    } catch (err) {
      // Unreadable settings must not keep the host from booting: the code
      // defaults are always a working configuration.
      this.logger.error(`failed to load budgets: ${getErrorMessage(err)}`);
    }
  }
}
