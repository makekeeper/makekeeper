import sharp from 'sharp';
import { rasterRowBytes, type PrintRaster } from '@makekeeper/plugin-contract';
import { rasterToPngDataUri } from './raster-png';

// The one thing this encoder must not get wrong is which dots are ink: a
// label that prints inverted is unreadable and would pass any test that only
// checked the bytes came out as a PNG. So the PNG is decoded back and compared
// pixel for pixel against the page that went in.

function rasterOf(
  widthDots: number,
  heightDots: number,
  ink: (x: number, y: number) => boolean,
): PrintRaster {
  const stride = rasterRowBytes(widthDots);
  const rows = new Uint8Array(stride * heightDots);
  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      if (ink(x, y)) rows[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthDots, heightDots, rows };
}

async function decode(
  dataUri: string,
): Promise<{ width: number; height: number; pixels: Buffer }> {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const image = sharp(Buffer.from(base64, 'base64'));
  const { data, info } = await image
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data };
}

describe('rasterToPngDataUri', () => {
  it('is a PNG data URI', async () => {
    const raster = rasterOf(8, 8, () => false);
    const uri = await rasterToPngDataUri(raster);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('keeps every dot where it was, with ink black and paper white', async () => {
    // A diagonal plus the leftmost and rightmost columns: enough to catch a
    // transposed axis, an off-by-one stride and an inverted page at once.
    const ink = (x: number, y: number): boolean =>
      x === y || x === 0 || x === 7;
    const raster = rasterOf(8, 8, ink);
    const { width, height, pixels } = await decode(
      await rasterToPngDataUri(raster),
    );
    expect([width, height]).toEqual([8, 8]);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        expect(pixels[y * 8 + x]).toBe(ink(x, y) ? 0 : 255);
      }
    }
  });

  it('handles a width that is not a whole number of bytes', async () => {
    // 12 dots is a byte and a half: the padding bits of the second byte must
    // not reach the image, or the right edge grows a phantom line.
    const raster = rasterOf(12, 2, (x) => x === 11);
    const { width, pixels } = await decode(await rasterToPngDataUri(raster));
    expect(width).toBe(12);
    expect(pixels[11]).toBe(0);
    expect(pixels[10]).toBe(255);
  });

  it('refuses a page whose rows do not match its size', async () => {
    const broken: PrintRaster = {
      widthDots: 16,
      heightDots: 4,
      rows: new Uint8Array(3),
    };
    await expect(rasterToPngDataUri(broken)).rejects.toMatchObject({
      errorKey: 'printingNiimbot.ha.errors.badRaster',
    });
  });

  it('keeps a full-size label small enough to post as JSON', async () => {
    // The real page: 40 × 30 mm at 203 dpi, half covered in ink.
    const raster = rasterOf(320, 240, (x, y) => (x + y) % 3 === 0);
    const uri = await rasterToPngDataUri(raster);
    expect(uri.length).toBeLessThan(64 * 1024);
  });
});
