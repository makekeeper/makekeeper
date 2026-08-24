// Persistence for the plugin's own data (#145).
//
// An external plugin owns its storage outright — the core never sees inside it
// — so this module is where a real plugin would put its database access. A
// JSON file is enough for an example; the shape of the module is what is worth
// copying, not the storage engine.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'shelf.json');

export interface Batch {
  id: string;
  label: string;
  // ORef of the inventory item this batch belongs to, when the user linked one.
  itemRef?: string;
  expiresOn: string;
  scopeId: string;
}

export interface State {
  // The exchange blob's format version — the plugin owns it, so an import
  // from a newer plugin into an older one can be refused rather than
  // corrupting data.
  version: 1;
  batches: Batch[];
  secret?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { version: 1, batches: [] };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state));
};

export const daysLeft = (iso: string): number =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

// Batches of one scope, soonest expiry first. Every read goes through here, so
// the scope filter cannot be forgotten at a call site.
export const batchesOf = (state: State, scopeId: string): Batch[] =>
  state.batches
    .filter((b) => b.scopeId === scopeId)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
