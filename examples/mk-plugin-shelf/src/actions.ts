// Action handlers: what happens when the user submits a form or clicks a row.
//
// Kept apart from rendering because they are the only place this plugin
// MUTATES anything — a reviewer looking for "what can this change?" reads one
// short file.

import { commands, refresh, toast, type CoreClient } from '@makekeeper/plugin-sdk';
import type { UiActionResult } from '@makekeeper/plugin-contract';
import { saveState, type State } from './state.ts';

export const addBatch = async (
  state: State,
  scopeId: string,
  values: Record<string, string | number | boolean>,
  core: CoreClient,
): Promise<UiActionResult> => {
  const label = String(values['label'] ?? '').trim();
  const expiresOn = String(values['expiresOn'] ?? '');
  if (!label || !expiresOn) return commands(toast('error', 'none'));

  state.batches.push({
    id: `${Date.now()}`,
    label,
    expiresOn,
    scopeId,
  });
  await saveState(state);
  // Nudge every client viewing this screen; the core relays it over its own
  // socket and they refetch the render.
  await core.notifyChanged('home', scopeId || undefined);
  return commands(refresh({ tone: 'success', key: 'added', params: { label } }));
};
