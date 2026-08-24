import { describe, it, expect } from 'vitest';
import { buildQrGeometry, createQrMatrix, type QrCentre } from './qr-code';

// A grid of the given side with every module dark — the worst case for the
// window, and enough to check placement without pinning a specific payload.
const solid = (n: number): boolean[][] =>
  Array.from({ length: n }, () => Array.from({ length: n }, () => true));

/** The centre treatment of a code built with the mark on — never null there. */
const centreOf = (n: number): QrCentre => {
  const { centre } = buildQrGeometry(solid(n));
  if (!centre) throw new Error(`no centre for a ${n}-module grid`);
  return centre;
};

describe('buildQrGeometry', () => {
  it('adds a four-module quiet zone on every side', () => {
    expect(buildQrGeometry(solid(33)).size).toBe(41);
    expect(buildQrGeometry(solid(61)).size).toBe(69);
  });

  it('sits the window on the code centre, to within half a module', () => {
    for (const n of [33, 45, 61, 77]) {
      const { size } = buildQrGeometry(solid(n));
      const { window } = centreOf(n);
      // Even-sided on purpose (see `qr-code.ts`), so it cannot be exactly
      // centred on an odd grid — half a module is the whole budget.
      expect(window.size % 2).toBe(0);
      const slack = Math.abs(window.x - (size - window.x - window.size));
      expect(slack).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the window inside what level H can recover', () => {
    // From version 3 up. At level H a smaller grid holds under 15 bytes, which
    // no URL fits, so the window's degenerate range is unreachable in the app.
    for (const n of [29, 33, 45, 61, 77, 101]) {
      const { window } = centreOf(n);
      // 26% of the modules was measured to break decoding and 21% to survive;
      // the cap sits below the tested-good band and well inside what level H
      // recovers, leaving the rest of the budget for real-world damage.
      expect((window.size / n) ** 2).toBeLessThanOrEqual(0.18);
      // …and room for the mark, a module of clearance, the ring, and the gap.
      expect(window.size).toBeGreaterThanOrEqual(12);
    }
  });

  it('draws no data module inside the window or the finders', () => {
    const { modulesPath } = buildQrGeometry(solid(33));
    const { window } = centreOf(33);
    // Every module is emitted as `M<x>,<y>…`; collect the origins back out.
    const origins = [...modulesPath.matchAll(/M([\d.]+),([\d.]+)h/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    expect(origins.length).toBeGreaterThan(0);
    for (const [x, y] of origins) {
      const inWindow =
        x >= window.x &&
        x < window.x + window.size &&
        y >= window.y &&
        y < window.y + window.size;
      expect(inWindow).toBe(false);
      // Finder zones, in viewBox coordinates (4-module quiet zone offset).
      const finder = (fx: number, fy: number): boolean =>
        x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
      expect(finder(4, 4) || finder(4 + 26, 4) || finder(4, 4 + 26)).toBe(
        false,
      );
    }
  });

  it('keeps the ring one module thick and inside the window', () => {
    const { ring, window } = centreOf(61);
    expect(ring.width).toBe(1);
    expect(ring.x - ring.width / 2).toBeGreaterThanOrEqual(window.x);
    expect(ring.x + ring.size + ring.width / 2).toBeLessThanOrEqual(
      window.x + window.size,
    );
  });

  it('fits the whole brand mark inside the ring', () => {
    const { mark, ring } = centreOf(61);
    expect(mark).toHaveLength(21);
    const left = Math.min(...mark.map((c) => c.x));
    const right = Math.max(...mark.map((c) => c.x + c.size));
    expect(left).toBeGreaterThan(ring.x);
    expect(right).toBeLessThan(ring.x + ring.size);
  });

  it('has no centre at all on a grid no URL reaches', () => {
    // A version-1 grid (21×21) holds seven bytes. Its window is five modules —
    // too few for a six-cell mark at one module each — so the code goes out
    // unbranded rather than unreadable.
    expect(buildQrGeometry(solid(21)).centre).toBeNull();
  });

  it('snaps every mark cell to the module grid', () => {
    // The property the printed label depends on: a cell starts on a module
    // boundary and spans a whole number of them, so each module it covers is
    // cleanly wrong rather than ambiguously grey.
    for (const n of [33, 45, 61, 101]) {
      const { mark } = centreOf(n);
      const pitch = mark[1].x - mark[0].x;
      expect(Number.isInteger(pitch)).toBe(true);
      expect(pitch).toBeGreaterThanOrEqual(1);
      // The property that matters: every cell sits on the same whole-module
      // lattice, inset by its gutter and nothing more, so a module is either
      // the mark's or the code's and never half of each.
      const gutter = mark[0].x - Math.floor(mark[0].x);
      expect(gutter).toBeLessThan(0.1);
      expect(mark[0].size + gutter * 2).toBeCloseTo(pitch, 6);
      for (const cell of mark) {
        expect((cell.x - mark[0].x) % pitch).toBeCloseTo(0, 6);
        expect((cell.y - mark[0].y) % pitch).toBeCloseTo(0, 6);
      }
    }
  });

  it('centres the painted mark inside its ring', () => {
    // The bug this pins: an even mark span centred in an odd window lands half
    // a module off, and the eye reads that against the ring around it.
    for (const n of [33, 61, 101]) {
      const { mark, ring, window } = centreOf(n);
      const left = Math.min(...mark.map((c) => c.x));
      const right = Math.max(...mark.map((c) => c.x + c.size));
      const top = Math.min(...mark.map((c) => c.y));
      const bottom = Math.max(...mark.map((c) => c.y + c.size));
      expect((left + right) / 2).toBeCloseTo(window.x + window.size / 2, 10);
      expect((top + bottom) / 2).toBeCloseTo(window.y + window.size / 2, 10);
      // …and it clears the ring's wall by about a module on every side.
      const clearance = left - (ring.x + ring.width / 2);
      expect(clearance).toBeGreaterThan(0.9);
      expect(clearance).toBeLessThan(1.2);
    }
  });
});

describe('createQrMatrix', () => {
  it('encodes at level H — the grid is bigger than the same text at M', async () => {
    const { create } = await import('qrcode');
    const url = 'https://example.test/m/pair?code=abcdefghijklmnop&lang=en';
    const atM = create(url, { errorCorrectionLevel: 'M' }).modules.size;
    const matrix = await createQrMatrix(url);
    expect(matrix.length).toBeGreaterThan(atM);
  });

  it('renders an empty value instead of throwing', async () => {
    await expect(createQrMatrix('')).resolves.toHaveLength(21);
  });
});
