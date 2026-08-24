// Transliteration to Latin — the pure half (first needed by the chat plugin's
// proxy-label module, #230: a wire header is a ByteString, so a non-Latin value
// crashes request construction outright).
//
// This module knows NO script and reads NO files: the tables arrive as data.
// Loading them is a server concern — the backend reads every JSON in its
// transliteration-tables asset folder once at startup (TransliterationService
// in backend-core) and builds a transliterator here. The browser never loads
// tables at all; the frontend asks the server to normalise (the folder cannot
// be listed from a bundle, so runtime reading and browser use are mutually
// exclusive — the server side won).

export type TransliterationTable = Record<string, string>;
export type Transliterator = (value: string) => string;

// Two tables claiming the same letter. The message is a key per §5.5; the
// offending character is a typed field, not prose baked into the message.
export class TransliterationCollisionError extends Error {
  constructor(readonly letter: string) {
    super('transliterate.errors.tableCollision');
    this.name = TransliterationCollisionError.name;
  }
}

// Merges the tables and returns the mapping function. Later tables may not
// redefine earlier letters — the merge fails loud on a collision, so two
// scripts cannot silently fight over a character; it surfaces at startup, not
// in somebody's label.
export function createTransliterator(
  tables: readonly TransliterationTable[],
): Transliterator {
  const lookup: TransliterationTable = {};
  for (const table of tables) {
    for (const [letter, replacement] of Object.entries(table)) {
      if (letter in lookup) {
        throw new TransliterationCollisionError(letter);
      }
      lookup[letter] = replacement;
    }
  }

  // Case survives: an uppercase source letter capitalises its replacement, so
  // the transliterator is usable on display text, not only on values a caller
  // lowercases anyway.
  return (value: string): string => {
    let out = '';
    for (const ch of value) {
      const lower = ch.toLowerCase();
      const mapped = lookup[lower];
      if (mapped === undefined) {
        out += ch;
      } else if (ch !== lower && mapped.length > 0) {
        out += mapped[0].toUpperCase() + mapped.slice(1);
      } else {
        out += mapped;
      }
    }
    return out;
  };
}
