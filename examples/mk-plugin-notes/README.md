# mk-plugin-notes — private notes on any object

A note you write about an item, a project or a shelf, visible to you and to
nobody else in the workspace. Two screens: your notes, and the same notes
mounted beside the object they are about.

## Why this example exists

It is the smallest honest use of two things the platform gained late:

- **`userRef`** (contract 1.4) — an opaque, per-plugin, one-way reference to
  the calling user. It is what separates *my* notes from *everyone's* inside
  one shared workspace. The plugin cannot tell who anyone is; it can only tell
  that this is the same someone as last time.
- **A slot contribution that knows what it is next to.** The plugin declares
  `slots: [{ slot: 'inventory.form.aside', screen: 'aside' }]`, and the host
  passes the item's ORef as slot context. The same storage, the same privacy,
  a narrower question.

## What it does not do

**It never reads the object it is attached to.** The manifest asks for no
permissions at all: a note carries a canonical ORef, and the core turns that
into an in-app link when it renders one. The plugin does not learn what the
object is called, and does not need to.

## Editing

Clicking a row opens that note in the form above the list — in place, so the
list stays visible, because a note usually needs fixing *because* of what is
next to it. Deleting stays a button of its own: the row click is the
non-destructive one.

An edit keeps `createdAt`. It is when the note was written, and a typo fixed a
week later does not make it a new note — otherwise a list sorted by date
reshuffles on every correction.

Every action carries the page and the sort it was invoked from, so correcting
a note on page three comes back to page three.

## Rules it demonstrates

- **Storage is filed under (scope, author)** and there is deliberately no
  "list everything" helper — a function that can return someone else's note is
  a function that eventually will.
- **Deleting and editing take the owner, not just the id.** An id is
  guessable, ownership is not — neither operation matches another person's
  note.
- **`core.scope-deleted` is handled**, idempotently: the core cannot clean data
  it cannot see.
- **A destructive action asks first** — `confirm` on the row's action, rendered
  by the core's own dialog.
- **No author, nothing to show.** A background call has no user, so it gets an
  explanation rather than someone else's notes.

## Run it

```bash
./examples/run-plugin.sh examples/mk-plugin-notes --core http://localhost:3000
npm --prefix examples/mk-plugin-notes test
```

Then pair it with the code the launcher prints, approve it (it asks for no
permissions), and open an inventory item — the notes box is in the right-hand
column.
