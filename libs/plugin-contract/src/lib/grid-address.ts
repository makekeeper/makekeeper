// Grid-cell addressing shared by every layer that names a storage cell (frontend
// getCellAddress, storages backend, inventory placement tools). Spreadsheet-style:
// the letters are the bijective base-26 encoding of the 0-based column (0 → "A",
// 25 → "Z", 26 → "AA", 27 → "AB", …) and the number is the 0-based row plus one
// (row 0 → 1). So (row 0, col 0) = "A1", (row 2, col 27) = "AB3". One
// implementation, one convention — the AI agent reads/passes these addresses and
// must never derive them itself (issue #15's mislabelling bug).
//
// The pair is a strict bijection between valid coordinates and canonical
// addresses: formatCellAddress emits exactly one spelling per cell (uppercase,
// no zero-padding) and returns null for anything that is not a pair of
// non-negative integers; parseCellAddress tolerates lowercase and surrounding
// whitespace but rejects every other non-canonical spelling (leading zeros,
// missing parts), so parseCellAddress(formatCellAddress(row, col)) round-trips
// exactly and no two accepted spellings name different cells.

export function formatCellAddress(
  row: number | null | undefined,
  col: number | null | undefined,
): string | null {
  if (row === null || row === undefined || col === null || col === undefined) {
    return null;
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
    return null;
  }
  let letters = '';
  // Bijective base-26 has no zero digit ("A" is 1), hence the -1 shift per step.
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters + String(row + 1);
}

// Inverse of formatCellAddress: "A1" → { row: 0, col: 0 }, "AB3" → { row: 2,
// col: 27 }. Returns null for anything that isn't letters followed by a
// zero-padding-free positive number, or that overflows safe-integer range.
export function parseCellAddress(
  address: string,
): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(address.trim());
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) {
    col = col * 26 + (letter.charCodeAt(0) - 64);
    // Doubles lose integer exactness past 2^53 — reject instead of mis-decoding.
    if (!Number.isSafeInteger(col)) return null;
  }
  const row = Number(match[2]) - 1;
  if (!Number.isSafeInteger(row)) return null;
  return { row, col: col - 1 };
}
