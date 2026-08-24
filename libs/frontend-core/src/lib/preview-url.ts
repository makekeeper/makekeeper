import {
  PREVIEW_VARIANT_PARAM,
  PREWARM_MAX_ATTACHMENTS,
  type PrewarmRequest,
  type PreviewVariant,
} from '@makekeeper/plugin-contract';
import { apiFetch } from './api';

// Address of a preview rendition of a stored attachment (#113).
//
// An attachment has one identity — `/api/uploads/<id>` — and a variant selects
// which rendition of it the browser gets. Everything that merely *shows* a
// picture goes through here; the bare URL stays reserved for the cases that
// need the original bytes: download, drag-out to the desktop, exchange export.
//
// Choose by the size the element actually paints, not by how important it is:
//
//   xs — list rows, composer chips, the chat file picker
//   sm — grid tiles, project covers
//   lg — full-size viewing (no browser consumer yet; the model reads it)
//
// A missing rendition degrades to the original server-side, so passing a
// variant is always safe: the picture renders either way.
//
// Anything that is not a stored attachment is returned untouched — the same
// surfaces also render `data:` URLs for pictures picked locally but not yet
// uploaded, and a query string appended to those would break them.
const ATTACHMENT_URL = /\/api\/uploads\/[^/?#]+$/;

export function previewUrl(url: string, variant: PreviewVariant): string {
  if (!ATTACHMENT_URL.test(url)) return url;
  return `${url}?${PREVIEW_VARIANT_PARAM}=${variant}`;
}

// Ask the server to have renditions ready before anything asks for them (#128).
//
// The rendition is produced ON THE SERVER and stays there — this is not a fetch
// of the pictures. Warming `lg` by requesting every `?variant=lg` URL from the
// browser would download megabytes the user may never look at; the point is to
// spend the CPU early and the bandwidth only when a photo is actually opened.
//
// Fire-and-forget by contract: nothing on screen depends on the answer, a
// failure only means the first click pays the resize it always did, and the
// call is never awaited by a view. Errors are swallowed for the same reason —
// there is nothing to tell the user about work they did not ask for.
//
// Returns the ids it actually sent, which is how the cap stays this module's
// business: a caller tracking what it has already warmed marks what came back
// instead of re-deriving the slice, and never imports the bound at all.
export function prewarmPreviews(
  attachmentIds: readonly string[],
  variant: PreviewVariant,
): readonly string[] {
  // Sliced client-side against the shared cap: the server would reject the
  // whole request otherwise, and a gallery of two hundred photos would get no
  // warming at all rather than the screenful a user can actually reach.
  const ids = attachmentIds.slice(0, PREWARM_MAX_ATTACHMENTS);
  if (ids.length === 0) return ids;
  const body: PrewarmRequest = { ids, variant };
  void apiFetch('/api/uploads/prewarm', { method: 'POST', body }).catch(
    () => undefined,
  );
  return ids;
}
