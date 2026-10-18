import type { PrintRaster } from '@makekeeper/plugin-contract';
import { packPixels } from './raster-pack';

// Turning the label ON SCREEN into dots for a thermal printhead (#359).
//
// There is exactly ONE implementation of the code itself, and it is not here:
// `LabelCard` already renders it — the branded QR through `QrCode.vue` /
// `qr-code.ts`, the Code128 strip through JsBarcode — and that is what the
// dialog previews and what the system print dialog puts on paper. So this
// module does not generate a code; it takes the rendered `<svg>` out of the
// card and rasterises it. The printed sticker is then the previewed sticker by
// construction, and a change to the code's geometry (error-correction level,
// quiet zone, the mark in the middle) reaches the printer without anybody
// remembering to copy it.
//
// What it does add is the paint and the page:
//
// - **Paint.** The card's SVG colours itself with Tailwind classes, which mean
//   nothing in a detached document — every path would fall back to black and
//   the code's white plate would print solid. So the clone carries the paint
//   the page actually computed, read off the live nodes.
// - **Page.** The millimetres below are `THERMAL_CSS`'s in
//   `PrintLabelDialog.vue` — 1.5 mm padding, a 23 mm square QR, 1 mm gap, a
//   7 pt short code — converted at the driver's own resolution. The two sets
//   must change together; that is why they are restated rather than guessed.

const MM_PER_INCH = 25.4;

// THE LABEL'S GEOMETRY, IN MILLIMETRES — one object, consumed by both paths.
//
// The system print builds its `@page` rule from this (see
// `PrintLabelDialog.vue`) and the rasteriser lays the dots out from it, so the
// two cannot drift: they used to be two sets of numbers with a comment asking
// the next person to keep them in step, which is the kind of promise code
// should not have to make.
export const LABEL_GEOMETRY = {
  // The stock, as `@page size: 40mm 30mm` says. The PAGE a driver gets is as
  // wide as its printhead (48 mm on a B1), and the two are not the same number:
  // everything is therefore laid out inside the STOCK's width, anchored to the
  // left edge, which is the one the paper and the head share. Centring on the
  // head put a 36.5 mm barcode's right quiet zone 2 mm past the label's edge.
  stockWidthMm: 40,
  stockHeightMm: 30,
  paddingMm: 1.5,
  // The code beside its type — the QR's arrangement. 21 mm rather than the
  // 19.5 mm a stacked one gets, because nothing sits above or below it; the
  // group (code + gap + the widest line) still ends inside the stock.
  qrSideMm: 21,
  // What the code may shrink to when the type beside it is wide. Below this a
  // `/c/<code>` symbol's modules fall under the ~0.33 mm a phone camera needs.
  qrMinSideMm: 16,
  sideGapMm: 2,
  gapMm: 1,
  // Type sizes. A point is 1/72 inch; 7 pt is ~20 dots on a 203 dpi head.
  codePt: 7,
  brandPt: 7,
  barcodeWidthMm: 36,
  barcodeHeightMm: 14,
} as const;

// Kept as its own export because the caller sizes the page from it before it
// has anything else to go on.
export const LABEL_HEIGHT_MM = LABEL_GEOMETRY.stockHeightMm;

