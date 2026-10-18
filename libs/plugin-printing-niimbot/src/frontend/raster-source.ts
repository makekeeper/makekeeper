import { rasterPixel, type PrintRaster } from '@makekeeper/plugin-contract';

// Bridge between the transport-agnostic `PrintRaster` of the contract and
// niimbluelib's `ImageSource` (#359).
//
// The library's own entry point is `ImageEncoder.encodeCanvas`, which needs a
// DOM canvas. The contract deliberately carries BYTES instead: a raster must be
// expressible over an API so a server-side driver (#362) can print the very same
// page. So the driver hands the encoder an image source backed by the packed
// rows, and no canvas is involved below the consumer's own drawing code.
//
// Colours are the encoder's, not ours: it classifies pixels as white
// (background), black (first colour) or red (second). A set bit is ink, i.e.
// black; everything else is white.
const WHITE = 0xffffff;
const BLACK = 0x000000;

export interface RasterImageSource {
  readonly width: number;
  readonly height: number;
  getPixelColor(x: number, y: number): number;
}

export function rasterImageSource(raster: PrintRaster): RasterImageSource {
  return {
    width: raster.widthDots,
    height: raster.heightDots,
    // The signature the library calls takes a print direction too; `top` (the
    // B1's) is the identity mapping, and this driver prints nothing else — a
    // rotating source would be a second geometry to verify on paper.
    getPixelColor: (x, y) => (rasterPixel(raster, x, y) ? BLACK : WHITE),
  };
}
