// mk-plugin-notes — private notes attached to any object.
//
// The example for two things the platform gained late and nothing else
// exercises: the opaque `userRef`, which separates PEOPLE inside one shared
// workspace, and a slot contribution that learns which object it was mounted
// beside. Everything else is deliberately small — the interesting part is who
// can see what, not what a note is.
//
// Wiring only:
//   manifest.ts — identity, the per-scope promise, the slot it fills
//   state.ts    — storage, filed under (scope, author), and its invariants
//   screens.ts  — the two screens, pure: state in, tree out

import { commands, refresh, startPlugin, toast } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import {
  addNote,
  deleteNote,
  forgetScope,
  loadState,
  notesOf,
  setSecret,
  storedSecret,
  updateNote,
} from './state.ts';
import { asideScreen, homeScreen } from './screens.ts';
import type { SortDirection, SortKey } from './state.ts';

const SORT_KEYS: SortKey[] = ['written', 'about', 'note'];

// Where the caller was standing, rebuilt from the params an action carries.
// An action that redraws must come back to the same page and the same order,
// or correcting a note on page three throws the reader to page one.
const screenFor = (
  scopeId: string,
  userRef: string,
  params: Record<string, string | number | boolean> | undefined,
  editing?: string,
) => {
  const page = Math.max(0, Number(params?.['page'] ?? 0) || 0);
  const entityRef = String(params?.['entityRef'] ?? '');
  if (entityRef) {
    return asideScreen(scopeId, userRef, entityRef, page, editing);
  }
  const sort = SORT_KEYS.includes(params?.['sort'] as SortKey)
    ? (params?.['sort'] as SortKey)
    : 'written';
  const direction: SortDirection =
    params?.['direction'] === 'asc' || params?.['direction'] === 'desc'
      ? params['direction']
      : sort === 'written'
        ? 'desc'
        : 'asc';
  return homeScreen(scopeId, userRef, { page, sort, direction, editing });
};

await loadState();

await startPlugin({
  manifest,
  pluginSecret: storedSecret(),
  onSecretIssued: setSecret,
  onSecretForgotten: async () => setSecret(''),
  handlers: {
    render: async ({ screen, params, context }) => {
      // Everything this plugin shows is decided by these two values, and
      // neither is chosen by the caller: the core puts them on the context.
      const { scopeId, userRef } = context;
      // The core asks for a page by re-rendering with this param (contract
      // 1.8); anything unparseable is page one.
      const page = Math.max(0, Number(params['page'] ?? 0) || 0);
      if (screen === 'aside') {
        return asideScreen(scopeId, userRef, params['entityRef'] ?? '', page);
      }
      // Sort and direction arrive the same way (contract 1.9). Anything the
      // plugin does not recognise falls back to its default rather than
      // producing an empty or arbitrarily ordered page.
      const sort = SORT_KEYS.includes(params['sort'] as SortKey)
        ? (params['sort'] as SortKey)
        : 'written';
      const direction: SortDirection =
        params['direction'] === 'asc' || params['direction'] === 'desc'
          ? params['direction']
          : sort === 'written'
            ? 'desc'
            : 'asc';
      return homeScreen(scopeId, userRef, { page, sort, direction });
    },

    action: async ({ action, params, form, context }) => {
      const { scopeId, userRef } = context;
      // No author, no writing. A background caller has no notes of its own and
      // must not be able to author one on someone's behalf.
      if (!userRef) return commands(toast('error', 'anonymous'));

      if (action === 'add') {
        const text = typeof form?.['text'] === 'string' ? form['text'].trim() : '';
        if (!text) return commands(toast('error', 'emptyText'));
        await addNote({
          scopeId,
          userRef,
          // From the ACTION, not the form: what a note is about is context,
          // not something a caller should be able to retarget.
          entityRef: String(params?.['entityRef'] ?? ''),
          text,
        });
        return commands(refresh({ tone: 'success', key: 'added' }));
      }

      // Editing is a state of the SCREEN, not of storage: the action returns
      // the same screen with the form filled in, keeping the page and the
      // order the reader was on.
      if (action === 'edit' || action === 'cancel') {
        const editing = action === 'edit' ? String(params?.['id'] ?? '') : undefined;
        return { screen: screenFor(scopeId, userRef, params, editing) };
      }

      if (action === 'save') {
        const text = typeof form?.['text'] === 'string' ? form['text'].trim() : '';
        if (!text) return commands(toast('error', 'emptyText'));
        const saved = await updateNote(
          scopeId,
          userRef,
          String(params?.['id'] ?? ''),
          text,
        );
        if (!saved) return commands(toast('error', 'editGone'));
        return {
          screen: screenFor(scopeId, userRef, params),
        };
      }

      if (action === 'delete') {
        const id = String(params?.['id'] ?? '');
        // Ownership is part of the query, not a check after the fact: the
        // delete simply does not match another person's note.
        const removed = await deleteNote(scopeId, userRef, id);
        return removed
          ? commands(refresh({ tone: 'success', key: 'deleted' }))
          : commands();
      }

      return commands();
    },

    tool: async ({ context }) =>
      context.userRef
        ? {
            notes: notesOf(context.scopeId, context.userRef).map((note) => ({
              text: note.text,
              about: note.entityRef || null,
              writtenAt: note.createdAt,
            })),
          }
        : { notes: [] },

    onEvent: async ({ event }) => {
      // A deleted workspace takes its notes with it — the core cannot clean
      // what it cannot see. Idempotent by construction: forgetting a scope
      // twice forgets nothing the second time.
      if (event.type === 'core.scope-deleted' && event.scopeId) {
        await forgetScope(event.scopeId);
      }
    },
  },
});