// The `@media print` rule for the system-print path, built from the SAME
// geometry the rasteriser lays dots out from.
//
// It lives here rather than beside the dialog that injects it because the two
// paths only agree as long as one object decides both: when they were two sets
// of numbers, the preview and the printed sticker drifted twice in one week.
export function thermalPrintCss(): string {
  const g = LABEL_GEOMETRY;
  return `@media print {
  @page { size: ${g.stockWidthMm}mm ${g.stockHeightMm}mm; margin: 0; }
  .codes-print-portal, .codes-print-sheet { margin: 0; padding: 0; }
  .codes-print-sheet {
    width: ${g.stockWidthMm}mm; height: ${g.stockHeightMm}mm; box-sizing: border-box;
    padding: ${g.paddingMm}mm;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  /* Size to content and let the sheet centre it — no height:100% + overflow
     interplay that clipped the code. */
  .codes-print-sheet .label-card {
    border: none; padding: 0; margin: 0; gap: ${g.gapMm}mm;
    display: flex; align-items: center; justify-content: center;
  }
  /* Both lines of type, at the one size they share. The tracking is the card's
     own and is what keeps spreading ink from closing the gaps between
     characters. */
  .codes-print-sheet .label-card .label-card__brand,
  .codes-print-sheet .label-card .label-card__code {
    font-size: ${g.codePt}pt; line-height: 1.1; margin: 0;
  }
  /* The QR's arrangement: code on the left, both lines in a column beside it,
     the group pushed to the left edge — the page is as wide as the printhead
     while the stock may be narrower, and the left edge is the one they share. */
  .codes-print-sheet .label-card--side {
    flex-direction: row; justify-content: flex-start; gap: ${g.sideGapMm}mm; width: 100%;
  }
  .codes-print-sheet .label-card--side .label-card__qr {
    width: ${g.qrSideMm}mm; height: ${g.qrSideMm}mm; max-width: none; max-height: none; flex: none;
  }
  /* The barcode keeps the column: a strip is already wide and short. */
  .codes-print-sheet .label-card:not(.label-card--side) {
    flex-direction: column;
  }
  .codes-print-sheet .label-card__barcode {
    width: ${g.barcodeWidthMm}mm; height: auto; max-height: ${g.barcodeHeightMm}mm;
  }
}`;
}

// Paint properties that decide what a thermal dot does. Copied from the live
// node's computed style onto the clone's presentation attributes, because the
// classes that produced them do not travel with a serialised SVG.
const PAINT = ['fill', 'stroke', 'stroke-width', 'fill-rule'] as const;

// How many dots of the page the stock actually covers. Anything wider is off
// the label, so nothing is drawn there.
function usableWidth(widthDots: number, dotsPerMm: number): number {
  return Math.min(
    widthDots,
    Math.round(LABEL_GEOMETRY.stockWidthMm * dotsPerMm),
  );
}

// The card's two lines of type, by the classes they wear.
const BRAND_SELECTOR = '.label-card__brand';
const CODE_SELECTOR = '.label-card__code';

export interface LabelRasterInput {
  // The element the `LabelCard` is rendered into — the very box the dialog
  // shows. Deliberately a container rather than the card's own root: the
  // component's root is a fragment, so it has no single element to hand over.
  card: HTMLElement;
  widthDots: number;
  // The page's height in dots; the caller converts from millimetres, because
  // only it knows the driver's resolution.
  heightDots: number;
}

