// PULL source: Home Assistant's REST API.
//
// One of two intake paths, and the one that needs a schedule. Isolated here so
// adding a third source (a different hub, a vendor cloud) means adding a file
// rather than editing the plugin's core.

import { isOutOfSpec, recordReading, saveState, type State } from '../state.ts';

const HA_URL = process.env['HA_URL'] ?? '';
const HA_TOKEN = process.env['HA_TOKEN'] ?? '';
const POLL_MS = Number(process.env['CLIMATE_POLL_MS'] ?? 300_000);

export const isConfigured = (): boolean => Boolean(HA_URL && HA_TOKEN);

const readEntity = async (entityId: string): Promise<number | null> => {
  const res = await fetch(
    `${HA_URL.replace(/\/+$/, '')}/api/states/${entityId}`,
    { headers: { authorization: `Bearer ${HA_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`HA ${res.status} for ${entityId}`);
  const payload = (await res.json()) as { state?: string };
  const value = Number(payload.state);
  // HA reports `unavailable` / `unknown` as the state string. Those are not
  // zeroes and must never be recorded as readings.
  return Number.isFinite(value) ? value : null;
};

// Returns true when any spot CHANGED verdict — a new reading that keeps a spot
// in spec is not worth a refetch on every open screen.
export const pollOnce = async (state: State): Promise<boolean> => {
  if (!isConfigured()) return false;
  let verdictChanged = false;
  try {
    for (const spot of state.spots) {
      if (!spot.haTempEntity && !spot.haHumidityEntity) continue;
      const before = isOutOfSpec(spot);
      const temp = spot.haTempEntity ? await readEntity(spot.haTempEntity) : null;
      const humidity = spot.haHumidityEntity
        ? await readEntity(spot.haHumidityEntity)
        : null;
      if (temp === null && humidity === null) continue;
      recordReading(spot, temp, humidity);
      if (isOutOfSpec(spot) !== before) verdictChanged = true;
    }
    state.lastPollAt = new Date().toISOString();
    delete state.lastPollError;
  } catch (err: unknown) {
    // A sensor stack that is down is not this plugin's emergency: keep the
    // last readings, record why, and try again next tick.
    state.lastPollError = err instanceof Error ? err.message : String(err);
  }
  await saveState(state);
  return verdictChanged;
};

export const startPolling = (
  state: State,
  onVerdictChanged: () => Promise<void>,
): void => {
  const tick = (): void => {
    void pollOnce(state).then((changed) =>
      changed ? onVerdictChanged() : undefined,
    );
  };
  tick();
  setInterval(tick, POLL_MS);
};
