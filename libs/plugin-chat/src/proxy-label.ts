// Proxy request labelling (epic #230) — the rules a connection's label obeys
// before it is allowed near a request header.

import { PRODUCT_NAME, type Transliterator } from '@makekeeper/plugin-contract';
//
// Kept apart from ProviderService and LlmClient because both sides need the same
// answers: the settings surface validates a header name here, and the request
// builder composes the value here, so neither can drift from the other.

// The segments a label may carry, in their default order. `label` is the
// operator's own text; `user` is the CALLER (never the connection's owner, #225);
// `project` comes from the chat session.
export const PROXY_LABEL_SEGMENTS = ['label', 'user', 'project'] as const;
export type ProxyLabelSegment = (typeof PROXY_LABEL_SEGMENTS)[number];

// What a NULL `proxyLabelSegments` column means. Not the full set: `user` and
// `project` send the operator's own domain data to a third party and were opt-in
// from the moment this was designed — a default including them would make that
// opt-in a fiction.
export const DEFAULT_PROXY_LABEL_SEGMENTS: readonly ProxyLabelSegment[] = [
  'label',
];

// Headers LlmClient sets itself. A user-typed name colliding with one of these
// would silently overwrite an API key or an API version, so the settings surface
// refuses them outright. This list is the FIRST of two defences and the one that
// rots: it is maintained by hand and will fall behind the code when the next
// provider arrives. The second defence — applying the client's own headers last,
// unconditionally — is the one that cannot rot (#224).
export const RESERVED_PROXY_HEADER_NAMES: readonly string[] = [
  'authorization',
  'x-api-key',
  'anthropic-version',
  'content-type',
  'openai-organization',
  // The client writes the label into User-Agent itself; a same-named custom
  // header would case-merge with it into one comma-joined value.
  'user-agent',
];

// RFC 7230 token grammar. A name outside it throws inside `fetch` at request
// build time, i.e. a day later and far from the form that accepted it.
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type HeaderNameVerdict = 'ok' | 'malformed' | 'reserved';

export function checkProxyHeaderName(name: string): HeaderNameVerdict {
  if (!HEADER_TOKEN.test(name)) return 'malformed';
  if (RESERVED_PROXY_HEADER_NAMES.includes(name.toLowerCase()))
    return 'reserved';
  return 'ok';
}

function isProxyLabelSegment(value: string): value is ProxyLabelSegment {
  return (PROXY_LABEL_SEGMENTS as readonly string[]).includes(value);
}

// Read the stored column. Order is significant and belongs to the operator, so
// it is preserved verbatim; unknown and duplicated entries are dropped rather
// than repaired, because a stored value we cannot interpret must not silently
// become a different label than the one that was configured.
export function parseProxyLabelSegments(
  stored: string | null | undefined,
): readonly ProxyLabelSegment[] {
  if (stored === null || stored === undefined)
    return DEFAULT_PROXY_LABEL_SEGMENTS;
  const seen = new Set<ProxyLabelSegment>();
  for (const raw of stored.split(',')) {
    const value = raw.trim().toLowerCase();
    if (isProxyLabelSegment(value)) seen.add(value);
  }
  return [...seen];
}

// Canonical form for storage: the empty selection is a real state (every segment
// switched off), and it must round-trip as an empty string rather than collapse
// back to the default via NULL.
export function formatProxyLabelSegments(
  segments: readonly ProxyLabelSegment[],
): string {
  return segments.join(',');
}

// "Is there a proxy?" — answered by the only signal available: an endpoint that
// is not the vendor's own. Nothing is probed and nothing is declared (#228); it
// fails safe, the worst case being a label arriving somewhere that ignores it.
//
// Lives here, not in the client or the form, because BOTH ask it: the request
// builder before sending and the settings block before offering the fields. Two
// copies of this rule would drift, and the drift would be silent — a field the
// user can fill that never sends anything.
export function isProxyEndpoint(
  configured: string | null | undefined,
  vendor: string | undefined,
): boolean {
  const endpoint = configured?.trim();
  if (!endpoint) return false;
  // No vendor endpoint at all (the `custom` type) ⇒ any address is the
  // operator's own.
  if (!vendor) return true;
  const strip = (url: string): string => url.replace(/\/+$/, '');
  return strip(endpoint) !== strip(vendor);
}

// ── Composition ─────────────────────────────────────────────────────────────

