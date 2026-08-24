// mk-plugin-budget — spend tracking that CONSUMES another third-party
// plugin's capability.
//
// The consuming half of the capability pair. Two things worth copying:
//   * `capability:rates.convert` is a PERMISSION in the manifest, shown to the
//     admin at install like any other — consuming someone's capability is not
//     free-for-all just because both sides are third-party;
//   * the picker of currencies comes from the OFFERER (`currencies()`), not
//     from a hardcoded list, so it can never offer something that silently
//     fails to convert.
//
// Wiring only. See rates-client.ts (everything known about the other plugin),
// screens.ts, actions.ts.

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { loadState, saveState } from './state.ts';
import { homeScreen } from './screens.ts';
import { addEntry } from './actions.ts';

const state = await loadState();

await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    render: async ({ core }) => homeScreen(state, core),
    action: async ({ action, form }) =>
      action === 'add' && form ? addEntry(state, form) : { commands: [] },
  },
});
