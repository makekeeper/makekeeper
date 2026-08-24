import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  generateUuid,
  getErrorMessage,
  PrismaService,
  RequestContextService,
  StatsRegistryService,
} from '@makekeeper/backend-core';
import { dayKeysInRange, encodeDimensions, startOfDay } from './stats.dates';

// How far back the one-off backfill rebuilds history from the source tables, so
// charts are not empty right after an upgrade. Bounded to keep the first run
// cheap; providers only return days their raw data actually covers.
const BACKFILL_DAYS = 365;

// Rolls every registered stats provider's raw data up into the StatsDaily
// aggregate table: once per day (previous day + today, to keep the tail fresh)
// and once on boot (a trailing backfill window). The whole rollup runs under a
// systemBypass context, so provider queries see all scopes at once; each point
// carries its own scopeId, which we persist verbatim — the aggregate stays
// correct with the multiuser overlay on and off.
@Injectable()
export class StatsAggregationJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(StatsAggregationJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: StatsRegistryService,
    private readonly requestContext: RequestContextService,
  ) {}

  onApplicationBootstrap(): void {
    // Fire-and-forget: a slow backfill must not delay app readiness. Errors are
    // logged inside runBackfill, never thrown.
    void this.runBackfill();
  }

  // Nightly: recompute yesterday and today (idempotent) so the latest day is
  // never stale for longer than a day.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDaily(): Promise<void> {
    const today = startOfDay(new Date());
    const from = new Date(today);
    from.setDate(today.getDate() - 1);
    const to = new Date(today);
    to.setDate(today.getDate() + 1);
    await this.aggregateRange(from, to, 'daily');
  }

  private async runBackfill(): Promise<void> {
    const today = startOfDay(new Date());
    const from = new Date(today);
    from.setDate(today.getDate() - (BACKFILL_DAYS - 1));
    const to = new Date(today);
    to.setDate(today.getDate() + 1);
    await this.aggregateRange(from, to, 'backfill');
  }

  // Recompute the half-open window [from, to) for every enabled provider with a
  // delete-then-insert per metric (never `upsert` — StatsDaily is scoped, and
  // the multiuser policy bans upsert on scoped models).
  private async aggregateRange(
    from: Date,
    to: Date,
    reason: string,
  ): Promise<void> {
    const dayKeys = dayKeysInRange(from, to);
    if (dayKeys.length === 0) return;

    await this.requestContext.run(
      { systemBypassReason: 'stats-aggregation' },
      async () => {
        for (const {
          pluginId,
          metricKey,
          provider,
        } of this.registry.getEnabledProviders()) {
          try {
            const points = await provider.fetchRange(from, to);
            await this.prisma.statsDaily.deleteMany({
              where: { pluginId, metricKey, date: { in: dayKeys } },
            });
            if (points.length > 0) {
              await this.prisma.statsDaily.createMany({
                data: points.map((p) => ({
                  id: generateUuid(),
                  date: p.date,
                  pluginId,
                  metricKey,
                  dimensions: encodeDimensions(p.dimensions),
                  value: p.value,
                  scopeId: p.scopeId ?? null,
                })),
              });
            }
          } catch (error) {
            this.logger.error(
              `Stats ${reason} rollup failed for metric "${metricKey}": ${getErrorMessage(error)}`,
            );
          }
        }
      },
    );
  }
}
