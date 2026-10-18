// The `printing` contract (#359): a plugin hands a driver a raster, the driver
// puts it on a label.
//
// Deliberately small. A driver takes a page size in dots and packed 1-bpp rows
// and reports progress; it knows nothing about labels, queues, paper profiles or
// what a QR code is. That keeps the consumer side generic — `codes` offers
// "Print on <driver>" for whatever is registered, and a second driver (ESC/POS,
// a BLE bridge) needs no change on the consumer side.
//
// TRANSPORT-AGNOSTIC on purpose: Web Bluetooth exists in Chromium only, so a
// driver may run in the browser OR in a process next to the printer. Everything
// here is therefore expressible over an API — a raster is bytes plus a size, a
// progress report is numbers, an error is an i18n key.

// One page to print: a bitmap where a set bit is ink.
//
// Rows are packed MSB-first, `rowBytes(widthDots)` bytes per row, top row
// first, left pixel in the high bit — the order every thermal printhead this
// contract targets expects, and the order `rasterRowBytes` produces.
export interface PrintRaster {
  widthDots: number;
  heightDots: number;
  // `heightDots * rowBytes(widthDots)` bytes.
  rows: Uint8Array;
}

// Bytes one packed row occupies.
export function rasterRowBytes(widthDots: number): number {
  return Math.ceil(widthDots / 8);
}

// Is this raster self-consistent? A driver checks it before touching hardware:
// a half-row short raster is a caller bug, and finding it at the seam is much
// cheaper than finding it as half a printed label.
export function isValidRaster(raster: PrintRaster): boolean {
  return (
    Number.isInteger(raster.widthDots) &&
    Number.isInteger(raster.heightDots) &&
    raster.widthDots > 0 &&
    raster.heightDots > 0 &&
    raster.rows.length === raster.heightDots * rasterRowBytes(raster.widthDots)
  );
}

// Is the dot at (x, y) ink? Anything outside the page is paper — a driver
// reading a row wider than the raster gets blank, never a wrapped neighbour.
//
// Here rather than in a driver because every driver needs it and the packing is
// the contract's: the browser driver and a remote bridge must agree on which bit
// is which dot, or one of them prints a mirror of the other.
export function rasterPixel(
  raster: PrintRaster,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= raster.widthDots || y >= raster.heightDots) {
    return false;
  }
  const byte = raster.rows[y * rasterRowBytes(raster.widthDots) + (x >> 3)];
  return ((byte >> (7 - (x & 7))) & 1) === 1;
}

// A page as it travels over an API: the same raster, with the rows as base64
// because every hop between a browser, the core and a container is JSON.
//
// One shape, declared once, because this clump had started travelling loose —
// two DTOs, a handoff row, a relay body and a container's payload parser each
// restating the same four fields, and each free to disagree about what `rows`
// is counted in.
export interface PrintRasterPayload {
  widthDots: number;
  heightDots: number;
  // Base64 of the packed 1-bpp rows, MSB first, a set bit is ink.
  rows: string;
  copies: number;
}

// Chunked rather than `btoa(String.fromCharCode(...bytes))`, which throws on a
// page-sized raster: a 384 × 240 label is 11 520 bytes, well past the argument
// limit a spread hits.
export function encodeRasterPayload(
  raster: PrintRaster,
  copies = 1,
): PrintRasterPayload {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < raster.rows.length; i += CHUNK) {
    binary += String.fromCharCode(...raster.rows.subarray(i, i + CHUNK));
  }
  return {
    widthDots: raster.widthDots,
    heightDots: raster.heightDots,
    rows: base64Encode(binary),
    copies: Math.max(1, Math.round(copies)),
  };
}

// The way back. Returns null for anything that is not a page — a size that is
// not a size, or rows that do not fill it — so a caller never hands half a
// label to a printhead. `isValidRaster` is the same check a driver does; here
// it guards the wire.
export function decodeRasterPayload(
  payload: PrintRasterPayload,
): PrintRaster | null {
  if (
    !Number.isInteger(payload.widthDots) ||
    !Number.isInteger(payload.heightDots) ||
    typeof payload.rows !== 'string'
  ) {
    return null;
  }
  const binary = base64Decode(payload.rows);
  const rows = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) rows[i] = binary.charCodeAt(i);
  const raster: PrintRaster = {
    widthDots: payload.widthDots,
    heightDots: payload.heightDots,
    rows,
  };
  return isValidRaster(raster) ? raster : null;
}

// base64 without picking a side: this file is imported by a browser bundle, by
// NestJS and by a plain Node container, and `btoa`/`Buffer` each exist in only
// some of them. The contract may not depend on a runtime (§5.1's "zero
// framework imports" applied to globals).
function base64Encode(binary: string): string {
  const globals = globalThis as {
    btoa?: (value: string) => string;
    Buffer?: {
      from(
        value: string,
        encoding: string,
      ): { toString(encoding: string): string };
    };
  };
  if (globals.btoa) return globals.btoa(binary);
  if (globals.Buffer) {
    return globals.Buffer.from(binary, 'binary').toString('base64');
  }
  throw new Error('printing.errors.noBase64');
}

