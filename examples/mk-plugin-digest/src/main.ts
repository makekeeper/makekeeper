// mk-plugin-digest — instance-wide statistics gathered by the plugin's OWN
// scheduler.
//
// The reference example for the two things a plugin can only do with
// background credentials, neither of which involves a user being present:
// a `background-instance` token reading cross-scope AGGREGATES (note what the
// instance surface can and cannot reach — series and per-scope breakdowns,
// never anyone's records), and a timer the core does not run for it.
//
// Wiring only. See collector.ts (the scheduler), screens.ts, state.ts.

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { loadState, saveState } from './state.ts';
import { homeScreen, widgetScreen } from './screens.ts';
import { startCollecting } from './collector.ts';

const state = await loadState();

const plugin = await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    render: async ({ screen: which }) =>
      which === 'widget' ? widgetScreen(state) : homeScreen(state),
  },
});

startCollecting(
  state,
  plugin.core,
  // A fresh snapshot is worth a nudge to anyone looking at the screen.
  async () => {
    await plugin.core.forScope(null).notifyChanged('home').catch(() => undefined);
  },
  // The usual cause of a failure is "not approved yet", i.e. no tokens: ask
  // for them again rather than assuming the ones we hold are still right.
  async () => {
    await plugin.refreshTokens();
  },
);
