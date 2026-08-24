// The one place a QR code's geometry is decided (#263).
//
// Before this module the app had three generators — a print label, the
// phone-bridge modal and the device-pairing dialog — each passing its own
// `width`/`margin`/`errorCorrectionLevel` literals to the `qrcode` library and
// each getting a plain black square back. This module owns the option set and
// the branded shape instead: rounded modules, rounded finder patterns, and a
// window in the middle carrying the MakeKeeper mark (`brand-mark.ts` — the mark
// is not restated here).
//
// Everything is expressed in MODULE units: the caller renders the returned
// paths into `viewBox="0 0 size size"` and picks the pixel size with CSS. Colour
// is likewise not decided here — `QrCode.vue` paints the paths from the
// cascade, which is what lets a code follow the active theme and colour scheme.
//
// GEOMETRY IS LOAD-BEARING. The radii and the logo-window size below come from
// the design handoff and were checked against a decoder; changing them changes
// whether a scanner still reads the code (the handoff records that a finder
// radius of 2.2 modules breaks the 1:1:3:1:1 proportion scanners look for,
// while 1.4 is safe). Re-verify by decoding a raster, not by eye.

import {
  BRAND_MARK_CELL,
  BRAND_MARK_CELLS,
  BRAND_MARK_GRID,
  BRAND_MARK_PITCH,
} from './brand-mark';

/**
 * Error correction level, fixed at the maximum. The centre window covers real
 * modules, so the redundancy that lets a scanner recover them is not optional —
 * at M or Q the mark stops being safe.
 */
const ERROR_CORRECTION_LEVEL = 'H';

/** Quiet zone per side, in modules. Below 4 scanners lose the symbol's edge. */
const QUIET_ZONE = 4;

/** Corner radius of the code's own background plate, in modules. */
const PLATE_RADIUS = 3.5;

/** Corner radius of a single data module. Must keep neighbours touching. */
const MODULE_RADIUS = 0.3;

/** Finder pattern: outer ring 7×7 minus inner 5×5, then a 3×3 pupil. */
const FINDER_OUTER_RADIUS = 1.4;
const FINDER_INNER_RADIUS = 0.9;
const FINDER_PUPIL_RADIUS = 0.6;

/** How big the mark is allowed to get, as a fraction of the grid's side. */
const LOGO_BASE_FRACTION = 0.085;
const LOGO_MAX_FRACTION = 0.14;
const LOGO_MIN_RADIUS = 4;

/** Share of the modules the window may cover — see `withinBudget` below. */
const LOGO_MAX_COVERAGE = 0.18;

/** Window corner radius, as a fraction of its side. */
const LOGO_WINDOW_RADIUS_FRACTION = 0.26;

/**
 * The ring around the mark, in modules: one module of wall behind one module of
 * clear space — the same treatment a finder pattern's separator gets, which is
 * why the centre reads as deliberate rather than as damage.
 */
const RING_WIDTH = 1;
const RING_GAP = 1;

/** A rounded square as an SVG path, at `size` modules with corner radius `r`. */
function roundedSquare(x: number, y: number, size: number, r: number): string {
  const k = Math.min(r, size / 2);
  const span = size - 2 * k;
  return (
    `M${x + k},${y}h${span}a${k},${k} 0 0 1 ${k},${k}v${span}` +
    `a${k},${k} 0 0 1 ${-k},${k}h${-span}a${k},${k} 0 0 1 ${-k},${-k}` +
    `v${-span}a${k},${k} 0 0 1 ${k},${-k}z`
  );
}

/** One filled cell of the brand mark, positioned inside the logo window. */
export interface QrMarkCell {
  x: number;
  y: number;
  size: number;
}

/** The centre treatment: a knocked-out window, its ring, and the mark inside. */
export interface QrCentre {
  /** The knocked-out window behind the mark. */
  window: { x: number; y: number; size: number; radius: number };
  /** The ring around the mark; stroked, so its width stays one module. */
  ring: { x: number; y: number; size: number; radius: number; width: number };
  /** The mark itself, snapped to the module grid inside the window. */
  mark: QrMarkCell[];
}

/** Everything `QrCode.vue` needs to draw one code, in module units. */
export interface QrGeometry {
  /** Side of the `viewBox`: the grid plus a quiet zone on each side. */
  size: number;
  /** Corner radius of the background plate. */
  plateRadius: number;
  /** Every data module outside the finders and the logo window. */
  modulesPath: string;
  /** The three finder rings (`fill-rule="evenodd"`). */
  finderRingPath: string;
  /** The three finder pupils. */
  finderPupilPath: string;
  /** Null only when the grid is too small to host the mark at all. */
  centre: QrCentre | null;
}

/**
 * Turns a module matrix into the branded geometry.
 *
 * Split from matrix generation on purpose: the matrix comes from a library
 * loaded on demand (see `createQrMatrix`), while this half is pure and can be
 * checked directly.
 *
 * The mark is placed ON THE MODULE GRID — one mark cell spans a whole number of
 * modules and never straddles two. That is not tidiness, it is the difference
 * between a label that scans and one that doesn't: scaled freely (as the design
 * prototype does) the mark becomes a field of sub-module specks, every module it
 * touches reads as an ambiguous grey, and on a 33×33 grid — what a short
 * `/c/<code>` label encodes — ZXing stops decoding below roughly 416 px, where a
 * thermal label at 23 mm and 203 dpi rasterises to 184. Snapped to the grid the
 * same label decodes from 144 px, because the covered modules are simply wrong
 * modules, which is exactly what level H is for. See `QrCode.spec.ts`.
 *
 * The window pays for that in size — 12 modules rather than the handoff's 9 on
 * a 33×33 grid, 13% of the modules rather than 7% — which is why the coverage
 * cap below exists and was measured rather than guessed.
 */
