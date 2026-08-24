// Preview variants of a stored image (#113). An attachment is served from one
// URL — `/api/uploads/<id>` — and a variant selects which rendition of it comes
// back. The names are the contract shared by the serving route, the frontend
// helper and the storage layer; the pixel/encoding profile behind each name is
// a backend concern and lives with the generator.
//
// The split is by consumer class, not by size: `xs` and `sm` are what a browser
// paints (generated eagerly on upload, because falling back to the original is
// the very regression previews exist to fix), `lg` is what the model reads
// (generated lazily on first use, because a vision request is server-side and
// can absorb one resize).

export const PREVIEW_VARIANTS = ['xs', 'sm', 'lg'] as const;

export type PreviewVariant = (typeof PREVIEW_VARIANTS)[number];

// Query parameter that selects a variant on the uploads route. Named here so
// neither the controller nor the frontend helper spells it by hand.
export const PREVIEW_VARIANT_PARAM = 'variant';

// How many attachments one prewarm request may ask for (#128). The prewarm
// route renders on the server, so this is a CPU bound, not a payload one: a
// project with hundreds of photos must not turn one tab open into hundreds of
// resizes.
//
// Sized to roughly one screen of tiles rather than to a whole gallery. #128
// left the breadth open ("whole tab vs. first N tiles") and a screenful is the
// answer the click data implies: the tile a user opens first is one they can
// already see. A larger batch would only move renditions nobody asked for to
// the front of the queue, ahead of the next visitor's visible ones.
//
// The cap is shared so the client slices before asking rather than having the
// whole request rejected — a gallery of two hundred photos warms its first
// screen instead of nothing.
export const PREWARM_MAX_ATTACHMENTS = 10;

// Body of a prewarm request. Declared here because both ends touch it: the
// frontend helper builds it and `PrewarmUploadsDto` validates it, and nothing
// but a shared type makes a renamed field a compile error rather than a silent
// no-op at runtime.
export interface PrewarmRequest {
  ids: readonly string[];
  variant: PreviewVariant;
}

// Answer to a prewarm request. Deliberately not a report of what was rendered:
// the work is queued and outlives the response (see `schedulePrewarm`), so the
// only honest thing to say synchronously is how many ids were taken on.
export interface PrewarmAccepted {
  accepted: number;
}

export function isPreviewVariant(value: unknown): value is PreviewVariant {
  return (
    typeof value === 'string' &&
    (PREVIEW_VARIANTS as readonly string[]).includes(value)
  );
}
