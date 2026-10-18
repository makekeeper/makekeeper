import sharp from 'sharp';
import {
  isValidRaster,
  rasterPixel,
  type PrintRaster,
} from '@makekeeper/plugin-contract';

// The contract's packed 1-bpp page, as a PNG data URI (#364).
//
// Needed because the Home Assistant route does not speak dots: hass-niimbot
// renders an image onto a label-sized canvas, so the page has to arrive as a
// picture. The picture is the same page the Bluetooth driver sends row for
// row — `codes` rasterises the card it is previewing, and this only changes
// the wrapping, never the pixels.
//
// Grayscale, one byte per pixel, rather than a 1-bit PNG: sharp cannot emit
// bit depth 1 at all, and its palette path depends on libimagequant being
// compiled into the build — not something to make a print path rely on. A
// two-tone image of this size costs nothing either way (a 320 × 240 label
// lands in a few kilobytes once zlib has seen the long runs).

const INK = 0;
const PAPER = 255;

// Home Assistant takes this inside a JSON body, so the whole label travels as
// one string. A few kilobytes is the expectation; a megabyte means something
// upstream is wrong, and posting it at a household server is not the way to
// find out.
export const MAX_DATA_URI_BYTES = 256 * 1024;

export class RasterEncodeError extends Error {
  constructor(readonly errorKey: string) {
    super(errorKey);
    this.name = 'RasterEncodeError';
  }
}

export async function rasterToPngDataUri(raster: PrintRaster): Promise<string> {
  if (!isValidRaster(raster)) {
    throw new RasterEncodeError('printingNiimbot.ha.errors.badRaster');
  }
  const { widthDots, heightDots } = raster;
  const pixels = Buffer.alloc(widthDots * heightDots, PAPER);
  for (let y = 0; y < heightDots; y += 1) {
    const row = y * widthDots;
    for (let x = 0; x < widthDots; x += 1) {
      if (rasterPixel(raster, x, y)) pixels[row + x] = INK;
    }
  }
  let png: Buffer;
  try {
    png = await sharp(pixels, {
      raw: { width: widthDots, height: heightDots, channels: 1 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new RasterEncodeError('printingNiimbot.ha.errors.encodeFailed');
  }
  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  if (dataUri.length > MAX_DATA_URI_BYTES) {
    throw new RasterEncodeError('printingNiimbot.ha.errors.payloadTooLarge');
  }
  return dataUri;
}
