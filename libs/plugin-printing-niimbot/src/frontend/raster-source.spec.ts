import type { PrintRaster } from '@makekeeper/plugin-contract';
import { rasterImageSource } from './raster-source';

// A 9-dot-wide, 2-row page: the second byte of each row holds one used bit, so
// the padding bits of a non-byte-aligned width are exercised too.
const raster: PrintRaster = {
  widthDots: 9,
  heightDots: 2,
  rows: new Uint8Array([
    0b10000001,
    0b10000000, // row 0: x = 0, 7, 8
    0b00000000,
    0b00000000, // row 1: blank
  ]),
};

describe('rasterImageSource', () => {
  it('reports the page size and maps ink to black, paper to white', () => {
    const source = rasterImageSource(raster);
    expect([source.width, source.height]).toEqual([9, 2]);
    expect(source.getPixelColor(0, 0)).toBe(0x000000);
    expect(source.getPixelColor(1, 0)).toBe(0xffffff);
    // A dot past the page edge is paper, never a wrapped neighbour.
    expect(source.getPixelColor(9, 0)).toBe(0xffffff);
  });
});
