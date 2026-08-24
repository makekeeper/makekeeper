import sharp from 'sharp';
import type { PreviewVariant } from '@makekeeper/plugin-contract';

// The one place the preview profile is defined (#113). Generation, serving,
// deletion, exchange and the frontend helper all read the variant set from
// here (via the `PreviewVariant` contract), so adding a rendition is one entry
// plus a migration rather than a hunt through five call sites.

export interface PreviewVariantProfile {
  // Longest edge of the rendition, in pixels. Also the generation threshold:
  // a source no larger than this is already its own preview.
  readonly maxEdge: number;
  // Generate on upload (what the browser paints) or on first use (what the
  // model reads). See the doc comment on `PREVIEW_VARIANTS`.
  readonly eager: boolean;
  // Also generate when the source merely *weighs* more than this, regardless
  // of its dimensions — a small-but-heavy PNG still costs the browser real
  // bytes. Null for renditions whose consumer pays in tokens, not bandwidth:
  // re-encoding a 2048 px photo that is only heavy would lose detail for the
  // model and buy nothing.
  readonly reencodeAboveBytes: number | null;
  readonly extension: string;
  readonly mimeType: string;
}

export const PREVIEW_PROFILE: Readonly<
  Record<PreviewVariant, PreviewVariantProfile>
> = {
  xs: {
    maxEdge: 192,
    eager: true,
    reencodeAboveBytes: 512 * 1024,
    extension: 'webp',
    mimeType: 'image/webp',
  },
  sm: {
    maxEdge: 640,
    eager: true,
    reencodeAboveBytes: 512 * 1024,
    extension: 'webp',
    mimeType: 'image/webp',
  },
  lg: {
    maxEdge: 2048,
    eager: false,
    reencodeAboveBytes: null,
    extension: 'webp',
    mimeType: 'image/webp',
  },
};

// Exported so the profile pin below covers it. It is part of what the bytes
// look like just as much as `maxEdge` is, but it lives outside `PREVIEW_PROFILE`
// (every variant encodes the same way) — and a value the pin cannot see is a
// value that can change without anyone bumping the revision.
export const WEBP_QUALITY = 80;

// Which revision of the profile above produced a stored rendition (#115).
//
// A stored path is authoritative: the lazy render only fills in what is
// MISSING, so a rendition made by an older profile would otherwise live
// forever — change `maxEdge`, the quality or the format and every existing
// photo keeps its old preview while new uploads get the new one.
//
// **Bump this whenever anything above changes what the bytes look like**:
// `maxEdge`, `extension`/`mimeType`, the WebP quality, or the re-encode
// threshold. Rows behind the current revision have their renditions dropped on
// next use and rebuilt by the same on-demand path that fills in a missing one —
// no queue, no bulk re-encode, and the cost is paid only for pictures somebody
// actually looks at.
export const PREVIEW_PROFILE_REVISION = 1;

// Renditions the model may consume, best first. Deliberately does NOT end at
// the original: the browser can afford to fall back to full-size bytes, a
// vision request cannot — one un-generated attachment would otherwise push a
// multi-megabyte frame into a provider request.
export const VISION_VARIANT_ORDER: readonly PreviewVariant[] = ['lg', 'sm'];

// Vector images are their own preview: the browser renders them natively, and
// rasterising a vector into a tile buys nothing. Exempt from the decode probe
// as well — they stay images without ever touching the decoder.
export const VECTOR_MIME_TYPES: readonly string[] = ['image/svg+xml'];

export function isVectorImage(mimeType: string): boolean {
  return VECTOR_MIME_TYPES.includes(mimeType);
}

// Either the bytes in hand or a path on disk. The path form lets the exchange
// import derive previews from the file it just copied without pulling a
// multi-megabyte original through the JS heap.
export type ImageSource = Buffer | string;

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

// Read an image header. Returns null when the bytes are not a decodable image
// — the caller treats that as "this upload is a plain file, not a picture",
// which is what makes an HEIC or a corrupt upload degrade instead of breaking.
export async function probeImage(
  source: ImageSource,
): Promise<ImageDimensions | null> {
  try {
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

// Orientation-invariant: EXIF may swap the rendered axes, but the longest edge
// is the longest edge either way.
export function longestEdge(dimensions: ImageDimensions): number {
  return Math.max(dimensions.width, dimensions.height);
}

export function shouldGenerate(
  variant: PreviewVariant,
  dimensions: ImageDimensions,
  sizeBytes: number,
): boolean {
  const profile = PREVIEW_PROFILE[variant];
  if (longestEdge(dimensions) > profile.maxEdge) return true;
  return (
    profile.reencodeAboveBytes !== null &&
    sizeBytes > profile.reencodeAboveBytes
  );
}

export function eagerVariants(): PreviewVariant[] {
  return (Object.keys(PREVIEW_PROFILE) as PreviewVariant[]).filter(
    (variant) => PREVIEW_PROFILE[variant].eager,
  );
}

// `.rotate()` with no argument applies the EXIF orientation — without it a
// portrait phone photo renders on its side in the tile while the original
// opens upright. Metadata is not copied, so GPS coordinates never reach a
// preview served over a capability URL.
export async function renderPreview(
  source: ImageSource,
  variant: PreviewVariant,
): Promise<Buffer> {
  const { maxEdge } = PREVIEW_PROFILE[variant];
  return sharp(source)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}
