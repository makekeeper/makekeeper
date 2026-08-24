// Per-scope storage — the reason this example exists (#140).
//
// The core hands the plugin an opaque, stable `scopeId` on every call and
// issues one background token per scope; the plugin must key its OWN storage
// by it, because the core's scope policy stops at the core — it cannot reach
// into a third-party database.
//
// Getting that wrong is the failure mode the whole `scopeModel` declaration
// exists to prevent, so this module is written to make it hard: there is no
// accessor that returns loans across scopes, and every read and write goes
// through `loansOf`.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'loans.json');

export interface Loan {
  id: string;
  what: string;
  toWhom: string;
  since: string;
}

export interface State {
  version: 1;
  // Keyed by scope. A flat array would compile just as well and leak one
  // user's loans into another's list.
  byScope: Record<string, Loan[]>;
  secret?: string;
}

// Single-user mode has no scopes; this names its one implicit data space, so
// the partition key is decided in exactly one place.
export const spaceOf = (scopeId: string): string => scopeId || '__single__';

export const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { version: 1, byScope: {} };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state));
};

export const loansOf = (state: State, scopeId: string): Loan[] =>
  (state.byScope[spaceOf(scopeId)] ??= []);

export const setLoansOf = (
  state: State,
  scopeId: string,
  loans: Loan[],
): void => {
  state.byScope[spaceOf(scopeId)] = loans;
};

export const forgetScope = (state: State, scopeId: string): void => {
  delete state.byScope[spaceOf(scopeId)];
};
