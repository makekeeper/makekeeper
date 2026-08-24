import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyStatus, type PrinterStatus, type PrintLogEntry } from './printer.ts';
import { defaultConfig, type Config } from './config.ts';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'bambu.json');
const LOG_LIMIT = 50;

export interface State {
  version: 1;
  // Connection settings, edited in the UI. Seeded from the environment on a
  // first run so a headless install still works.
  config: Config;
  status: PrinterStatus;
  // When the current job started, so a finished job can be logged with a
  // duration the printer never reports directly.
  jobStartedAt: string | null;
  log: PrintLogEntry[];
  connection: { ok: boolean; detail?: string; at: string };
  // Entity ids read from Home Assistant by the settings screen's connection
  // check. Cached so the screen can offer dropdowns without an HTTP call on
  // every render — the render path has a budget, and this list changes only
  // when HA changes.
  haEntities: string[];
  // Outcome of the last "test connection" — shown on the settings screen, so
  // a failed check reports the reason instead of an empty dropdown.
  haCheck: { ok: boolean; detail?: string; at: string } | null;
  secret?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
    // A state file written before settings existed has no config; fill it from
    // the environment rather than leaving the plugin unconfigurable.
    return {
      ...stored,
      config: stored.config ?? defaultConfig(),
      haEntities: stored.haEntities ?? [],
      haCheck: stored.haCheck ?? null,
    };
  } catch {
    return {
      version: 1,
      config: defaultConfig(),
      status: emptyStatus(),
      jobStartedAt: null,
      log: [],
      connection: { ok: false, at: new Date().toISOString() },
      haEntities: [],
      haCheck: null,
    };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};

export const appendLog = (state: State, entry: PrintLogEntry): void => {
  state.log.unshift(entry);
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
};
