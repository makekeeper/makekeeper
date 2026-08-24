// Owns the LIFETIME of whichever source is configured (#146).
//
// Settings are edited in the UI, so a source must be able to stop and start
// again without the container restarting — otherwise "change the IP" means
// "redeploy", which is exactly what moving settings out of the environment was
// meant to fix.
//
// Everything above this module deals in `PrinterStatus`; everything below it
// deals in one specific protocol.

import type { Config } from '../config.ts';
import { isComplete } from '../config.ts';
import type { PrinterStatus } from '../printer.ts';
import { startLanSource, type LanHandle } from './bambu-lan.ts';
import { startHaSource, type HaHandle } from './home-assistant.ts';

export interface SourceCallbacks {
  onReport: (report: Record<string, unknown>) => void | Promise<void>;
  onStatus: (status: PrinterStatus) => void | Promise<void>;
  onConnection: (ok: boolean, detail?: string) => void | Promise<void>;
}

export class SourceManager {
  private lan: LanHandle | null = null;
  private ha: HaHandle | null = null;

  constructor(private readonly callbacks: SourceCallbacks) {}

  // Idempotent: call it at boot and after every settings save.
  apply(config: Config): void {
    this.stop();
    if (!isComplete(config)) {
      // No detail: "not configured" is a state the SCREEN words, in the user's
      // language. A sentence built here would be a literal travelling into the
      // UI (§5.5) — and one nobody could translate.
      void this.callbacks.onConnection(false);
      return;
    }
    if (config.source === 'lan') {
      this.lan = startLanSource(config, {
        onReport: this.callbacks.onReport,
        onConnection: this.callbacks.onConnection,
      });
      return;
    }
    this.ha = startHaSource(config, {
      onStatus: this.callbacks.onStatus,
      onConnection: this.callbacks.onConnection,
    });
  }

  // Ask the live source for a reading right now. Resolves when there is
  // nothing left to wait for: the HA poll is a request/response, the LAN
  // pushall is a request whose answer arrives on the subscription.
  async refresh(): Promise<void> {
    if (this.ha) {
      await this.ha.poll();
      return;
    }
    this.lan?.poll();
  }

  stop(): void {
    this.lan?.stop();
    this.lan = null;
    this.ha?.stop();
    this.ha = null;
  }
}
