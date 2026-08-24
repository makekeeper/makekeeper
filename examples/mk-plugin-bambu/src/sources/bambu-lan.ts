// LAN source: the printer's own MQTT broker.
//
// Bambu printers expose MQTT over TLS on 8883 with user `bblp` and the
// printer's ACCESS CODE as the password — the same interface the Home
// Assistant integration uses. Reports arrive on `device/<serial>/report`.
//
// Two things that are easy to get wrong and are handled here:
//   * the printer only pushes DELTAS, so a full picture needs an explicit
//     `pushall` request after connecting — otherwise a freshly started plugin
//     shows almost nothing until the next state change;
//   * the printer's broker accepts only a handful of concurrent clients. If
//     Home Assistant already watches this printer, prefer the HA source over
//     opening another socket (see the README).

import type { Config } from '../config.ts';
import { connectMqtt, type MqttConnection } from './mqtt.ts';

const PORT = Number(process.env['BAMBU_PORT'] ?? 8883);
// Long enough not to hammer a printer that is simply switched off.
const RECONNECT_MS = 15_000;

export interface LanHandlers {
  onReport: (report: Record<string, unknown>) => void | Promise<void>;
  onConnection: (ok: boolean, detail?: string) => void | Promise<void>;
}

export interface LanHandle {
  stop(): void;
  // Ask the printer for a full report. Unlike the HA source this cannot be
  // awaited: the answer arrives on the subscription, whenever the printer
  // feels like it.
  poll(): void;
}

export const startLanSource = (
  config: Config,
  handlers: LanHandlers,
): LanHandle => {
  let connection: MqttConnection | null = null;
  let retry: NodeJS.Timeout | undefined;
  // Settings can change under us; a connection that was told to stop must not
  // resurrect itself from a pending reconnect timer.
  let stopped = false;

  const open = (): void => {
    if (stopped) return;
    connection = connectMqtt({
      host: config.host,
      port: PORT,
      username: 'bblp',
      password: config.accessCode,
      // A stable client id so a reconnect replaces our own session rather than
      // adding to the printer's small connection budget.
      clientId: `makekeeper-${config.serial}`,
      topic: `device/${config.serial}/report`,
      onMessage: (_topic, payload) => {
        try {
          void handlers.onReport(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // A malformed frame is the printer's business, not a reason to drop
          // the connection.
        }
      },
      onStatus: (status, detail) => {
        if (stopped) return;
        void handlers.onConnection(status === 'connected', detail);
        if (status === 'connected') {
          // Ask for the full state; without this the first useful report can
          // be minutes away.
          connection?.publish(
            `device/${config.serial}/request`,
            JSON.stringify({
              pushing: { sequence_id: '1', command: 'pushall' },
            }),
          );
        } else {
          connection?.close();
          connection = null;
          retry = setTimeout(open, RECONNECT_MS);
        }
      },
    });
  };

  open();

  const pushAll = (): void => {
    connection?.publish(
      `device/${config.serial}/request`,
      JSON.stringify({ pushing: { sequence_id: '1', command: 'pushall' } }),
    );
  };

  return {
    poll: pushAll,
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      connection?.close();
      connection = null;
    },
  };
};
