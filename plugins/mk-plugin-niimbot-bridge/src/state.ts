import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Everything the bridge remembers: its registration secret, which printer it
// owns, and how to burn a label on it. One JSON file in the managed volume, so a
// restart does not send the operator back to the pairing screen.

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'niimbot-bridge.json');

export const LABEL_TYPES = ['withGaps', 'black', 'transparent'] as const;
export type LabelTypeName = (typeof LABEL_TYPES)[number];

export const DENSITY_MIN = 1;
export const DENSITY_MAX = 5;
export const DENSITY_DEFAULT = 3;

export interface State {
  secret?: string;
  // Bluetooth address, or the device name the library should match.
  address: string;
  density: number;
  labelType: LabelTypeName;
}

const defaults = (): State => ({
  address: '',
  density: DENSITY_DEFAULT,
  labelType: 'withGaps',
});

export function isLabelType(value: unknown): value is LabelTypeName {
  return LABEL_TYPES.some((type) => type === value);
}

export function clampDensity(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DENSITY_DEFAULT;
  return Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, Math.round(number)));
}

export async function loadState(): Promise<State> {
  try {
    const raw: unknown = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (typeof raw === 'object' && raw !== null) {
      const stored = raw as Record<string, unknown>;
      return {
        ...defaults(),
        ...(typeof stored['secret'] === 'string'
          ? { secret: stored['secret'] }
          : {}),
        address: typeof stored['address'] === 'string' ? stored['address'] : '',
        density: clampDensity(stored['density']),
        labelType: isLabelType(stored['labelType'])
          ? stored['labelType']
          : 'withGaps',
      };
    }
  } catch {
    // First boot, or a file somebody edited into nonsense: defaults, rather
    // than a container that refuses to start next to a working printer.
  }
  return defaults();
}

export async function saveState(state: State): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