export function buildQrGeometry(matrix: readonly boolean[][]): QrGeometry {
  const n = matrix.length;
  const q = QUIET_ZONE;
  const half = Math.floor(n / 2);

  // How many modules one cell of the mark's 6×6 grid spans. The handoff's
  // fraction of the grid decides how big the mark is ALLOWED to get; the pitch
  // is then the largest whole number of modules that fits inside it, and never
  // below one — see the note above on why a fractional cell cannot ship.
  const allowedRadius = Math.min(
    Math.max(LOGO_MIN_RADIUS, Math.floor(n * LOGO_BASE_FRACTION) + 1),
    Math.floor(n * LOGO_MAX_FRACTION),
  );
  const markPitch = Math.max(
    1,
    Math.floor(
      (allowedRadius * 2 + 1 - (RING_GAP + RING_WIDTH) * 2) / BRAND_MARK_GRID,
    ),
  );

  // The window is then derived from what it must hold rather than from a
  // fraction: the mark, a module of clearance, a module of ring wall, and a
  // module of gap on each side. That side is EVEN, and deliberately so — the
  // mark spans an even number of modules, and an even span centred in an odd
  // window is always half a module off, which is visible as a mark that has
  // slipped inside its own ring. An even window instead puts the half-module
  // between the window and the code as a whole, where nothing has an edge to
  // compare it against.
  const windowSide =
    markPitch * BRAND_MARK_GRID + (RING_GAP + RING_WIDTH + 1) * 2;
  const windowStart = half - windowSide / 2 + 1;
  // What level H is asked to recover. 26% of the modules was measured to break
  // decoding outright and 21% to survive; the cap sits below the tested-good
  // band, and a grid too small to stay under it goes out unbranded rather than
  // unreadable.
  const withinBudget = (windowSide / n) ** 2 <= LOGO_MAX_COVERAGE;

  const inFinder = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const inWindow = (r: number, c: number): boolean =>
    withinBudget &&
    r >= windowStart &&
    r < windowStart + windowSide &&
    c >= windowStart &&
    c < windowStart + windowSide;

  let modulesPath = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c] || inFinder(r, c) || inWindow(r, c)) continue;
      // Full-module squares, deliberately: a shape smaller than its module
      // leaves gaps between neighbours, and gaps break a scanner's grid
      // estimate at high resolution.
      modulesPath += roundedSquare(c + q, r + q, 1, MODULE_RADIUS);
    }
  }

  let finderRingPath = '';
  let finderPupilPath = '';
  for (const [r, c] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    const x = c + q;
    const y = r + q;
    finderRingPath +=
      roundedSquare(x, y, 7, FINDER_OUTER_RADIUS) +
      roundedSquare(x + 1, y + 1, 5, FINDER_INNER_RADIUS);
    finderPupilPath += roundedSquare(x + 2, y + 2, 3, FINDER_PUPIL_RADIUS);
  }

  const windowX = windowStart + q;
  const ringOuter = windowSide - RING_GAP * 2;
  // The mark's own gutter, kept as a fraction of the pitch so the creature
  // reads the same as it does everywhere else in the app; the cell is inset
  // within its module rather than spread across two.
  const markCell = markPitch * (BRAND_MARK_CELL / BRAND_MARK_PITCH);
  // Exactly three modules of margin — gap, wall, clearance — on every side,
  // plus half the gutter, so it is the PAINTED box that sits centred and not
  // the notional one (the last cell's gutter falls outside the ink).
  const markOffset = RING_GAP + RING_WIDTH + 1 + (markPitch - markCell) / 2;

  return {
    size: n + q * 2,
    plateRadius: PLATE_RADIUS,
    modulesPath,
    finderRingPath,
    finderPupilPath,
    centre: !withinBudget
      ? null
      : {
          window: {
            x: windowX,
            y: windowX,
            size: windowSide,
            radius: windowSide * LOGO_WINDOW_RADIUS_FRACTION,
          },
          ring: {
            // Stroked shapes are centred on their path, hence the half-width
            // inset.
            x: windowX + RING_GAP + RING_WIDTH / 2,
            y: windowX + RING_GAP + RING_WIDTH / 2,
            size: ringOuter - RING_WIDTH,
            radius: Math.max(0.1, ringOuter * 0.3 - RING_WIDTH / 2),
            width: RING_WIDTH,
          },
          mark: BRAND_MARK_CELLS.map(([column, row]) => ({
            x: windowX + markOffset + column * markPitch,
            y: windowX + markOffset + row * markPitch,
            size: markCell,
          })),
        },
  };
}

/**
 * Encodes `text` and returns its module matrix.
 *
 * The library is imported on demand so it lands in its own chunk: three
 * surfaces render a code, none of them on a first paint, and every other screen
 * would otherwise pay for the encoder.
 */
export async function createQrMatrix(text: string): Promise<boolean[][]> {
  const { create } = await import('qrcode');
  // An empty string is not encodable; a space is, and renders as a valid code
  // rather than as a thrown error in a component that is merely early.
  const { modules } = create(text || ' ', {
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
  });
  const rows: boolean[][] = [];
  for (let r = 0; r < modules.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < modules.size; c++) row.push(modules.get(r, c) === 1);
    rows.push(row);
  }
  return rows;
}