// Separator, and NOT `/`. LiteLLM surfaces a tag through its `/tag/info`
// endpoint; if the tag travels as a path segment there, an embedded slash tears
// the lookup apart — the label would read perfectly in the log and break in the
// spend report, which is the half that pays. No charset is documented either
// way, so the separator that cannot break was chosen over the prettier one.
export const PROXY_LABEL_SEPARATOR = '.';

// What a segment becomes when it resolves to nothing. A skipped segment would
// merge spend-outside-any-project into the parent bucket; a placeholder keeps it
// a row of its own in the proxy's report.
export const PROXY_LABEL_PLACEHOLDER = 'none';

// Per segment, not over the whole string: the project sits last, is the most
// numerous, and is the entire reason the detail exists — whole-string truncation
// would destroy exactly it.
export const PROXY_LABEL_SEGMENT_MAX = 32;

// Make one segment safe for a header value.
//
// Transliteration is FORCED, not stylistic: a header value is a ByteString, so a
// non-Latin project name throws inside fetch at request-build time
// (`new Headers({'x-t':'Кухня'})` → TypeError) and would take the whole chat turn
// down with it. Percent-encoding would survive that and defeat the point — the
// label exists to be recognised by a human reading a log.
// The transliterator is a parameter: tables are server data, read from disk at
// startup (TransliterationService), and this module also compiles into the
// browser bundle — which cannot read a folder and therefore never normalises
// locally (the form asks the server; see composeNormalizedProxyLabel).
export function normalizeProxyLabelSegment(
  raw: string,
  transliterate: Transliterator,
): string {
  return (
    transliterate(raw.toLowerCase())
      // `.` is stripped from segment CONTENT deliberately: it is the separator, and
      // project names carry it often ("Ремонт кухни v2.0"), which would otherwise
      // make the segment boundaries unreadable.
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, PROXY_LABEL_SEGMENT_MAX)
      .replace(/-+$/, '')
  );
}

// The raw material for one request: whatever the caller could resolve. A source
// that is absent (no project on the session, no caller on a background job) is
// null and becomes the placeholder.
export interface ProxyLabelSources {
  label: string | null;
  user: string | null;
  project: string | null;
}

export interface ComposedProxyLabel {
  value: string;
  // False when every segment came out a placeholder: there is nothing to
  // recognise, so the caller sends no header at all rather than a row of `none`.
  hasContent: boolean;
}

// The header every LiteLLM deployment reads without being told to. Sent
// unconditionally alongside any operator-named header: an unknown header is a
// safe no-op, so covering both known targets costs nothing and spares the user
// from classifying their own infrastructure in a menu that would date itself.
export const LITELLM_TAGS_HEADER = 'x-litellm-tags';

// The label as a User-Agent value. Aperture's request table shows User-Agent
// as a first-class column with NO admin configuration — unlike the filterable
// custom header, which only surfaces after the tailnet admin names it. Putting
// the label there makes it recognisable by eye out of the box; the default
// would otherwise read as undici's bare "node". Product token + comment per
// RFC 9110 grammar; the normalised label ([a-z0-9-.]) is comment-safe.
// PRODUCT_NAME is the canonical brand constant (plugin-contract) — a wire
// header, never a locale value, where a translation would be a ByteString
// crash waiting to happen.
export function proxyUserAgent(label: string): string {
  return `${PRODUCT_NAME} (${label})`;
}

export function composeProxyLabel(
  segments: readonly ProxyLabelSegment[],
  sources: ProxyLabelSources,
  transliterate: Transliterator,
): ComposedProxyLabel {
  return composeNormalizedProxyLabel(
    segments,
    Object.fromEntries(
      segments.map((segment) => [
        segment,
        normalizeProxyLabelSegment(sources[segment] ?? '', transliterate),
      ]),
    ),
  );
}

// The browser half: composition over values the SERVER already normalised.
// Placeholder substitution and joining carry no table knowledge, so the form
// can assemble its preview locally from fetched parts without ever holding a
// transliteration table.
export function composeNormalizedProxyLabel(
  segments: readonly ProxyLabelSegment[],
  normalized: Partial<Record<ProxyLabelSegment, string>>,
): ComposedProxyLabel {
  const parts = segments.map(
    (segment) => normalized[segment] || PROXY_LABEL_PLACEHOLDER,
  );
  return {
    value: parts.join(PROXY_LABEL_SEPARATOR),
    hasContent: parts.some((part) => part !== PROXY_LABEL_PLACEHOLDER),
  };
}
