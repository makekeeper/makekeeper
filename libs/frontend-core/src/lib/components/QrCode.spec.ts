import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import sharp from 'sharp';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import QrCode from './QrCode.vue';

// The check the design handoff makes mandatory, and the reason this spec is
// worth its runtime: any change to the geometry (module radius, finder radii,
// the window carrying the mark) or to the palette has to be verified by
// DECODING a raster, not by looking at a preview. A small preview decodes even
// when the geometry is broken — downscaling smooths the gaps away — so the
// handoff calls for 1024 and 2048 px.
//
// It has already earned its keep twice: it is what caught that an accent one
// step lighter (`brand-500`) stops binarising in most schemes, and that
// inverting the code for dark mode makes it undecodable outright.
//
// It also guards the printed label, at the raster a thermal printer actually
// produces — see the print test at the bottom.
//
// The component paints from Tailwind utilities, which no test environment
// resolves, so the class names are mapped back to the palette they stand for.
// Values are copied from `themes.css` / Tailwind's own ramps; if a scheme's
// accent moves, this map moves with it.
type Palette = { plate: string; module: string; accent: string };

// Per scheme: the accent the code is drawn with (`brand-600`) and the plate
// tint dark mode uses (`brand-50`).
const SCHEME_ACCENTS: Record<string, { accent: string; tint: string }> = {
  default: { accent: '#2563eb', tint: '#eff6ff' },
  violet: { accent: '#7c3aed', tint: '#f5f3ff' },
  teal: { accent: '#0f766e', tint: '#f0fdfa' },
  sunset: { accent: '#c2410c', tint: '#fff7ed' },
  orchid: { accent: '#c026d3', tint: '#fdf4ff' },
  graphite: { accent: '#475569', tint: '#f8fafc' },
};

const SLATE_900 = '#0f172a';

/** The component's markup with its utility classes resolved to real colours. */
function paint(markup: string, palette: Palette): string {
  return markup.replace(/class="([^"]*)"/g, (_, classes: string) => {
    const isStroke = classes.includes('stroke-');
    const isAccent = classes.includes('brand-6');
    const isPlate = classes.includes('fill-white');
    const colour = isAccent
      ? palette.accent
      : isPlate
        ? palette.plate
        : palette.module;
    return isStroke ? `stroke="${colour}"` : `fill="${colour}"`;
  });
}

async function decode(
  markup: string,
  palette: Palette,
  size: number,
): Promise<string | null> {
  // Width and height are set on the root so the SVG rasterises AT that size
  // rather than being rendered small and scaled up: the component ships a
  // viewBox alone, and resampling a 41px render is not what a screen or a
  // printer does.
  const sized = paint(markup, palette).replace(
    '<svg ',
    `<svg width="${size}" height="${size}" `,
  );
  const { data, info } = await sharp(Buffer.from(sized))
    // The plate already covers the whole viewBox; flattening only drops the
    // alpha channel sharp hands back for an SVG, so the luminance pass below
    // reads real pixels rather than transparent ones.
    .flatten({ background: palette.plate })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ZXing wants one luminance byte per pixel; sharp hands back RGB triplets.
  const luminance = new Uint8ClampedArray(info.width * info.height);
  for (let i = 0; i < luminance.length; i++) {
    const p = i * info.channels;
    luminance[i] =
      (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }

  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.TRY_HARDER, true]]));
  try {
    return reader
      .decode(
        new BinaryBitmap(
          new HybridBinarizer(
            new RGBLuminanceSource(luminance, info.width, info.height),
          ),
        ),
      )
      .getText();
  } catch {
    return null;
  }
}

/**
 * Mounts and waits for the code to actually appear. One `flushPromises` is not
 * enough: the component loads its encoder with a dynamic import, so the first
 * mount in a run waits on module resolution rather than on a microtask.
 */
async function render(
  value: string,
  variant: 'themed' | 'print' = 'themed',
): Promise<string> {
  const wrapper = mount(QrCode, { props: { value, variant } });
  for (
    let attempt = 0;
    attempt < 50 && !wrapper.html().includes('<path');
    attempt++
  ) {
    await flushPromises();
  }
  const markup = wrapper.html();
  expect(markup).toContain('<path');
  return markup;
}

// The two grids the app actually produces: a tunnelled pairing URL (61×61 at
// level H) and a short-code deep link (33×33).
const LONG =
  'https://court-discussions-reviewer-featured.trycloudflare.com/m/pair?code=bSpwLA51RMf59HP33XjAJ6gDiWrI8YH4y4fbQCZVOb4&lang=en';
const SHORT = 'http://localhost/c/STG-Y663P';

describe('QrCode', () => {
  for (const [scheme, accent] of Object.entries(SCHEME_ACCENTS)) {
    // Light and dark differ only in the plate: the code stays dark-on-light in
    // both, which is the whole point of the palette.
    for (const [theme, plate] of [
      ['light', '#ffffff'],
      ['dark', accent.tint],
    ] as const) {
      it(`decodes the ${scheme} scheme in ${theme}`, async () => {
        const palette = { plate, module: SLATE_900, accent: accent.accent };
        for (const value of [LONG, SHORT]) {
          const markup = await render(value);
          for (const size of [1024, 2048]) {
            expect(await decode(markup, palette, size)).toBe(value);
          }
        }
      });

      it(`decodes the ${scheme} scheme in ${theme} at the size it is shown`, async () => {
        // A camera can only resolve what the screen renders, so the size the
        // app DRAWS the code at is the real floor, not the 2048px ideal. The
        // app's smallest is 240 CSS px (`w-60`, the pairing dialog); this holds
        // the line one notch below it.
        const palette = { plate, module: SLATE_900, accent: accent.accent };
        expect(await decode(await render(LONG), palette, 208)).toBe(LONG);
      });
    }
  }

  const INK = { plate: '#ffffff', module: SLATE_900, accent: SLATE_900 };

  it('decodes the print variant', async () => {
    const markup = await render(LONG, 'print');
    for (const size of [1024, 2048]) {
      expect(await decode(markup, INK, size)).toBe(LONG);
    }
  });

  // The size that actually matters for `plugin-codes`, and the one a screen
  // preview flatters: a 23mm label on a 203dpi thermal head is 184 px. The
  // label carries the mark like every other code — that only works because the
  // mark is snapped to the module grid (see `qr-code.ts`); scaled freely it
  // needed roughly 416 px, more than twice what the printer gives it.
  it('decodes a printed short code at thermal resolution, mark and all', async () => {
    const markup = await render(SHORT, 'print');
    // Plate + window + ring + the mark's 21 cells: the label is fully branded.
    expect((markup.match(/<rect/g) ?? []).length).toBe(24);
    for (const px of [144, 23 * 8, 320]) {
      expect(await decode(markup, INK, px)).toBe(SHORT);
    }
  });

  it('does not decode when inverted — why dark mode keeps a light plate', async () => {
    const markup = await render(LONG);
    const inverted = { plate: '#0c1322', module: '#f1f5f9', accent: '#60a5fa' };
    expect(await decode(markup, inverted, 1024)).toBeNull();
    expect(await decode(markup, inverted, 2048)).toBeNull();
  });

  it('is decorative unless given a label', async () => {
    const wrapper = mount(QrCode, { props: { value: 'x' } });
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
    const labelled = mount(QrCode, { props: { value: 'x', label: 'Pair' } });
    expect(labelled.get('svg').attributes('role')).toBe('img');
    expect(labelled.get('svg').attributes('aria-label')).toBe('Pair');
  });
});
