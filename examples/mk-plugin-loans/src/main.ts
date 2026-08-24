// mk-plugin-loans — LENT OUT: who borrowed your tools.
//
// The reference example for `scopeModel: 'per-scope'` — a plugin that keeps
// several users' data apart in its OWN storage, because the core's scope
// policy stops at the core and cannot reach into a third-party database.
//
// Wiring only. See state.ts (the partitioning that matters), screens.ts,
// actions.ts, manifest.ts and i18n/.

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { forgetScope, loadState, loansOf, saveState } from './state.ts';
import { homeScreen, widgetScreen } from './screens.ts';
import { markReturned, recordLoan } from './actions.ts';

const state = await loadState();

await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    render: async ({ screen: which, context }) =>
      which === 'widget'
        ? widgetScreen(state, context.scopeId)
        : homeScreen(state, context.scopeId),

    action: async ({ action, params, form, context, core }) => {
      if (action === 'add' && form) {
        return recordLoan(state, context.scopeId, form, core);
      }
      if (action === 'return') {
        return markReturned(state, context.scopeId, String(params['id'] ?? ''));
      }
      return { commands: [] };
    },

    // The tool answers for the CALLER's scope only — the same partition the
    // screens use, so the assistant cannot become a way around it.
    tool: async ({ context }) =>
      loansOf(state, context.scopeId).map((loan) => ({
        what: loan.what,
        toWhom: loan.toWhom,
        since: loan.since,
      })),

    onEvent: async ({ event }) => {
      if (event.type === 'core.scope-deleted') {
        // The core cannot delete what it cannot see: dropping the partition is
        // the plugin's own responsibility, and the reason a `per-scope` plugin
        // must subscribe to this event.
        forgetScope(state, event.scopeId);
        await saveState(state);
      }
    },

    purge: async () => {
      state.byScope = {};
      await saveState(state);
    },
  },
});
