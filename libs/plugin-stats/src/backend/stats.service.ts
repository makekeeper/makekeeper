import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PluginI18nService,
  PrismaService,
  StatsRegistryService,
} from '@makekeeper/backend-core';
import {
  dayKeysEndingOn,
  decodeDimensions,
  densify,
  encodeDimensions,
} from './stats.dates';

// One point of a per-day series, as served to the dashboard widgets.
export interface StatsSeriesPoint {
  date: string;
  value: number;
}

// One dimension-value group of a metric, with its own dense per-day series
// (e.g. one (provider, model) combination of chat.usage.requests).
export interface StatsSeriesGroup {
  dimensions: Record<string, string>;
  points: StatsSeriesPoint[];
}

const MAX_RANGE_DAYS = 365;
const DEFAULT_RANGE_DAYS = 14;

// Reads the daily aggregate table (never the source plugins' tables) and serves
// compact per-day series. Rows are auto-scoped to the caller by the Prisma
// access policy (StatsDaily is in SCOPE_MODEL_MAP), so multiuser correctness is
// handled at the data layer — this service does no scoping of its own.
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: StatsRegistryService,
    private readonly i18n: PluginI18nService,
  ) {}

  async getSeries(
    metricKey: string,
    days: number = DEFAULT_RANGE_DAYS,
    dimension?: { key: string; value: string },
    locale?: string,
  ): Promise<StatsSeriesPoint[]> {
    // Only metrics of currently-enabled plugins are served — a disabled plugin's
    // statistics disappear, mirroring how agent tools are gated.
    const entry = this.registry
      .getEnabledProviders()
      .find((p) => p.metricKey === metricKey);
    if (!entry) {
      throw new BadRequestException(
        this.i18n.t(
          'stats.errors.unknownMetric',
          { metric: metricKey },
          locale,
        ),
      );
    }

    const span = Math.min(Math.max(Math.trunc(days), 1), MAX_RANGE_DAYS);
    const dayKeys = dayKeysEndingOn(span, new Date());
    const start = dayKeys[0];

    // With a dimension filter, narrow to one breakdown value (e.g. one project);
    // without it, densify sums every dimension row per day into a single series
    // (e.g. activity across all projects).
    const dimensions =
      dimension === undefined
        ? undefined
        : encodeDimensions({ [dimension.key]: dimension.value });

    const rows = await this.prisma.statsDaily.findMany({
      where: {
        pluginId: entry.pluginId,
        metricKey,
        date: { gte: start },
        ...(dimensions === undefined ? {} : { dimensions }),
      },
      select: { date: true, value: true },
    });

    return densify(rows, dayKeys);
  }

  // Grouped read for dimensioned metrics: one dense per-day series per distinct
  // dimensions value (e.g. one series per provider+model of chat.usage.*). Used
  // by widgets that render several breakdown rows at once.
  async getGroupedSeries(
    metricKey: string,
    days: number = DEFAULT_RANGE_DAYS,
    locale?: string,
  ): Promise<StatsSeriesGroup[]> {
    const entry = this.registry
      .getEnabledProviders()
      .find((p) => p.metricKey === metricKey);
    if (!entry) {
      throw new BadRequestException(
        this.i18n.t(
          'stats.errors.unknownMetric',
          { metric: metricKey },
          locale,
        ),
      );
    }

    const span = Math.min(Math.max(Math.trunc(days), 1), MAX_RANGE_DAYS);
    const dayKeys = dayKeysEndingOn(span, new Date());
    const start = dayKeys[0];

    const rows = await this.prisma.statsDaily.findMany({
      where: { pluginId: entry.pluginId, metricKey, date: { gte: start } },
      select: { date: true, value: true, dimensions: true },
    });

    // Bucket rows by their raw dimensions string, then densify each bucket.
    const groups = new Map<string, { date: string; value: number }[]>();
    for (const row of rows) {
      const key = row.dimensions ?? '';
      const bucket = groups.get(key);
      if (bucket) bucket.push({ date: row.date, value: row.value });
      else groups.set(key, [{ date: row.date, value: row.value }]);
    }

    return [...groups.entries()].map(([encoded, bucket]) => ({
      dimensions: decodeDimensions(encoded),
      points: densify(bucket, dayKeys),
    }));
  }

  // Relational graph (e.g. a Sankey) — computed live over one window by the
  // owning plugin's graph provider and proxied through verbatim. Unlike series
  // metrics it is NOT rolled up daily; the provider runs inside this request, so
  // its data is scoped to the caller automatically.
  async getGraph(
    graphKey: string,
    days: number = DEFAULT_RANGE_DAYS,
    locale?: string,
  ): Promise<unknown> {
    const entry = this.registry
      .getEnabledGraphProviders()
      .find((g) => g.graphKey === graphKey);
    if (!entry) {
      throw new BadRequestException(
        this.i18n.t('stats.errors.unknownGraph', { graph: graphKey }, locale),
      );
    }
    const span = Math.min(Math.max(Math.trunc(days), 1), MAX_RANGE_DAYS);
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - span);
    return entry.provider.fetchGraph(from, to);
  }
}
