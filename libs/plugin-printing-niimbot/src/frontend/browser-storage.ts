// This browser's own memory, and the one guard every reader of an HTTP body
// needs.
//
// Both halves of the plugin's frontend keep something per browser — the
// granted Bluetooth device, and a cache of the instance's print settings — and
// both had their own byte-identical copy of these four lines (#366 review).

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage denied: the printer still prints, this browser just forgets.
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Same: remembering is a convenience, never a precondition for printing.
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
