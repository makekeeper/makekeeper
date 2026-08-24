// mk-plugin-rates — real ECB reference rates, offered to the rest of the
// instance as a capability.
//
// Two jobs, and the second is the interesting one:
//   1. keep a fresh copy of the European Central Bank's daily reference rates
//      (via the free Frankfurter API — no key, no account);
//   2. offer `rates.convert` to any other plugin. The id is the interface and
//      the implementation is nobody else's business, which is why swapping a
//      hardcoded table for a live source changed nothing for consumers.
//
// Wiring only. See rates.ts (fetching, caching, conversion), screens.ts.

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { loadState, saveState } from './state.ts';
import { homeScreen, settingsScreen } from './screens.ts';
import { handleAction } from './actions.ts';
import {
  convert,
  round2,
  snapshotFor,
  startRefreshing,
  supportedCurrencies,
} from './rates.ts';

const state = await loadState();

await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    // `form` carries what the user has typed but not saved — the filter on the
    // rates table, the automatic-updates switch — so a re-render answers the
    // question that was just asked instead of the one in storage.
    render: async ({ screen, form }) =>
      screen === 'settings'
        ? settingsScreen(state, form)
        : homeScreen(state),

    action: async ({ action, form }) => handleAction(state, action, form),

    tool: async ({ args }) => {
      const snapshot = await snapshotFor(
        state,
        typeof args['date'] === 'string' ? args['date'] : undefined,
      );
      if (!snapshot) return null;
      const value = convert(
        snapshot,
        Number(args['amount']),
        String(args['from'] ?? '').toUpperCase(),
        String(args['to'] ?? '').toUpperCase(),
      );
      return value === null
        ? null
        : { amount: round2(value), rateDate: snapshot.date, base: snapshot.base };
    },

    // The capability surface. Two methods:
    //   convert(amount, from, to, date?) — the fourth argument is additive, so
    //     consumers passing three keep working;
    //   currencies()                     — what can actually be converted, so a
    //     consumer builds its picker from reality instead of a hardcoded list
    //     that eventually offers something the ECB stopped publishing.
    capability: async ({ method, args }) => {
      if (method === 'currencies') return supportedCurrencies(state);
      if (method !== 'convert') return null;
      const [amount, from, to, date] = args as [
        number,
        string,
        string,
        string | undefined,
      ];
      const snapshot = await snapshotFor(state, date);
      if (!snapshot) return null;
      return convert(
        snapshot,
        amount,
        String(from ?? '').toUpperCase(),
        String(to ?? '').toUpperCase(),
      );
    },
  },
});

startRefreshing(state);
