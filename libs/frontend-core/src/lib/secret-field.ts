// What an admin means to do with a secret the server holds but never returns.
//
// A write-only field cannot show its value, so "the box is empty" is ambiguous
// on its own: it reads the same whether nothing was ever stored, or a stored
// value is being kept, or one is being dropped. Three plugins each answered that
// ambiguity differently (#270) — this is the one answer.
//
// `keep` is not derivable from an empty input, which is why this exists as state
// rather than as a check at save time: #220 found that "blank means keep" leaves
// a stored value impossible to drop without deleting its whole connection.
export type SecretAction = 'keep' | 'replace' | 'remove';

// What to put on the wire for a secret field, given the admin's intent and
// whatever they typed.
//
// `undefined` means omit the field (the server keeps what it has), `null` means
// clear it, a string is the new value. Callers whose API spells "clear" as an
// empty string map `null` themselves at the call site — the convention differs
// per endpoint and guessing it here would be worse than one explicit line there.
//
// What an empty box under `replace` means is the CALLER's fact, declared here
// rather than inferred by the component. `emptyClears: true` — the field can be
// cleared, so an admin who opened the box, left it empty and saved has said
// "store nothing" and gets a clear. Without it the empty box is an omission
// (the admin opened the field and thought better of it), and `SecretInput`'s
// caption tells them so before they save. An earlier design instead mutated
// `action` to `remove` whenever the open box was empty; that watcher raced the
// caller's own resets and staged removals nobody asked for.
//
// Pasted keys and tokens arrive with stray whitespace often enough that trimming
// is the default. It is an option because a PASSWORD is not that kind of secret:
// its edge characters are the user's to choose, and silently eating them would
// lock an account out with no visible cause.
export function secretPatch(
  action: SecretAction,
  typed: string,
  options: { trim?: boolean; emptyClears?: boolean } = {},
): string | null | undefined {
  if (action === 'remove') return null;
  if (action !== 'replace') return undefined;
  // Emptiness is judged on the trimmed string either way — whitespace alone is
  // never a value a caller means to send.
  if (typed.trim() === '') return options.emptyClears ? null : undefined;
  return options.trim === false ? typed : typed.trim();
}
