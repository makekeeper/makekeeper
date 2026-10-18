import {
  isValidRaster,
  printDriverCapability,
  rasterPixel,
  rasterRowBytes,
  type PrintRaster,
} from './printing';

describe('rasterRowBytes', () => {
  it('rounds up to whole bytes', () => {
    expect(rasterRowBytes(8)).toBe(1);
    expect(rasterRowBytes(9)).toBe(2);
    expect(rasterRowBytes(384)).toBe(48);
  });
});

describe('isValidRaster', () => {
  const raster = (
    widthDots: number,
    heightDots: number,
    bytes: number,
  ): PrintRaster => ({
    widthDots,
    heightDots,
    rows: new Uint8Array(bytes),
  });

  it('accepts a raster whose rows match its size', () => {
    expect(isValidRaster(raster(384, 240, 48 * 240))).toBe(true);
  });

  it('rejects a raster that is short of a full page', () => {
    expect(isValidRaster(raster(384, 240, 48 * 239))).toBe(false);
  });

  it('rejects empty and non-integer sizes', () => {
    expect(isValidRaster(raster(0, 10, 0))).toBe(false);
    expect(isValidRaster(raster(384, 0, 0))).toBe(false);
    expect(isValidRaster(raster(384.5, 2, 2 * 49))).toBe(false);
  });
});

describe('printDriverCapability', () => {
  it('namespaces a backend driver by its owning plugin', () => {
    expect(printDriverCapability('printing-niimbot')).toBe(
      'printing.driver.printing-niimbot',
    );
  });
});

describe('rasterPixel', () => {
  // 9 dots wide: the second byte of each row carries one used bit, so the
  // padding of a non-byte-aligned width is exercised too.
  const page: PrintRaster = {
    widthDots: 9,
    heightDots: 2,
    rows: new Uint8Array([
      0b10000001,
      0b10000000, // row 0: x = 0, 7, 8
      0b00000000,
      0b00000000, // row 1: blank
    ]),
  };

  it('reads bits MSB-first, left dot in the high bit', () => {
    expect(rasterPixel(page, 0, 0)).toBe(true);
    expect(rasterPixel(page, 1, 0)).toBe(false);
    expect(rasterPixel(page, 7, 0)).toBe(true);
    expect(rasterPixel(page, 8, 0)).toBe(true);
    expect(rasterPixel(page, 0, 1)).toBe(false);
  });

  it('treats everything outside the page as paper', () => {
    expect(rasterPixel(page, -1, 0)).toBe(false);
    expect(rasterPixel(page, 9, 0)).toBe(false);
    expect(rasterPixel(page, 0, 2)).toBe(false);
  });
});
