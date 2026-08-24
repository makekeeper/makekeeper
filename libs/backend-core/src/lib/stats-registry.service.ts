import { Injectable, Logger } from '@nestjs/common';
import { PluginConfigService } from './plugin-config.service';

// One aggregated point of a per-day metric. `date` is a `yyyy-mm-dd` day key;
// `scopeId` carries the owning user's scope so the aggregation job (which runs
// outside any request context) can persist per-user rows without re-deriving
// scope — null when multi-user mode is off. `dimensions` holds the metric's
// declared breakdown values, when any.
export interface StatsPoint {
  date: string;
  value: number;
  scopeId?: string | null;
  dimensions?: Record<string, string>;
}

// A plugin's raw-data range query over ITS OWN tables. The stats plugin calls
// this from the aggregation job to roll a window up into the daily aggregate
// table; the handler runs inside the job's context (see the job for scoping).
export interface StatsProvider {
  fetchRange(from: Date, to: Date): Promise<StatsPoint[]>;
}

// --- Relational graph path (ticket #56 §4.4) ------------------------------
// A Sankey-style graph is a cross-sectional aggregate over one window (nodes +
// weighted links), not a per-day series, and its exact shape is owned by the
// declaring plugin. The stats graph endpoint proxies this payload through
// verbatim, so it is intentionally opaque here — the plugin's widget knows how
// to render it (optionally via a shared frontend-core primitive).
export interface StatsGraphProvider {
  // Aggregate the graph over a single window (days back from `to`). Runs inside
  // the request context, so its Prisma calls are scoped to the caller normally.
  fetchGraph(from: Date, to: Date): Promise<unknown>;
}

interface RegisteredStatsProvider {
  pluginId: string;
  metricKey: string;
  provider: StatsProvider;
}

interface RegisteredStatsGraphProvider {
  pluginId: string;
  graphKey: string;
  provider: StatsGraphProvider;
}

// In-memory registry of the statistics providers plugins declare, mirroring
// `AgentRegistryService`: plugins register in `onModuleInit()`; the stats
// plugin reads the enabled set. Enable-state filtering reuses
// `PluginConfigService.isEnabled` so a disabled plugin's metrics vanish from
// the job and the API, exactly like agent tools.
@Injectable()
export class StatsRegistryService {
  private readonly logger = new Logger(StatsRegistryService.name);
  private readonly providers = new Map<string, RegisteredStatsProvider>();
  private readonly graphProviders = new Map<
    string,
    RegisteredStatsGraphProvider
  >();

  constructor(private readonly pluginConfig: PluginConfigService) {}

  registerStatsProvider(
    pluginId: string,
    metricKey: string,
    provider: StatsProvider,
  ): void {
    if (this.providers.has(metricKey)) {
      this.logger.warn(
        `Stats metric "${metricKey}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.providers.set(metricKey, { pluginId, metricKey, provider });
  }

  getProviders(): RegisteredStatsProvider[] {
    return [...this.providers.values()];
  }

  // Providers of plugins that are currently enabled at the instance level.
  getEnabledProviders(): RegisteredStatsProvider[] {
    return this.getProviders().filter((entry) =>
      this.pluginConfig.isEnabled(entry.pluginId),
    );
  }

  // --- Reserved graph-provider surface (no consumer in the current phase) ---
  registerStatsGraphProvider(
    pluginId: string,
    graphKey: string,
    provider: StatsGraphProvider,
  ): void {
    if (this.graphProviders.has(graphKey)) {
      this.logger.warn(
        `Stats graph "${graphKey}" already registered — overwriting (plugin "${pluginId}")`,
      );
    }
    this.graphProviders.set(graphKey, { pluginId, graphKey, provider });
  }

  getGraphProviders(): RegisteredStatsGraphProvider[] {
    return [...this.graphProviders.values()];
  }

  getEnabledGraphProviders(): RegisteredStatsGraphProvider[] {
    return this.getGraphProviders().filter((entry) =>
      this.pluginConfig.isEnabled(entry.pluginId),
    );
  }
}
