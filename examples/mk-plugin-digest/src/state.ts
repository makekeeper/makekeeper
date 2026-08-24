import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'digest.json');

export interface Snapshot {
  takenAt: string;
  // date → value, summed across every scope.
  points: Array<{ date: string; value: number }>;
  scopeCount: number;
}

export interface State {
  version: 1;
  latest: Snapshot | null;
  secret?: string;
  lastError?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { version: 1, latest: null };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state));
};
