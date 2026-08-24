import { commands, refresh, toast, type CoreClient } from '@makekeeper/plugin-sdk';
import type { UiActionResult } from '@makekeeper/plugin-contract';
import { loansOf, saveState, setLoansOf, type State } from './state.ts';

export const recordLoan = async (
  state: State,
  scopeId: string,
  values: Record<string, string | number | boolean>,
  core: CoreClient,
): Promise<UiActionResult> => {
  const what = String(values['what'] ?? '').trim();
  const who = String(values['who'] ?? '').trim();
  if (!what || !who) return commands(toast('error', 'none'));

  loansOf(state, scopeId).push({
    id: `${Date.now()}`,
    what,
    toWhom: who,
    since: new Date().toISOString().slice(0, 10),
  });
  await saveState(state);
  await core.notifyChanged('home', scopeId || undefined);
  return commands(refresh({ tone: 'success', key: 'added', params: { what, who } }));
};

export const markReturned = async (
  state: State,
  scopeId: string,
  id: string,
): Promise<UiActionResult> => {
  setLoansOf(
    state,
    scopeId,
    loansOf(state, scopeId).filter((loan) => loan.id !== id),
  );
  await saveState(state);
  return commands(refresh({ tone: 'success', key: 'returned' }));
};
