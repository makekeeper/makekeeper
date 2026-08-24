// mk-plugin-shelf — reference external plugin for MakeKeeper.
//
// Shelf-life tracking for materials that expire (resin, glue, batteries,
// filament with a shelf life). The core's inventory knows how much you have;
// this plugin knows when it goes bad — the honest shape of a third-party
// plugin: it adds a dimension the product does not have and links back to the
// objects it does.
//
// This file is deliberately only WIRING. Everything else lives next to it:
//   manifest.ts  — identity and declarations
//   i18n/        — locale bundles
//   state.ts     — the plugin's own storage
//   screens.ts   — render handlers
//   actions.ts   — the only place anything is mutated

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { loadState, saveState, batchesOf, daysLeft } from './state.ts';
import { homeScreen, widgetScreen } from './screens.ts';
import { addBatch } from './actions.ts';

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

    action: async ({ action, form, context, core }) =>
      action === 'add' && form
        ? addBatch(state, context.scopeId, form, core)
        : { commands: [] },

    tool: async ({ args, context }) => {
      const days = typeof args['days'] === 'number' ? args['days'] : 30;
      return batchesOf(state, context.scopeId)
        .filter((b) => daysLeft(b.expiresOn) <= days)
        .map((b) => ({ label: b.label, expiresOn: b.expiresOn }));
    },

    onEvent: async ({ event }) => {
      // A deleted scope must not leave orphans in the plugin's own database —
      // the core cannot clean what it cannot see.
      if (event.type === 'core.scope-deleted') {
        state.batches = state.batches.filter((b) => b.scopeId !== event.scopeId);
        await saveState(state);
      }
    },

    exportBlob: async ({ scopeId }) =>
      Buffer.from(
        JSON.stringify({
          version: state.version,
          batches: state.batches.filter((b) => b.scopeId === scopeId),
        }),
      ),

    importBlob: async ({ blob }) => {
      const parsed = JSON.parse(Buffer.from(blob).toString('utf8')) as {
        version: number;
        batches: typeof state.batches;
      };
      // Refuse a payload from a newer plugin rather than guess at its shape.
      if (parsed.version > state.version) {
        throw new Error('blob version is newer than this plugin understands');
      }
      state.batches.push(...parsed.batches);
      await saveState(state);
    },

    purge: async () => {
      state.batches = [];
      await saveState(state);
    },
  },
});
