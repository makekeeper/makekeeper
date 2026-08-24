import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'budget.json');

export interface Entry {
  id: string;
  what: string;
  amount: number;
  currency: string;
}

export interface State {
  version: 1;
  entries: Entry[];
  secret?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { version: 1, entries: [] };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state));
};
