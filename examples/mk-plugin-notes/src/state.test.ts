import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addNote,
  deleteNote,
  noteById,
  updateNote,
  forgetScope,
  loadState,
  notesOf,
  notesPage,
} from './state.ts';

// The privacy rules, stated as tests, because they are the plugin.
//
// A note is filed under (scope, author). Everything below is one of the ways
// that pair can be got wrong — and each would leak a person's notes to their
// workshop-mates, which is the only real failure this plugin has.

process.env['MK_STATE_DIR'] = process.env['MK_STATE_DIR'] ?? '/tmp/mk-notes-test';

const seed = async (): Promise<void> => {
  await loadState();
  await forgetScope('scope-a');
  await forgetScope('scope-b');
  await addNote({ scopeId: 'scope-a', userRef: 'anna', entityRef: 'mk://inventory/item/1', text: 'mine' });
  await addNote({ scopeId: 'scope-a', userRef: 'boris', entityRef: 'mk://inventory/item/1', text: 'his' });
  await addNote({ scopeId: 'scope-b', userRef: 'anna', entityRef: '', text: 'other workspace' });
};

test('one person does not see another’s notes on the same object', async () => {
  await seed();
  const anna = notesOf('scope-a', 'anna', 'mk://inventory/item/1');
  assert.deepEqual(anna.map((n) => n.text), ['mine']);
});

test('one workspace does not see another’s', async () => {
  await seed();
  assert.deepEqual(
    notesOf('scope-a', 'anna').map((n) => n.text),
    ['mine'],
  );
});

test('deleting takes the owner, so a guessed id is not enough', async () => {
  await seed();
  const hers = notesOf('scope-a', 'anna')[0]!;
  assert.equal(await deleteNote('scope-a', 'boris', hers.id), false);
  assert.equal(notesOf('scope-a', 'anna').length, 1);
  assert.equal(await deleteNote('scope-a', 'anna', hers.id), true);
  assert.equal(notesOf('scope-a', 'anna').length, 0);
});

test('a deleted workspace takes its notes with it, and only its own', async () => {
  await seed();
  const removed = await forgetScope('scope-a');
  assert.equal(removed, 2);
  assert.equal(notesOf('scope-b', 'anna').length, 1);
});

test('forgetting a scope twice is not an error — delivery is at-least-once', async () => {
  await seed();
  await forgetScope('scope-a');
  assert.equal(await forgetScope('scope-a'), 0);
});

test('a page is a page — the plugin never hands over the whole set', async () => {
  // The shape has to be the one that still works when this is a database with
  // a million rows: ask for page N, get page N and a count, never everything.
  await seed();
  for (let i = 0; i < 5; i += 1) {
    await addNote({ scopeId: 'scope-a', userRef: 'anna', entityRef: '', text: `n${i}` });
  }
  const first = notesPage('scope-a', 'anna', 0, 2);
  const second = notesPage('scope-a', 'anna', 1, 2);
  assert.equal(first.notes.length, 2);
  assert.equal(second.notes.length, 2);
  assert.equal(first.total, 6);
  // Pages do not overlap, and the newest note leads.
  assert.notEqual(first.notes[0]!.id, second.notes[0]!.id);
  assert.equal(first.notes[0]!.text, 'n4');
  // A page past the end is empty, not an error.
  assert.equal(notesPage('scope-a', 'anna', 99, 2).notes.length, 0);
});

test('paging respects the same (scope, author) filter as everything else', async () => {
  await seed();
  const page = notesPage('scope-a', 'boris', 0, 10);
  assert.deepEqual(page.notes.map((n) => n.text), ['his']);
  assert.equal(page.total, 1);
});

test('sorting orders the whole set, not the page', async () => {
  // The point of plugin-side sorting: sort the twenty rows on screen and you
  // have sorted the wrong thing.
  await seed();
  for (const text of ['zebra', 'apple', 'mango']) {
    await addNote({ scopeId: 'scope-a', userRef: 'anna', entityRef: '', text });
  }
  const firstPage = notesPage('scope-a', 'anna', 0, 2, {
    sort: 'note',
    direction: 'asc',
  });
  assert.deepEqual(
    firstPage.notes.map((n) => n.text),
    ['apple', 'mango'],
  );
  const secondPage = notesPage('scope-a', 'anna', 1, 2, {
    sort: 'note',
    direction: 'asc',
  });
  // "mine" and "zebra" follow — the order continues across the page boundary
  // rather than restarting.
  assert.deepEqual(
    secondPage.notes.map((n) => n.text),
    ['mine', 'zebra'],
  );
});

test('descending reverses it, and the default is newest first', async () => {
  await seed();
  const desc = notesPage('scope-a', 'anna', 0, 10, {
    sort: 'note',
    direction: 'desc',
  });
  assert.equal(desc.notes[0]!.text, 'mine');
  // No sort asked for: the newest note leads.
  const fallback = notesPage('scope-a', 'anna', 0, 10);
  assert.equal(fallback.notes[0]!.text, 'mine');
});

test('editing takes the owner, exactly like deleting', async () => {
  await seed();
  const hers = notesOf('scope-a', 'anna')[0]!;
  // Boris cannot rewrite Anna's note by guessing its id.
  assert.equal(await updateNote('scope-a', 'boris', hers.id, 'not mine'), false);
  assert.equal(noteById('scope-a', 'anna', hers.id)!.text, 'mine');
  assert.equal(await updateNote('scope-a', 'anna', hers.id, ' fixed '), true);
  assert.equal(noteById('scope-a', 'anna', hers.id)!.text, 'fixed');
});

test('an edit does not change when the note was written', async () => {
  await seed();
  const note = notesOf('scope-a', 'anna')[0]!;
  const before = note.createdAt;
  await updateNote('scope-a', 'anna', note.id, 'corrected a typo');
  // Otherwise a correction reshuffles a list sorted by date.
  assert.equal(noteById('scope-a', 'anna', note.id)!.createdAt, before);
});

test('an empty edit is refused rather than emptying the note', async () => {
  await seed();
  const note = notesOf('scope-a', 'anna')[0]!;
  assert.equal(await updateNote('scope-a', 'anna', note.id, '   '), false);
  assert.equal(noteById('scope-a', 'anna', note.id)!.text, 'mine');
});
