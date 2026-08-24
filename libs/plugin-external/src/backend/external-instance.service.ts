import { Injectable } from '@nestjs/common';
import { PrismaService, RequestContextService } from '@makekeeper/backend-core';
import { readStoredStringMap } from './persisted';
import { ExternalScopeRefService } from './external-scope-ref.service';

// The INSTANCE surface (#135, decision #7): cross-scope reads for background
// work — instance-wide statistics being the motivating case.
//
// Its shape is what makes it safe, not a check inside it: it returns AGGREGATES
// (per-day values, optionally broken down by scope), so there is no code path
// here that could hand back another user's records. The scoped CRUD surface is
// a different controller with a different token class; an endpoint that does
// not exist cannot be reached with the wrong grant.
//
// Data comes from StatsDaily — the same per-day series the stats plugin already
// aggregates from plugin-declared providers, so external consumers read the
// instance's existing rollups instead of triggering their own scans.

export interface InstanceMetricPoint {
  date: string;
  value: number;
  // Present only when the caller asked for a per-scope breakdown; the scope id
  // is opaque, matching the `scopeId` external plugins already receive.
  scopeId?: string;
  dimensions?: Record<string, string>;
}

export interface InstanceMetricSeries {
  pluginId: string;
  metricKey: string;
  from: string;
  to: string;
  points: InstanceMetricPoint[];
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class ExternalInstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly scopeRefs: ExternalScopeRefService,
  ) {}

  async metrics(input: {
    pluginId: string;
    metricKey: string;
    days: number;
    byScope: boolean;
    // The CALLING external plugin — the per-scope breakdown is keyed by ITS
    // opaque scope references (decision #5), so two callers reading the same
    // series cannot correlate scopes with each other.
    callerPluginId: string;
  }): Promise<InstanceMetricSeries> {
    const to = new Date();
    const from = new Date(to.getTime() - input.days * 24 * 60 * 60 * 1000);
    const fromKey = dayKey(from);
    const toKey = dayKey(to);

    // Explicitly cross-scope: the whole point of this surface. The bypass is
    // named, matching how every other sanctioned all-scope read in the codebase
    // (nightly rollups, admin exports) declares itself.
    const rows = await this.context.runWithoutScope(
      'stats-aggregation',
      async () =>
        this.prisma.statsDaily.findMany({
          where: {
            pluginId: input.pluginId,
            metricKey: input.metricKey,
            date: { gte: fromKey, lte: toKey },
          },
          orderBy: { date: 'asc' },
        }),
    );

    if (input.byScope) {
      const points: InstanceMetricPoint[] = [];
      for (const row of rows) {
        points.push({
          date: row.date,
          value: row.value,
          scopeId: row.scopeId
            ? ((await this.scopeRefs.toRef(
                input.callerPluginId,
                row.scopeId,
              )) ?? undefined)
            : undefined,
          dimensions: row.dimensions
            ? readStoredStringMap(row.dimensions)
            : undefined,
        });
      }
      return {
        pluginId: input.pluginId,
        metricKey: input.metricKey,
        from: fromKey,
        to: toKey,
        points,
      };
    }

    // Default: summed across scopes, so the caller sees an instance figure
    // without ever seeing which scope contributed what.
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.value);
    }
    return {
      pluginId: input.pluginId,
      metricKey: input.metricKey,
      from: fromKey,
      to: toKey,
      points: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, value })),
    };
  }

  // Which metric keys exist for a plugin — discovery for the caller.
  async availableMetrics(pluginId: string): Promise<string[]> {
    const rows = await this.context.runWithoutScope(
      'stats-aggregation',
      async () =>
        this.prisma.statsDaily.findMany({
          where: { pluginId },
          distinct: ['metricKey'],
          select: { metricKey: true },
        }),
    );
    return rows.map((r) => r.metricKey).sort();
  }
}
