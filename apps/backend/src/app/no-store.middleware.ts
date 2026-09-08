// Says out loud, on every API response, that it must not be reused from a
// cache (#350).
//
// Express stamps an ETag on JSON responses and nothing else. With no
// Cache-Control and no Last-Modified the decision falls to the browser's
// heuristics, which differ per browser and per navigation type: Safari answers
// a GET from its own copy without asking the server at all. A *revalidated*
// response is fine — the ETag then does its job — but one served straight from
// the cache makes changed state invisible, and looks exactly like a bug in the
// feature that read it (it cost real debugging time in #343).
//
// The SPA states the same rule on its side (`cache: 'no-store'` in
// frontend-core's api.ts); this half covers every OTHER client — the phone
// bridge, external plugins, anything hitting the public API — which never went
// through that file.
//
// Set as a DEFAULT, before the handler runs: a route that genuinely serves
// immutable bytes overwrites it (uploads.controller.ts serves attachments and
// their previews with a year-long immutable cache, #113, and still does).
import type { IncomingMessage, ServerResponse } from 'node:http';

export const NO_STORE = 'no-store';

// Interactive API docs are a static developer surface, not live state — no
// reason to make its bundle uncacheable.
function isDocs(path: string): boolean {
  return path === '/api/docs' || path.startsWith('/api/docs/');
}

export function createNoStoreMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void {
  return (req, res, next) => {
    // Compare the path alone: a request URI carries the query string, and
    // `/api/docs?foo` is still the docs surface.
    const path = (req.url ?? '').split('?')[0];
    if (!isDocs(path)) res.setHeader('Cache-Control', NO_STORE);
    next();
  };
}
