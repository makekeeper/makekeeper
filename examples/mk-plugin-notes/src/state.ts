import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Storage, and the two invariants that protect it.
//
// A note is filed under (scopeId, userRef) and nothing reads it outside that
// pair. The scope keeps workspaces apart — the promise `scopeModel:
// 'per-scope'` makes — and the userRef keeps PEOPLE apart inside one shared
// workspace, which is the whole point of this plugin. Neither is a value the
// plugin invents: both arrive on the call context, and a call without a
// userRef (background work) has no notes to see.

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'notes.json');
const TEXT_LIMIT = 2000;
const PER_OWNER_LIMIT = 500;

export interface Note {
  id: string;
  scopeId: string;
  // Opaque, per-plugin reference to the author (contract 1.4). Not a name, not
  // an id — the plugin cannot tell who this is, only that it is the same
  // person as last time.
  userRef: string;
  // Canonical ORef of what the note is about; empty for a standalone note.
  entityRef: string;
  text: string;
  createdAt: string;
}

interface Stored {
  version: 1;
  notes: Note[];
  secret?: string;
}

let state: Stored = { version: 1, notes: [] };

export const loadState = async (): Promise<Stored> => {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, 'utf8')) as Stored;
    state = { ...stored, notes: stored.notes ?? [] };
  } catch {
    state = { version: 1, notes: [] };
  }
  return state;
};

export const saveState = async (): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};

export const setSecret = async (secret: string): Promise<void> => {
  state.secret = secret;
  await saveState();
};

export const storedSecret = (): string | undefined => state.secret;

// Every read goes through here. There is deliberately no "list all notes"
// helper: a function that can return someone else's note is a function that
// eventually will.
export const notesOf = (
  scopeId: string,
  userRef: string,
  entityRef?: string,
): Note[] =>
  state.notes
    .filter(
      (note) =>
        note.scopeId === scopeId &&
        note.userRef === userRef &&
        (entityRef === undefined || note.entityRef === entityRef),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// One page of them, and the count.
//
// The plugin pages its own data (contract 1.8) rather than handing every note
// to the core: a JSON file holding a few hundred is fine to count, but the
// SHAPE has to be the one that still works when the store is a database with a
// million rows — the core asks for page N and gets page N, never everything.
export type SortKey = 'written' | 'about' | 'note';
export type SortDirection = 'asc' | 'desc';

// Sorting happens HERE, over the whole set, not over the page — sorting the
// twenty rows that happen to be on screen would sort the wrong thing. Which is
// also why the core hands the sort down as a param instead of doing it itself
// whenever a plugin owns the paging.
const compare = (a: Note, b: Note, key: SortKey): number => {
  if (key === 'about') return a.entityRef.localeCompare(b.entityRef);
  if (key === 'note') return a.text.localeCompare(b.text);
  return a.createdAt.localeCompare(b.createdAt);
};

export const notesPage = (
  scopeId: string,
  userRef: string,
  page: number,
  pageSize: number,
  opts: {
    entityRef?: string;
    sort?: SortKey;
    direction?: SortDirection;
  } = {},
): { notes: Note[]; total: number } => {
  const all = notesOf(scopeId, userRef, opts.entityRef);
  const key = opts.sort ?? 'written';
  // Newest first is the useful default for notes, so an unspecified direction
  // means descending on the date and ascending on anything else.
  const direction =
    opts.direction ?? (key === 'written' ? 'desc' : 'asc');
  const factor = direction === 'desc' ? -1 : 1;
  const sorted = [...all].sort((a, b) => factor * compare(a, b, key));
  const from = Math.max(0, page) * pageSize;
  return { notes: sorted.slice(from, from + pageSize), total: all.length };
};

export const addNote = async (input: {
  scopeId: string;
  userRef: string;
  entityRef: string;
  text: string;
}): Promise<Note> => {
  const note: Note = {
    id: randomUUID(),
    scopeId: input.scopeId,
    userRef: input.userRef,
    entityRef: input.entityRef,
    // Trimmed and capped here rather than at the screen: this is the only door
    // into storage, and a limit enforced at the door cannot be walked around
    // by a caller that skips the form.
    text: input.text.trim().slice(0, TEXT_LIMIT),
    createdAt: new Date().toISOString(),
  };
  state.notes.unshift(note);
  // Oldest first out, per person, so one prolific author cannot crowd out
  // everyone else's notes.
  const own = state.notes.filter(
    (n) => n.scopeId === note.scopeId && n.userRef === note.userRef,
  );
  if (own.length > PER_OWNER_LIMIT) {
    const doomed = new Set(own.slice(PER_OWNER_LIMIT).map((n) => n.id));
    state.notes = state.notes.filter((n) => !doomed.has(n.id));
  }
  await saveState();
  return note;
};

// Editing takes the owner too, for the same reason deleting does: the update
// simply does not match another person's note. Text is trimmed and capped at
// the door, exactly like a new one — this is the second way in, not a second
// set of rules.
export const updateNote = async (
  scopeId: string,
  userRef: string,
  id: string,
  text: string,
): Promise<boolean> => {
  const note = state.notes.find(
    (item) =>
      item.id === id && item.scopeId === scopeId && item.userRef === userRef,
  );
  const trimmed = text.trim().slice(0, TEXT_LIMIT);
  if (!note || !trimmed) return false;
  note.text = trimmed;
  // `createdAt` is not touched: it is when the note was written, and a typo
  // fixed a week later does not make it a new note — sorting by date would
  // otherwise shuffle on every correction.
  await saveState();
  return true;
};

export const noteById = (
  scopeId: string,
  userRef: string,
  id: string,
): Note | null =>
  state.notes.find(
    (note) =>
      note.id === id && note.scopeId === scopeId && note.userRef === userRef,
  ) ?? null;

// Deleting takes the owner, not just the id: an id is guessable, ownership is
// not. The caller cannot delete what it cannot see.
export const deleteNote = async (
  scopeId: string,
  userRef: string,
  id: string,
): Promise<boolean> => {
  const before = state.notes.length;
  state.notes = state.notes.filter(
    (note) =>
      !(note.id === id && note.scopeId === scopeId && note.userRef === userRef),
  );
  if (state.notes.length === before) return false;
  await saveState();
  return true;
};

// A deleted scope takes its notes with it. The core cannot clean data it
// cannot see, so this is the plugin's own responsibility (§13).
export const forgetScope = async (scopeId: string): Promise<number> => {
  const before = state.notes.length;
  state.notes = state.notes.filter((note) => note.scopeId !== scopeId);
  const removed = before - state.notes.length;
  if (removed > 0) await saveState();
  return removed;
};
