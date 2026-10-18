import { packPixels, type RasterPixels } from './raster-pack';
import { transformText } from './label-raster';

// RGBA pixels as a canvas hands them over, built from a tiny ASCII picture so
// the expectation below reads as the page it describes.
function pixels(rows: string[]): RasterPixels {
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const i = (y * width + x) * 4;
      const value = cell === '#' ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    });
  });
  return { width, height: rows.length, data };
}

describe('packPixels', () => {
  it('packs ink MSB-first, one bit per dot', () => {
    const packed = packPixels(pixels(['#......#', '........']));
    expect([...packed]).toEqual([0b10000001, 0b00000000]);
  });

  it('pads a non-byte-aligned row to whole bytes', () => {
    const packed = packPixels(pixels(['#.......#']));
    expect(packed.length).toBe(2);
    expect([...packed]).toEqual([0b10000000, 0b10000000]);
  });

  it('treats a fully transparent pixel as paper', () => {
    // Nothing was drawn: the canvas reports black with alpha 0, which must not
    // come out as a burnt dot (the bug that prints a solid label).
    const blank: RasterPixels = {
      width: 8,
      height: 1,
      data: new Uint8ClampedArray(8 * 4),
    };
    expect([...packPixels(blank)]).toEqual([0]);
  });
});

// `text-transform` decides what the WORDS are, so the raster has to apply it or
// a card wearing `uppercase` prints one casing beside a preview showing another.
describe('transformText', () => {
  it('applies the transforms a card can wear', () => {
    expect(transformText('MakeKeeper', 'uppercase')).toBe('MAKEKEEPER');
    expect(transformText('MakeKeeper', 'lowercase')).toBe('makekeeper');
    expect(transformText('make keeper', 'capitalize')).toBe('Make Keeper');
  });

  it('leaves the text alone when nothing transforms it', () => {
    expect(transformText('MakeKeeper', 'none')).toBe('MakeKeeper');
    // A value this repo's styles cannot produce is passed through rather than
    // guessed at.
    expect(transformText('MakeKeeper', 'full-width')).toBe('MakeKeeper');
  });
});
