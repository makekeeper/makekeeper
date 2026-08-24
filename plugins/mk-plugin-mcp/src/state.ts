import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The only state this plugin owns is its registration secret — everything
// else (tools, rights, sessions' data) lives in the core or in the caller's
// token. One JSON file in the managed volume keeps the pairing across
// restarts.

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'mcp.json');

export interface State {
  secret?: string;
}

export async function loadState(): Promise<State> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const secret = (parsed as Record<string, unknown>)['secret'];
      return typeof secret === 'string' ? { secret } : {};
    }
  } catch {
    // First boot: no state yet.
  }
  return {};
}

export async function saveState(state: State): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
