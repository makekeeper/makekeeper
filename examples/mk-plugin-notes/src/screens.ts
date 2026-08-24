import {
  screen,
  paragraph,
  callout,
  divider,
  form,
  list,
  table,
  button,
} from '@makekeeper/plugin-sdk';
import type { UiNode, UiScreen } from '@makekeeper/plugin-contract';
import {
  noteById,
  notesPage,
  type Note,
  type SortDirection,
  type SortKey,
} from './state.ts';

// Age, not a timestamp: the plugin knows neither the reader's timezone nor
// their locale, and "written 5 min ago" needs neither.
const written = (createdAt: string): { key: string; params?: Record<string, number> } => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000),
  );
  return minutes < 1
    ? { key: 'writtenJustNow' }
    : { key: 'writtenAgo', params: { minutes } };
};

// One note as a list item. The TEXT is the user's own data and travels as a
// plain string; everything the plugin says about it is a key.
//
// Deleting is an action ON the row, with a confirmation — a list where reading
// and destroying share a click target is a list nobody scrolls comfortably.
const noteItem = (
  note: Note,
  withRef: boolean,
  where: Record<string, string | number | boolean> = {},
) => ({
  title: note.text,
  subtitle: written(note.createdAt),
  onClick: { action: 'edit', params: { id: note.id, ...where } },
  // The object the note is about renders as an in-app link: the core resolves
  // the ORef, so this plugin never learns what the object is called (§5.9).
  ...(withRef && note.entityRef ? { ref: note.entityRef } : {}),
  action: {
    label: { key: 'deleteLabel' },
    onClick: { action: 'delete', params: { id: note.id } },
    confirm: { key: 'deleteConfirm' },
    variant: 'danger' as const,
  },
});

// Signed out — or on a background call — there is no author, so there is
// nothing that could be shown without showing someone else's notes.
const anonymous = (titleKey: string): UiScreen =>
  screen(titleKey, [callout('anonymous', 'neutral')]);

// One page at a time, from the plugin. The core draws the controls and asks
// for the next page by re-rendering with `page` — nothing walks the whole set
// on its way to the browser.
const PAGE = 20;

export const homeScreen = (
  scopeId: string,
  userRef: string | undefined,
  view: {
    page: number;
    sort: SortKey;
    direction: SortDirection;
    editing?: string;
  },
): UiScreen => {
  if (!userRef) return anonymous('title');
  const { notes, total } = notesPage(scopeId, userRef, view.page, PAGE, {
    sort: view.sort,
    direction: view.direction,
  });
  // Where the screen is standing, echoed into every action so a redraw comes
  // back to the same page and the same order instead of to the top.
  const where = {
    page: view.page,
    sort: view.sort,
    direction: view.direction,
  };
  const editing = view.editing
    ? noteById(scopeId, userRef, view.editing)
    : null;
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    // A note written here attaches to nothing. Said out loud, because the
    // alternative is a person wondering why it did not appear on the item they
    // had open.
    paragraph('standaloneHint', { variant: 'muted' }),
    ...noteForm('', editing, where),
    divider(),
    // A TABLE here rather than a list: with the plugin paging its own data,
    // the columns are what a person sorts by, and the sort has to travel to
    // the plugin — the twenty rows on screen are not the set being ordered.
    table({
      paging: {
        page: view.page,
        pageSize: PAGE,
        total,
        sort: { key: view.sort, direction: view.direction },
      },
      columns: [
        { key: 'note', labelKey: 'colNote', sortable: true },
        { key: 'about', labelKey: 'colObject', sortable: true },
        { key: 'written', labelKey: 'colWritten', align: 'right', sortable: true },
      ],
      rows: notes.map((note) => ({
        // Clicking the row edits it: non-destructive, and the destructive
        // action stays a button of its own.
        onClick: { action: 'edit', params: { id: note.id, ...where } },
        cells: {
          note: { text: note.text },
          about: note.entityRef ? { text: note.entityRef, ref: note.entityRef } : {},
          written: { text: written(note.createdAt) },
        },
        action: {
          label: { key: 'deleteLabel' },
          onClick: { action: 'delete', params: { id: note.id } },
          confirm: { key: 'deleteConfirm' },
          variant: 'danger' as const,
        },
      })),
      emptyKey: 'empty',
    }),
  ]);
};

// The same plugin, mounted beside an object by the host: same storage, same
// privacy, narrower question — "what did I write about THIS one".
export const asideScreen = (
  scopeId: string,
  userRef: string | undefined,
  entityRef: string,
  page = 0,
  editingId?: string,
): UiScreen => {
  if (!userRef) return anonymous('asideTitle');
  if (!entityRef) return screen('asideTitle', [callout('noObject', 'neutral')]);
  const { notes, total } = notesPage(scopeId, userRef, page, PAGE, { entityRef });
  const editing = editingId ? noteById(scopeId, userRef, editingId) : null;
  const where = { page, entityRef };
  return screen('asideTitle', [
    ...noteForm(entityRef, editing, where),
    list({
      // No link back to the object: we are standing on it.
      items: notes.map((note) => noteItem(note, false, where)),
      emptyKey: 'emptyHere',
      paging: { page, pageSize: PAGE, total },
    }),
  ]);
};

// One form, two jobs: writing a note and correcting one. Editing in place
// rather than in a modal keeps the list visible — a note usually needs fixing
// *because* of what is next to it.
//
// The entity a new note attaches to travels in the ACTION, not in a field: it
// is context, not something anyone should be typing or able to change.
const noteForm = (
  entityRef: string,
  editing: Note | null,
  view?: Record<string, string | number | boolean>,
): UiNode[] => [
  form({
    fields: [
      {
        name: 'text',
        type: 'textarea',
        labelKey: 'fieldText',
        placeholderKey: 'placeholder',
        value: editing?.text ?? '',
        required: true,
      },
    ],
    submitKey: editing ? 'saveEdit' : 'add',
    onSubmit: editing
      ? { action: 'save', params: { id: editing.id, ...(view ?? {}) } }
      : { action: 'add', params: { entityRef } },
  }),
  ...(editing
    ? [
        button('cancelEdit', { action: 'cancel', params: view ?? {} }, {
          variant: 'ghost',
        }),
      ]
    : []),
];

export { written };