function base64Decode(value: string): string {
  const globals = globalThis as {
    atob?: (value: string) => string;
    Buffer?: {
      from(
        value: string,
        encoding: string,
      ): { toString(encoding: string): string };
    };
  };
  if (globals.atob) return globals.atob(value);
  if (globals.Buffer) {
    return globals.Buffer.from(value, 'base64').toString('binary');
  }
  throw new Error('printing.errors.noBase64');
}

// What a driver says about itself. Identity plus the two facts a consumer needs
// to lay a label out: how wide the printhead is and at what resolution.
export interface PrintDriverDescriptor {
  // Unique driver id. Prefixed with the owning plugin's id, like a capability
  // id, so two drivers can never collide: `printing-niimbot.b1`.
  id: string;
  pluginId: string;
  // i18n key naming the driver in the UI ("Niimbot B1", "Workshop bridge").
  nameKey: string;
  // i18n key for HOW this driver reaches the printer, in the consumer's own
  // words: "via this browser's Bluetooth", "via the workshop bridge". A
  // consumer shows it under the printer's name, because the printer is the
  // destination and the route is a detail that can change under it — pair a
  // bridge and the same printer starts working from a phone.
  //
  // Optional: a driver that has only one way to be reached says nothing, and
  // the consumer prints the name alone.
  routeKey?: string;
  // Values for the slots inside `nameKey`/`routeKey` — the printer's own name
  // as its owner knows it ("Workshop B1"), which is DATA and so travels as a
  // parameter rather than as a composed string (§5.5). The consumer resolves
  // both keys with it; presentation stays in the consumer's component, so a
  // locale value holds a sentence with a slot and never a separator (§5.4).
  //
  // A driver that is the only one of its kind omits it, and the keys resolve
  // with no parameters exactly as before.
  nameParams?: Record<string, string>;
  // Printhead width in dots — the hard ceiling on a raster's width.
  maxWidthDots: number;
  dpi: number;
}

// Per-page options a consumer may ask for. Everything else (which device,
// which paper) is the driver's own configuration, not the consumer's business.
export interface PrintJobOptions {
  // How many copies of the raster to print. Default 1.
  copies?: number;
}

// Where a job is. `rowsDone` counts rows the printer has acknowledged, so a
// consumer can show real progress rather than a spinner.
//
// `rowsTotal: 0` means "I cannot count": a driver that prints through a single
// remote call has no row-level feedback to pass on, and a consumer must then
// say "printing…" rather than draw a bar stuck at 0 of 240. Inventing a total
// is the one thing a progress report must not do — #359 found a job that
// reported 100 % with a quarter of the label printed.
export interface PrintProgress {
  stage: 'connecting' | 'sending' | 'printing' | 'finishing';
  rowsDone: number;
  rowsTotal: number;
}

// How a job ended. A failure carries an i18n KEY, never prose (§5.5) — the
// driver may be a remote process that has no idea what locale the person reads.
export type PrintResult =
  | { ok: true }
  | { ok: false; errorKey: string; params?: Record<string, string | number> };

// A one-time link that prints THIS page in another browser (#361).
//
// The gap it fills is a browser fact: a driver may exist and be enabled and
// still be unusable here, because Web Bluetooth is Chromium-only. A driver that
// can park a page offers this instead of refusing — the link opens in a browser
// standing near the printer, with no login.
export interface PrintHandoffLink {
  url: string;
  // ISO timestamp. The link stops working then, at its attempt ceiling, or on
  // the first successful print — whichever comes first.
  expiresAt: string;
}

// The shared prefix of the family. A consumer cannot know the plugin ids in
// advance — a driver may arrive with a container someone installed this morning
// — so it asks the registry for everything under this prefix.
export const PRINT_DRIVER_CAPABILITY_PREFIX = 'printing.driver.';

// A SERVER-SIDE driver (#362) registers under this capability id, one per
// owning plugin — the backend half of the same contract. The browser-side
// registry is `frontend-core`'s; both answer the same question ("what can print
// this raster right now?") on their own side of the wire.
export const printDriverCapability = (pluginId: string): string =>
  `${PRINT_DRIVER_CAPABILITY_PREFIX}${pluginId}`;

// A server-side driver's surface. `describe` is asked often (every print
// dialog) and must not touch the hardware; `print` owns the device.
export interface PrintDriverCapability {
  describe(): Promise<PrintDriverDescriptor | null>;
  print(
    raster: PrintRaster,
    options: PrintJobOptions,
  ): Promise<PrintResult & { jobId?: string }>;
}