// The code's `<svg>` as it is painted right now: a deep clone whose paint is
// frozen into attributes. Returns null when the card has not rendered a code
// yet (the QR encoder loads on demand, so an early call is normal — see
// `awaitCodeSvg`).
function freezeCodeSvg(card: HTMLElement): SVGSVGElement | null {
  const candidates = card.querySelectorAll<SVGSVGElement>(
    '.label-card__qr, .label-card__barcode',
  );
  // THE ONE BEING DISPLAYED, not merely the one with children. `v-show` keeps
  // the barcode in the DOM — and populated — while the QR is chosen, so "first
  // svg with children" printed a stale barcode whenever a press landed in the
  // window before the lazily-encoded QR matrix arrived: the dialog previewed a
  // QR and the printer produced the other code. `display` is what `v-show`
  // actually changes, so that is what this asks.
  //
  // `Array.from`, not a spread: a `NodeList` is only iterable under a lib that
  // includes the DOM's iterable additions, and this module is type-checked by
  // the plugin's jest config too.
  const live = Array.from(candidates).find(
    (svg) =>
      svg.childElementCount > 0 && getComputedStyle(svg).display !== 'none',
  );
  if (!live) return null;
  const clone = live.cloneNode(true);
  // A guard rather than a cast (§5.1): `cloneNode` is typed as `Node`, and the
  // honest way to get back to an `<svg>` is to ask.
  if (!(clone instanceof SVGSVGElement)) return null;
  const liveNodes = [live, ...Array.from(live.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  liveNodes.forEach((node, index) => {
    const target = cloneNodes[index];
    if (!target) return;
    const computed = getComputedStyle(node);
    for (const property of PAINT) {
      const value = computed.getPropertyValue(property);
      if (value) target.setAttribute(property, value);
    }
    // Inside the code, the classes are what was just resolved; leaving them in
    // invites a reader to think they still do something. The ROOT keeps its
    // class, because that is what says WHICH representation this is — and
    // stripping it made every barcode measure itself as a square QR, which is
    // how a scannable 36 mm strip became an unreadable 21 mm one.
    if (target !== clone) target.removeAttribute('class');
  });
  return clone;
}

// How big the code block is on paper, in dots — the print rule's own sizing,
// applied to the code's OWN proportions.
//
// Computed rather than letterboxed into a box: the two representations are
// nothing like each other (a 21 mm square for the QR against the barcode's
// `width: 36mm; height: auto; max-height: 14mm`), and dropping a 292 × 94
// barcode into a square box shrinks it to two thirds of the width — at which
// point its modules are about a dot wide and a scanner has nothing to read.
function blockSizeDots(
  code: SVGSVGElement,
  usable: number,
  mm: (value: number) => number,
  // The width the code may take when it shares the row with the type. Absent
  // for the stacked arrangement, where the code has the label to itself.
  room?: number,
): { width: number; height: number } {
  const box = viewBoxSize(code);
  if (!isBarcode(code)) {
    // The QR snaps to a whole number of dots per MODULE, for the reason the
    // barcode does below: a thermal dot is burnt or not, and a module edge
    // landing mid-dot is a module the threshold rounds at random. Its viewBox
    // is the module grid (the symbol plus its quiet zone), so the side is a
    // multiple of that count — a few tenths of a millimetre under the nominal
    // 21 mm, and crisp instead of nearly crisp.
    // Never below the floor: a code squeezed under it is unscannable, so a
    // label whose type is that wide gets an overflowing line rather than a
    // useless code — and the line is the part a person can still read.
    const target = Math.max(
      mm(LABEL_GEOMETRY.qrMinSideMm),
      Math.min(mm(LABEL_GEOMETRY.qrSideMm), room ?? Number.POSITIVE_INFINITY),
    );
    const side = box ? snapToGrid(target, box.width) : target;
    return { width: side, height: side };
  }
  // `height: auto` means the aspect ratio decides; `max-height` then clamps the
  // box, and the width follows it down rather than stretching the bars.
  const available = Math.min(
    mm(LABEL_GEOMETRY.barcodeWidthMm),
    usable - 2 * mm(LABEL_GEOMETRY.paddingMm),
  );
  const cap = mm(LABEL_GEOMETRY.barcodeHeightMm);
  if (!box) {
    return { width: available, height: Math.min(cap, available) };
  }
  const scale = barcodeScale(box, available, cap);
  return {
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
  };
}

// The largest whole number of dots per grid unit that still fits `target`,
// expressed back as a size. Never returns zero: a code smaller than its own
// grid is not printable, so the target stands and the threshold does its best.
function snapToGrid(target: number, gridUnits: number): number {
  const perUnit = Math.floor(target / gridUnits);
  return perUnit >= 1 ? perUnit * gridUnits : target;
}

function isBarcode(code: SVGSVGElement): boolean {
  return code.classList.contains('label-card__barcode');
}

// A thermal printhead has no grey: every dot is burnt or not. A barcode scaled
// by a fraction therefore lands its module edges mid-dot, the threshold rounds
// each one whichever way it happens to fall, and Code128 — which is read as
// RATIOS of module widths — stops decoding. (Measured: the 36 mm strip at a
// scale of 0.99 failed every ZXing attempt; at a scale of 1 it reads.)
//
// So the scale is snapped to a whole number of dots per module whenever one
// fits the label, even though that can differ from the CSS width by a fraction
// of a millimetre. A fractional scale is kept only when the code's natural size
// does not fit at all — a soft barcode on the label beats a crisp one off it.
function barcodeScale(
  box: { width: number; height: number },
  available: number,
  cap: number,
): number {
  const raw = Math.min(available / box.width, cap / box.height);
  for (const candidate of [Math.round(raw), Math.floor(raw)]) {
    if (
      candidate >= 1 &&
      candidate * box.width <= available &&
      candidate * box.height <= cap
    ) {
      return candidate;
    }
  }
  // One exception to "whole dots": rounding UP by a hair keeps the modules
  // aligned and costs a fraction of a millimetre of width, which the stock has.
  if (raw > 0.9 && box.width <= available * 1.05 && box.height <= cap) return 1;
  return raw;
}

// The code's own coordinate box, from its viewBox (both representations set
// one). Null when it has none — nothing can be scaled by proportion then.
function viewBoxSize(
  code: SVGSVGElement,
): { width: number; height: number } | null {
  const parts = (code.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .map(Number);
  const [, , width, height] = parts;
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

// The three transforms a browser applies to rendered text. `full-width` and
// the rest are left alone: they are not reachable from this repo's styles, and
// guessing at them would print something nobody asked for.
export function transformText(value: string, transform: string): string {
  if (transform === 'uppercase') return value.toUpperCase();
  if (transform === 'lowercase') return value.toLowerCase();
  if (transform === 'capitalize') {
    return value.replace(
      /(^|\s)(\S)/g,
      (_, lead: string, first: string) => lead + first.toUpperCase(),
    );
  }
  return value;
}

// Where a line of type goes on the page, and how it is set. The FACE is the
// card's own (read off the live node) while the SIZE is the print rule's — the
// screen's size is the screen's business, the typeface is the label's identity.
interface TypeLine {
  text: string;
  x: number;
  y: number;
  size: number;
  align: CanvasTextAlign;
  // Extra space between letters, in dots.
  tracking: number;
  selector: string;
}

interface ComposedPage {
  svg: string;
  lines: TypeLine[];
}

// The page: an SVG carrying the card's own code block, placed and sized like
// the print rule places it, plus the coordinates of the lines of type.
// How far apart a line's letters sit, as a fraction of its own size. `normal`
// and anything unreadable mean none.
function trackingRatio(card: HTMLElement, selector: string): number {
  const node = card.querySelector(selector);
  if (!node) return 0;
  const style = getComputedStyle(node);
  const spacing = Number.parseFloat(style.letterSpacing);
  const size = Number.parseFloat(style.fontSize);
  return Number.isFinite(spacing) && Number.isFinite(size) && size > 0
    ? spacing / size
    : 0;
}

function composePage(
  card: HTMLElement,
  code: SVGSVGElement,
  lines: { brand: string; shortCode: string },
  widthDots: number,
  heightDots: number,
  dotsPerMm: number,
  // How wide the widest line of type actually is, in dots, measured in the face
  // it will be drawn in. Passed in because only the canvas can answer it.
  typeWidth: number,
): ComposedPage {
  const mm = (value: number): number => Math.round(value * dotsPerMm);
  const padding = mm(LABEL_GEOMETRY.paddingMm);
  const gap = mm(LABEL_GEOMETRY.gapMm);
  const pt = (size: number): number =>
    Math.round((size / 72) * dotsPerMm * MM_PER_INCH);
  const codeHeight = pt(LABEL_GEOMETRY.codePt);
  const brandHeight = lines.brand === '' ? 0 : pt(LABEL_GEOMETRY.brandPt);
  // Everything is laid out inside the STOCK, never the printhead: the page is
  // as wide as the head can burn, and a label narrower than that would get its
  // right-hand dots — a barcode's quiet zone among them — printed past its own
  // edge.
  const usable = usableWidth(widthDots, dotsPerMm);
  // The arrangement follows the REPRESENTATION, which is the only thing it ever
  // depended on: a QR sits beside its type, a barcode is already a wide strip
  // and keeps the column. Nothing else gets a say, so nothing else can disagree
  // with the card on screen.
  const sideLayout = !isBarcode(code);
  // Beside its type, the code gets what the type leaves — measured, not
  // assumed. The nominal 21 mm was arithmetic done when the brand line was
  // 5 pt; at 7 pt the column grew and pushed the group 3 mm past the label's
  // edge, which no amount of commenting about left edges would have caught.
  const sideRoom =
    usable - 2 * padding - mm(LABEL_GEOMETRY.sideGapMm) - typeWidth;
  const { width: blockWidth, height: blockHeight } = blockSizeDots(
    code,
    usable,
    mm,
    sideLayout ? sideRoom : undefined,
  );

  const parts: string[] = [];
  const typeLines: TypeLine[] = [];
  const push = (
    text: string,
    selector: string,
    x: number,
    y: number,
    size: number,
    align: CanvasTextAlign,
    tracking: number,
  ): void => {
    if (text !== '') {
      typeLines.push({ text, selector, x, y, size, align, tracking });
    }
  };
  // Tracking is the card's, as a RATIO of its own size: the screen sets it in
  // pixels at the screen's size, and what carries over to a 203 dpi label is
  // the proportion, not the pixels.
  const brandTracking = brandHeight * trackingRatio(card, BRAND_SELECTOR);
  const codeTracking = codeHeight * trackingRatio(card, CODE_SELECTOR);

  if (sideLayout) {
    // Code on the left, both lines of type in a column to its right —
    // left-aligned against the code, the two of them centred on its middle.
    //
    // The group starts at the left padding instead of being centred on the
    // page: the page is as wide as the PRINTHEAD, while the stock under it may
    // be narrower, and the left edge is the one both of them share.
    const blockTop = Math.max(
      padding,
      Math.round((heightDots - blockHeight) / 2),
    );
    code.setAttribute('width', String(blockWidth));
    code.setAttribute('height', String(blockHeight));
    code.setAttribute('x', String(padding));
    code.setAttribute('y', String(blockTop));
    parts.push(new XMLSerializer().serializeToString(code));

    const columnLeft = padding + blockWidth + mm(LABEL_GEOMETRY.sideGapMm);
    const columnHeight =
      brandHeight === 0 ? codeHeight : brandHeight + gap + codeHeight;
    const columnTop = blockTop + Math.round((blockHeight - columnHeight) / 2);
    push(
      lines.brand,
      BRAND_SELECTOR,
      columnLeft,
      columnTop,
      brandHeight,
      'left',
      brandTracking,
    );
    push(
      lines.shortCode,
      CODE_SELECTOR,
      columnLeft,
      brandHeight === 0 ? columnTop : columnTop + brandHeight + gap,
      codeHeight,
      'left',
      codeTracking,
    );
  } else {
    // The column the label has always been, with the brand line on top of it.
    // Centred as a whole, exactly as the flexbox centres the card inside the
    // sheet: the gaps and both lines of type belong to what is centred.
    //
    // Centred on the STOCK, not on the page: on a 48 mm printhead the page's
    // middle is 24 mm, and a 36.5 mm barcode centred there ran its right quiet
    // zone 2 mm past a 40 mm label.
    const centre = usable / 2;
    const brandBand = brandHeight === 0 ? 0 : brandHeight + gap;
    const contentHeight = brandBand + blockHeight + gap + codeHeight;
    const top = Math.max(padding, Math.round((heightDots - contentHeight) / 2));
    const blockTop = top + brandBand;
    // A tracked run renders the space after its last letter too, so a centred
    // one is nudged left by half of it to sit optically centred.
    push(
      lines.brand,
      BRAND_SELECTOR,
      centre - brandTracking / 2,
      top,
      brandHeight,
      'center',
      brandTracking,
    );
    code.setAttribute('width', String(blockWidth));
    code.setAttribute('height', String(blockHeight));
    code.setAttribute('x', String(Math.round(centre - blockWidth / 2)));
    code.setAttribute('y', String(blockTop));
    parts.push(new XMLSerializer().serializeToString(code));
    push(
      lines.shortCode,
      CODE_SELECTOR,
      centre - codeTracking / 2,
      blockTop + blockHeight + gap,
      codeHeight,
      'center',
      codeTracking,
    );
  }

  return {
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${widthDots}" height="${heightDots}" viewBox="0 0 ${widthDots} ${heightDots}">`,
      '<rect width="100%" height="100%" fill="#ffffff"/>',
      ...parts,
      '</svg>',
    ].join(''),
    lines: typeLines,
  };
}

// Draws the lines of type onto the page, in the card's OWN typefaces.
//
// On the canvas rather than inside the SVG, and that is the whole point: an SVG
// in a `data:` URL is a document of its own with no access to the page's
// `@font-face` fonts, so `font-family="sans-serif"` there meant the system's
// default face — the label printed in a typeface the preview never showed. A
// canvas draws with the document's fonts, so the printed line is the previewed
// line, down to the face.
// The card's own face at the PRINTED size: family and weight are the screen's,
// the size is the print rule's. Shared by drawing and measuring so a line is
// never measured in one face and drawn in another.
function setType(
  ctx: CanvasRenderingContext2D,
  card: HTMLElement,
  selector: string,
  size: number,
  tracking: number,
): void {
  const source = card.querySelector(selector);
  const style = source ? getComputedStyle(source) : null;
  ctx.font =
    `${style?.fontWeight ?? '600'} ${size}px ` +
    `${style?.fontFamily ?? 'sans-serif'}`;
  // `letterSpacing` is a recent canvas property; where it is missing the
  // tracked line is simply set solid rather than silently mis-measured.
  // Widened by assignment rather than a cast (§5.1): a context either has the
  // property or it does not, and an optional field says exactly that.
  const spacing: { letterSpacing?: string } = ctx;
  if (typeof spacing.letterSpacing === 'string') {
    spacing.letterSpacing = `${tracking}px`;
  }
}

// How wide one line comes out, tracking included.
function measureLine(
  ctx: CanvasRenderingContext2D,
  card: HTMLElement,
  selector: string,
  text: string,
  size: number,
): number {
  if (text === '') return 0;
  setType(ctx, card, selector, size, size * trackingRatio(card, selector));
  const width = ctx.measureText(text).width;
  const spacing: { letterSpacing?: string } = ctx;
  if (typeof spacing.letterSpacing === 'string') spacing.letterSpacing = '0px';
  return width;
}

function drawType(
  ctx: CanvasRenderingContext2D,
  card: HTMLElement,
  lines: readonly TypeLine[],
): void {
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  for (const line of lines) {
    setType(ctx, card, line.selector, line.size, line.tracking);
    ctx.textAlign = line.align;
    ctx.fillText(line.text, line.x, line.y);
  }
  const spacing: { letterSpacing?: string } = ctx;
  if (typeof spacing.letterSpacing === 'string') spacing.letterSpacing = '0px';
}

// How long to let the card finish rendering its code. The QR encoder is a
// lazily imported chunk, so pressing print the instant a dialog opens can
// genuinely arrive first; a second is far longer than that chunk takes and far
// shorter than the person would wait before suspecting the button.
const RENDER_WAIT_MS = 1000;
const RENDER_POLL_MS = 50;

async function awaitCodeSvg(card: HTMLElement): Promise<SVGSVGElement | null> {
  const deadline = Date.now() + RENDER_WAIT_MS;
  for (;;) {
    const code = freezeCodeSvg(card);
    if (code) return code;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, RENDER_POLL_MS));
  }
}

// `decode()` where it exists — it rejects on a malformed document instead of
// leaving the caller waiting for an event that never fires — and the load/error
// pair where it does not.
//
// The fallback is not hypothetical: `HTMLImageElement.decode()` is the newest
// part of this path in exactly the browsers the handoff link (#361) exists for,
// since Safari and Firefox are where no driver can reach the printer.
function loadImage(image: HTMLImageElement): Promise<unknown> {
  if (typeof image.decode === 'function') return image.decode();
  return new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('codes.print.driver.rasterError'));
  });
}

