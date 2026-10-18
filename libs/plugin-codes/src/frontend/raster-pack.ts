import { rasterRowBytes } from '@makekeeper/plugin-contract';

// The pure half of label rasterisation (#359): thresholding RGBA pixels into
// the contract's 1-bpp rows.
//
// Apart from `label-raster.ts` because that module reaches for the DOM (a
// canvas, an image decode, the rendered card) while this is arithmetic — the
// part that is easy to get subtly wrong, impossible to see on a 203 dpi
// sticker, and worth testing directly.

// Ink is where the paper is dark: below this luminance, the dot burns. The page
// is drawn in pure black on pure white, so the threshold only decides what
// happens to the anti-aliased edge of a glyph — half-lit pixels become ink,
// which keeps small text legible on a 203 dpi head.
const INK_THRESHOLD = 160;

// Greyscale-ish pixels as a canvas hands them over: RGBA, row-major.
export interface RasterPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// Packs RGBA pixels into the contract's 1-bpp rows (MSB first, a set bit is
// ink). Split out from the drawing so the packing — the part that is easy to
// get subtly wrong and impossible to see — can be checked directly.
export function packPixels(pixels: RasterPixels): Uint8Array {
  const rowBytes = rasterRowBytes(pixels.width);
  const rows = new Uint8Array(rowBytes * pixels.height);
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4;
      // Rec. 601 luma, the same weighting every thresholding tool uses. An
      // alpha of 0 is paper: nothing was drawn there.
      const alpha = pixels.data[i + 3] / 255;
      const luma =
        (0.299 * pixels.data[i] +
          0.587 * pixels.data[i + 1] +
          0.114 * pixels.data[i + 2]) *
          alpha +
        255 * (1 - alpha);
      if (luma < INK_THRESHOLD) {
        rows[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return rows;
}
