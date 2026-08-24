// The plugin's own scheduler (#140).
//
// The core runs no jobs for external plugins: a plugin that wants periodic
// work runs its own timer. This module is that timer plus the one call it
// makes — kept apart from rendering because the screens deliberately read only
// the stored snapshot, never the network.

import type { CoreClient } from '@makekeeper/plugin-sdk';
import { saveState, type State } from './state.ts';

const METRIC = process.env['DIGEST_METRIC'] ?? 'inventory.stock';
// Deliberately short in the example so a reviewer sees it work; a real digest
// would run hourly at most.
const INTERVAL_MS = Number(process.env['DIGEST_INTERVAL_MS'] ?? 60_000);
const WINDOW_DAYS = 7;

// `core.forInstance()` binds calls to the background-INSTANCE token. There is
// no user in this context and none is needed: aggregates belong to nobody.
export const collect = async (
  state: State,
  core: CoreClient,
  onCollected: () => Promise<void>,
  onFailure: () => Promise<void>,
): Promise<void> => {
  try {
    const series = await core.forInstance().metrics({
      pluginId: 'inventory',
      metricKey: METRIC,
      days: WINDOW_DAYS,
      byScope: true,
    });
    // Sum per day across scopes and count the distinct scopes seen. The plugin
    // stores only what it needs — the per-scope detail is not kept.
    const totals = new Map<string, number>();
    const scopes = new Set<string>();
    for (const point of series.points) {
      totals.set(point.date, (totals.get(point.date) ?? 0) + point.value);
      if (point.scopeId) scopes.add(point.scopeId);
    }
    state.latest = {
      takenAt: new Date().toISOString(),
      points: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, value })),
      scopeCount: scopes.size,
    };
    delete state.lastError;
    await saveState(state);
    await onCollected();
  } catch (err: unknown) {
    // A digest that cannot be collected is not a reason to die: the plugin
    // keeps serving its last snapshot and the next tick tries again. The most
    // common cause is simply "not approved yet".
    state.lastError = err instanceof Error ? err.message : String(err);
    await saveState(state);
    await onFailure();
  }
};

export const startCollecting = (
  state: State,
  core: CoreClient,
  onCollected: () => Promise<void>,
  onFailure: () => Promise<void>,
): void => {
  const tick = (): void => {
    void collect(state, core, onCollected, onFailure);
  };
  tick();
  setInterval(tick, INTERVAL_MS);
};