// The whole page, as dots. Async because an SVG reaches a canvas through an
// image decode — and because the card may still be drawing its code.
export async function renderLabelRaster(
  input: LabelRasterInput,
): Promise<PrintRaster> {
  const code = await awaitCodeSvg(input.card);
  // Thrown, not drawn blank: a label with no code is not a label, and the
  // caller already surfaces this as a failed print.
  if (!code) throw new Error('codes.print.driver.rasterError');

  const canvas = document.createElement('canvas');
  canvas.width = input.widthDots;
  canvas.height = input.heightDots;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('codes.print.driver.rasterError');

  // Each line by its own class, not by position: the card has two of them now,
  // and "the first span" was only ever right by accident.
  //
  // `text-transform` is applied here rather than ignored, because it decides
  // what the WORDS are, not how big they are: a card wearing `uppercase` shows
  // MAKEKEEPER on screen, and a raster that serialised the untransformed text
  // would print MakeKeeper beside it. (Sizes are the opposite case and stay in
  // this module's constants — the screen's font-size is the screen's, while the
  // printed one belongs to the print rule.)
  const text = (selector: string): string => {
    const node = input.card.querySelector(selector);
    if (!node) return '';
    return transformText(
      node.textContent?.trim() ?? '',
      getComputedStyle(node).textTransform,
    );
  };
  // Before ANY measurement: the brand face is a self-hosted variable font, and
  // a line measured in the fallback plans the layout around the wrong width
  // just as surely as drawing in it prints the wrong face.
  await document.fonts?.ready;

  const lines = {
    brand: text(BRAND_SELECTOR),
    shortCode: text(CODE_SELECTOR),
  };
  const dotsPerMm = input.heightDots / LABEL_HEIGHT_MM;
  const printed = (size: number): number =>
    Math.round((size / 72) * dotsPerMm * MM_PER_INCH);
  // The type is measured BEFORE the page is laid out, because beside a QR it is
  // the type that decides how much room the code has left. Only the canvas can
  // answer how wide a tracked line comes out in the face it will be drawn in,
  // and it is the same canvas that will draw it — so the width the layout plans
  // around is the width that lands.
  const typeWidth = Math.max(
    measureLine(
      ctx,
      input.card,
      BRAND_SELECTOR,
      lines.brand,
      printed(LABEL_GEOMETRY.brandPt),
    ),
    measureLine(
      ctx,
      input.card,
      CODE_SELECTOR,
      lines.shortCode,
      printed(LABEL_GEOMETRY.codePt),
    ),
  );
  const page = composePage(
    input.card,
    code,
    lines,
    input.widthDots,
    input.heightDots,
    dotsPerMm,
    Math.ceil(typeWidth),
  );

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;
  await loadImage(image);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawType(ctx, input.card, page.lines);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    widthDots: input.widthDots,
    heightDots: input.heightDots,
    rows: packPixels(pixels),
  };
}
