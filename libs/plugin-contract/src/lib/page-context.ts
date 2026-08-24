// The page/screen a user is on when they send a chat message. Collected from
// vue-router on the client and forwarded, per message, to the agent so it can
// resolve deictic references ("this item", "here", "show its tasks") against the
// current screen instead of asking the user to restate their location.
//
// Identifiers and route metadata ONLY — never personal or sensitive data. The
// context clarifies intent; it must not be used to bypass a DESTRUCTIVE tool's
// human-in-the-loop confirmation (see CLAUDE.md §5.7). Both the frontend store
// and the NestJS chat backend touch this shape, so it lives in the contract lib.
export interface PageContext {
  // vue-router route name (e.g. "project-detail") — stable and i18n-independent.
  routeName?: string;
  // Route path the user is on (e.g. "/projects/abc123").
  path?: string;
  // Id of the plugin the active route belongs to (e.g. "projects", "inventory"),
  // read from the route's `meta.pluginId` stamped at plugin registration.
  pluginId?: string;
  // Route params — the identifiers that pin the screen to a record
  // (e.g. { id: "abc123" }, { projectId, taskId }). Flat string map.
  params?: Record<string, string>;
  // Route query — the drill-down/sub-tab/pagination/filter state (§5.3). Flat
  // string map; multi-value or empty query entries are dropped by the collector.
  query?: Record<string, string>;
  // Human-readable description of the active view's *precise* selection that the
  // opaque route ids alone don't convey — e.g. the storage name/path plus the open
  // grid cell ("склад «Office / Working Table», ячейка B1, storageId: …"). Set by
  // the active view (not the route) and rendered verbatim into the agent prompt so
  // it can act on the exact selection instead of re-resolving raw ids. Still
  // context-only: never authority to skip a DESTRUCTIVE confirmation (§5.7).
  summary?: string;
  // Machine-parseable counterpart to `summary`: the active view's precise selection
  // as canonical Object References (ORef, see object-ref.ts) — e.g.
  // "mk://storages/storage/<id>#B1". The agent gets an exact, ownership-tagged
  // handle to the selected object(s) instead of re-extracting ids from the prose
  // summary (issue #16). Same trust level as `summary`: context, not authority.
  refs?: string[];
}

// The resolved counterpart of the PageContext above: what the assistant is
// working on right now (#129), as the server answers it. The chat backend
// computes it and the app shell states it under the composer, so both sides
// touch the shape — a copy per side would be free to drift, and the browser's
// copy would drift silently (§7).
export interface ResolvedChatContext {
  // The project scope in force for the next turn (#130): the project the open
  // page names, else the sticky default the client carries. It is what the
  // prompt is scoped to and what gets stamped on the turn — not a place the
  // conversation lives. Null when there is none, or when the caller's scope
  // cannot read it — the surface then says nothing rather than naming a project
  // it can't show.
  project: { id: string; name: string } | null;
  // The object the open screen published as an ORef, named by the plugin that
  // owns it. This is the half that follows navigation across the whole app,
  // not only across project pages.
  page: { name: string; breadcrumb: string | null } | null;
  // Where a file attached right now would be filed, named the same way the turn
  // will file it (#130): the page's own object when its plugin claims one, else
  // the project, else nowhere but the conversation. Stated by the composer while
  // a file is attached, because that is the moment the answer matters — and it
  // is resolved here, not inferred in the browser, so the line and the bytes
  // cannot disagree.
  filing: { name: string } | null;
}

// `x is ResolvedChatContext` for the wire: the shell parses this straight out
// of a fetch, where the value is `unknown` and a cast would assert rather than
// check (§5.1). Both halves are independently nullable, which is exactly the
// shape a stale server or a proxy error page fails to honour.
export function isResolvedChatContext(
  value: unknown,
): value is ResolvedChatContext {
  if (typeof value !== 'object' || value === null) return false;
  if (!('project' in value) || !('page' in value) || !('filing' in value))
    return false;
  return (
    isNamedProject(value.project) &&
    isNamedPageObject(value.page) &&
    isNamedTarget(value.filing)
  );
}

function isNamedTarget(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  return 'name' in value && typeof value.name === 'string';
}

function isNamedProject(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isNamedPageObject(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  if (!('name' in value) || typeof value.name !== 'string') return false;
  return (
    'breadcrumb' in value &&
    (value.breadcrumb === null || typeof value.breadcrumb === 'string')
  );
}

// Server-side page-context resolver, registered per plugin. Given the raw route
// context (ids from params/query), it resolves a precise, human-readable
// description of what the user is looking at — from the DATABASE, not from the
// client — e.g. storage name/path + open cell address. This is the authoritative
// context channel: it cannot go stale with the browser bundle and never asks the
// LLM to derive anything from raw ids. Return null when the context isn't
// resolvable (missing/foreign ids) so the caller can fall back gracefully.
export type PageContextResolver = (
  context: PageContext,
) => Promise<string | null>;
