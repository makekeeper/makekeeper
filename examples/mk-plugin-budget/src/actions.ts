import { commands, refresh } from '@makekeeper/plugin-sdk';
import type { UiActionResult } from '@makekeeper/plugin-contract';
import { saveState, type State } from './state.ts';

export const addEntry = async (
  state: State,
  values: Record<string, string | number | boolean>,
): Promise<UiActionResult> => {
  const what = String(values['what'] ?? '').trim();
  const amount = Number(values['amount'] ?? 0);
  const currency = String(values['currency'] ?? 'EUR');
  if (!what || !Number.isFinite(amount)) return commands();
  state.entries.push({ id: `${Date.now()}`, what, amount, currency });
  await saveState(state);
  return commands(refresh({ tone: 'success', key: 'added' }));
};
