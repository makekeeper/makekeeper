// Which kinds of value make a useful tag (#205). Shared by this plugin's
// backend (which enforces it) and its frontend (which does not offer a control
// that would only ever refuse) — the same reasoning as inventory's own
// `categories.ts`: this is the tags plugin talking to itself.
//
// The host that owns the field never makes this judgement. It reports what kind
// of value the field holds, in its own vocabulary, and a kind this plugin does
// not recognise is simply not offered. A number is the case that matters: "10",
// "4.7" and "100" would land in the vocabulary every plugin shares.
const TAGGABLE_VALUE_KINDS = new Set(['text', 'select']);

export function isTaggableValueKind(valueKind: string): boolean {
  return TAGGABLE_VALUE_KINDS.has(valueKind);
}
