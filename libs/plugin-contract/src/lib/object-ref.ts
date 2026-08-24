// Canonical Object Reference (ORef) — one URI-shaped string that names any object
// in the system by its owning plugin, type and id, with an optional entity-owned
// sub-locator fragment. Shared by every layer that passes an object identity around
// (page context → AI chat, tool I/O, links), so the same object is referenced ONE
// way instead of the four ad-hoc encodings issue #16 catalogued.
//
//   mk://<pluginId>/<entityType>/<entityId>[#<fragment>]
//
// - `pluginId` / `entityType` are lowercase kebab identifiers (grammar validated
//   here; the closed per-plugin type registry from issue #16 is intentionally NOT
//   enforced at this layer — this module only guarantees the shape).
// - `entityId` is the Prisma `@id` verbatim, percent-encoded when it contains a
//   delimiter; never a name, never composite.
// - `fragment` is an opaque, entity-type-owned sub-locator (storages uses a
//   grid-cell address per `grid-address.ts`); this module treats it as an opaque
//   string and does not interpret its grammar.
//
// Like `grid-address.ts`, the pair is a strict canonical bijection:
// `formatObjectRef` emits exactly one spelling per ref and returns null for a
// malformed ref; `parseObjectRef` accepts ONLY that canonical spelling (any
// non-minimal percent-encoding is rejected), so parseObjectRef(formatObjectRef(x))
// round-trips exactly and no two accepted strings name different objects.

export interface ObjectRef {
  pluginId: string;
  entityType: string;
  entityId: string;
  // Entity-type-owned sub-locator (e.g. a storage grid cell "B1"). Absent, never
  // an empty string.
  fragment?: string;
}

// Lowercase kebab-case: starts with a letter, then letters/digits/hyphens. Matches
// the shape of registered PluginManifest ids and entity-type slugs.
const KEBAB = /^[a-z][a-z0-9-]*$/;

const SCHEME = 'mk://';

// True when `input` opens with the canonical ORef scheme. The single home for "does
// this string look like an ORef?" so callers never hardcode a scheme literal to gate
// ref handling (§5.9).
export function hasObjectRefScheme(input: string): boolean {
  return typeof input === 'string' && input.startsWith(SCHEME);
}

export function formatObjectRef(ref: ObjectRef): string | null {
  const { pluginId, entityType, entityId, fragment } = ref;
  if (typeof pluginId !== 'string' || !KEBAB.test(pluginId)) return null;
  if (typeof entityType !== 'string' || !KEBAB.test(entityType)) return null;
  if (typeof entityId !== 'string' || entityId.length === 0) return null;
  if (
    fragment !== undefined &&
    (typeof fragment !== 'string' || fragment.length === 0)
  ) {
    return null;
  }
  const base = `${SCHEME}${pluginId}/${entityType}/${encodeURIComponent(entityId)}`;
  return fragment === undefined
    ? base
    : `${base}#${encodeURIComponent(fragment)}`;
}

// entityId is everything up to a '/' or '#'; the fragment (if any) is everything
// after the first '#'. Percent-decoding happens after this split.
const OREF =
  /^mk:\/\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/([^/#]+)(?:#(.+))?$/;

export function parseObjectRef(input: string): ObjectRef | null {
  if (typeof input !== 'string') return null;
  const match = OREF.exec(input);
  if (!match) return null;
  let entityId: string;
  let fragment: string | undefined;
  try {
    entityId = decodeURIComponent(match[3]);
    fragment =
      match[4] === undefined ? undefined : decodeURIComponent(match[4]);
  } catch {
    // Malformed percent-encoding (e.g. a lone "%") — not a valid ORef.
    return null;
  }
  const ref: ObjectRef =
    fragment === undefined
      ? { pluginId: match[1], entityType: match[2], entityId }
      : { pluginId: match[1], entityType: match[2], entityId, fragment };
  // Canonical-only: reject any non-minimal spelling (redundant encoding like "%41"
  // for "A", empty parts) by requiring the exact round-trip. Mirrors grid-address.
  return formatObjectRef(ref) === input ? ref : null;
}

// Accept either a raw entity id or a canonical ORef where a tool/handler expects an
// object of a known plugin + type. A bare (non-ref-scheme) string is passed through
// as a raw id, so existing raw-id callers keep working; an `mk://` string MUST be a
// valid ORef of exactly the expected pluginId/entityType
// — otherwise this returns null and the caller raises an ownership error, so passing
// a component ref to a storage tool becomes a typed rejection instead of a silent
// wrong lookup (#16).
export function resolveEntityId(
  input: string,
  expected: { pluginId: string; entityType: string },
): { id: string; fragment?: string } | null {
  if (typeof input !== 'string' || input === '') return null;
  if (!hasObjectRefScheme(input)) return { id: input };
  const ref = parseObjectRef(input);
  if (
    !ref ||
    ref.pluginId !== expected.pluginId ||
    ref.entityType !== expected.entityType
  ) {
    return null;
  }
  return ref.fragment === undefined
    ? { id: ref.entityId }
    : { id: ref.entityId, fragment: ref.fragment };
}

// Scan free text (or a JSON.stringify'd blob) for embedded canonical ORefs and
// return the valid, de-duplicated ones in first-seen order. Used to reconstruct
// which objects an agent tool touched from its persisted args/result, where the
// refs sit inside a larger string. A candidate runs from `mk://` up to the first
// delimiter that cannot appear inside a canonical ref (whitespace, quotes, JSON
// and markdown punctuation). Trailing sentence punctuation is stripped up front —
// `.`/`,`/`)` are legal id characters, so `parseObjectRef` would otherwise fold
// them into the entityId; this system's ids (uuid/cuid/nanoid) never end in one,
// so trimming is safe and yields the intended ref. Stays the single home of ORef
// grammar (§5.9) rather than a second hand-rolled parser.
const OREF_CANDIDATE =
  /mk:\/\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/[^\s"'<>{}[\],]+/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

export function extractObjectRefs(text: string): ObjectRef[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = new Set<string>();
  const out: ObjectRef[] = [];
  for (const raw of text.match(OREF_CANDIDATE) ?? []) {
    const candidate = raw.replace(TRAILING_PUNCT, '');
    const ref = parseObjectRef(candidate);
    if (ref && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(ref);
    }
  }
  return out;
}

export function isObjectRef(value: unknown): value is ObjectRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if ('fragment' in candidate && typeof candidate['fragment'] !== 'string') {
    return false;
  }
  return (
    typeof candidate['pluginId'] === 'string' &&
    typeof candidate['entityType'] === 'string' &&
    typeof candidate['entityId'] === 'string' &&
    formatObjectRef(candidate as unknown as ObjectRef) !== null
  );
}
