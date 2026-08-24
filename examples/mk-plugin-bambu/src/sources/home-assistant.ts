// Home Assistant source: read the printer through entities HA already has.
//
// When the Bambu Lab integration is installed, HA is already the one client
// talking to the printer. Reading from HA then costs the printer nothing,
// which matters because its broker accepts only a few concurrent connections.

import type { Config } from '../config.ts';
import type { PrinterStatus, PrintState } from '../printer.ts';

const POLL_MS = Number(process.env['BAMBU_POLL_MS'] ?? 15_000);

// HA normalises the printer's state into its own vocabulary, so this mapping
// differs from the raw MQTT one.
const HA_STATE: Record<string, PrintState> = {
  printing: 'printing',
  running: 'printing',
  paused: 'paused',
  pause: 'paused',
  idle: 'idle',
  finish: 'finished',
  finished: 'finished',
  failed: 'failed',
  offline: 'unknown',
};

export interface HaHandlers {
  onStatus: (status: PrinterStatus) => void | Promise<void>;
  onConnection: (ok: boolean, detail?: string) => void | Promise<void>;
}

export interface HaHandle {
  stop(): void;
  // Poll now, out of turn, and resolve when the reading has been applied —
  // what the screen's refresh button waits on.
  poll(): Promise<void>;
}

export const startHaSource = (
  config: Config,
  handlers: HaHandlers,
): HaHandle => {
  const readEntity = async (entityId: string): Promise<string | null> => {
    if (!entityId) return null;
    const res = await fetch(
      `${config.haUrl.replace(/\/+$/, '')}/api/states/${entityId}`,
      { headers: { authorization: `Bearer ${config.haToken}` } },
    );
    if (!res.ok) throw new Error(`HA ${res.status} for ${entityId}`);
    const payload = (await res.json()) as { state?: string };
    const value = payload.state;
    // `unavailable` / `unknown` are not values — they are the absence of one.
    return value && value !== 'unavailable' && value !== 'unknown'
      ? value
      : null;
  };

  const asNumber = (value: string | null): number | null => {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const tick = async (): Promise<void> => {
    try {
      const raw = await readEntity(config.haEntityState);
      await handlers.onConnection(true);
      await handlers.onStatus({
        state: raw ? (HA_STATE[raw.toLowerCase()] ?? 'unknown') : 'unknown',
        job: await readEntity(config.haEntityJob),
        percent: asNumber(await readEntity(config.haEntityProgress)),
        remainingMinutes: asNumber(await readEntity(config.haEntityRemaining)),
        layer: null,
        totalLayers: null,
        nozzleTempC: asNumber(await readEntity(config.haEntityNozzle)),
        bedTempC: asNumber(await readEntity(config.haEntityBed)),
        at: new Date().toISOString(),
      });
    } catch (err: unknown) {
      await handlers.onConnection(
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), POLL_MS);

  return { stop: () => clearInterval(timer), poll: tick };
};
