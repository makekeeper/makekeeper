import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  getErrorMessage,
  generateUuid,
  PrismaService,
  RequestContextService,
} from '@makekeeper/backend-core';

// Records a daily snapshot of on-hand + reserved stock levels, one row per scope
// (ticket #56 §4.4). Stock level is a point-in-time reading, not a per-day
// count, so capturing it directly here lets the inventory stats provider serve
// historical levels without walking the movement log backward. Runs under a
// systemBypass context (all scopes at once) and stamps each row's scopeId, so
// the snapshot is correct with the multiuser overlay on and off. Idempotent:
// today's rows are replaced on each run (delete-then-insert, never upsert on a
// scoped model).
@Injectable()
export class StockSnapshotJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockSnapshotJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  // Capture today's snapshot on startup too, so a fresh deploy shows current
  // levels immediately instead of an empty chart until the first nightly run.
  // Fire-and-forget: it must not delay app readiness.
  onApplicationBootstrap(): void {
    void this.snapshotToday();
  }

  // Snapshots start accumulating from the first run; there is no historical
  // backfill (that would need the very backward-walk this design avoids), so the
  // timeline chart fills in over its window as days pass.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async snapshotToday(): Promise<void> {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;

    await this.requestContext.run(
      { systemBypassReason: 'stats-aggregation' },
      async () => {
        try {
          const [stockByScope, reservedRows] = await Promise.all([
            this.prisma.component.groupBy({
              by: ['scopeId'],
              _sum: { quantity: true },
            }),
            this.prisma.projectComponent.findMany({
              select: {
                reservedQty: true,
                component: { select: { scopeId: true } },
              },
            }),
          ]);

          // Reserved has no scopeId column — it is scoped through its Component.
          const reservedByScope = new Map<string | null, number>();
          for (const pc of reservedRows) {
            const scopeId = pc.component?.scopeId ?? null;
            reservedByScope.set(
              scopeId,
              (reservedByScope.get(scopeId) ?? 0) + pc.reservedQty,
            );
          }

          const scopes = new Set<string | null>([
            ...stockByScope.map((s) => s.scopeId),
            ...reservedByScope.keys(),
          ]);

          await this.prisma.stockSnapshot.deleteMany({ where: { date } });
          const rows = [...scopes].map((scopeId) => ({
            id: generateUuid(),
            date,
            scopeId,
            stock:
              stockByScope.find((s) => s.scopeId === scopeId)?._sum.quantity ??
              0,
            reserved: reservedByScope.get(scopeId) ?? 0,
          }));
          if (rows.length > 0) {
            await this.prisma.stockSnapshot.createMany({ data: rows });
          }
        } catch (error) {
          this.logger.error(`Stock snapshot failed: ${getErrorMessage(error)}`);
        }
      },
    );
  }
}
