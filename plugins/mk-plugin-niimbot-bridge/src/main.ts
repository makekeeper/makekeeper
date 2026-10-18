// mk-plugin-niimbot-bridge — the BLE print bridge (#362).
//
// A first-party EXTERNAL plugin that owns a Niimbot label printer: it registers
// with the core like any third-party container, declares `printDriver`, and
// prints rasters other plugins hand it. The browser never touches the radio,
// which is the only way an iPhone can print at all.
//
// Runs on the box next to the printer (a Raspberry Pi, a mini-PC, the HA host)
// with access to its Bluetooth adapter. Wiring only: jobs.ts (payload + queue),
// printer.ts (the device), screens.ts (settings), state.ts, manifest.ts.

import { startPlugin, toast, refresh, commands } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import {
  clampDensity,
  isLabelType,
  loadState,
  saveState,
  type State,
} from './state.ts';
import {
  PrintQueue,
  parseJob,
  testPattern,
  type PrintOutcome,
} from './jobs.ts';
import { printJob } from './printer.ts';
import { localBleTransport } from './local-ble.ts';
import type { ScannedPrinter } from './transport.ts';
import { settingsScreen } from './screens.ts';

const state: State = await loadState();

// The last scan's results, held in memory only: a list of radios that answered
// a minute ago is not configuration, and showing a stale one after a restart
// would invite choosing a printer that is no longer there.
let found: ScannedPrinter[] = [];

// How the printer is reached. One transport today — this box's own radio — and
// the seam is here so a BLE proxy (#363) is a second implementation rather than
// an edit of the print sequence.
const transport = localBleTransport();

// One printhead, so one job at a time, in arrival order (see jobs.ts).
const queue = new PrintQueue((job) => printJob(transport, state, job));

// The test label: the frame fills the page the printer declares it can burn.
const TEST_HEIGHT_DOTS = 160;

const print = (
  job: Parameters<typeof queue.submit>[0],
): Promise<PrintOutcome> => queue.submit(job);

await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  onSecretForgotten: async () => {
    delete state.secret;
    await saveState(state);
  },
  handlers: {
    render: async () => settingsScreen(state, found, queue.depth),

    action: async ({ action, params, form }) => {
      if (action === 'scan') {
        found = await transport.scan();
        return commands(
          refresh(),
          toast(
            found.length > 0 ? 'success' : 'error',
            found.length > 0 ? 'scanFound' : 'scanEmpty',
            { count: found.length },
          ),
        );
      }

      if (action === 'choose') {
        const address = String(params['address'] ?? '');
        if (address !== '') {
          state.address = address;
          await saveState(state);
        }
        return commands(
          refresh(),
          toast('success', 'chosen', { name: address }),
        );
      }

      if (action === 'save') {
        state.address = String(form?.['address'] ?? '').trim();
        state.density = clampDensity(form?.['density']);
        const labelType = form?.['labelType'];
        if (isLabelType(labelType)) state.labelType = labelType;
        await saveState(state);
        return commands(refresh(), toast('success', 'saved'));
      }

      if (action === 'check') {
        // Through the SAME queue as a real job: a test that bypassed it would
        // prove the printer works while a queued job was mid-label.
        const result = await print({
          raster: testPattern(
            manifest.printDriver?.maxWidthDots ?? 384,
            TEST_HEIGHT_DOTS,
          ),
          copies: 1,
        });
        // Narrowed in a statement rather than a ternary: a successful outcome
        // carries no key at all, and the union is what says so.
        if (result.ok) return commands(refresh(), toast('success', 'checkOk'));
        return commands(refresh(), toast('error', result.errorKey));
      }

      // An action this plugin does not know: nothing to do, and nothing to
      // say — the contract wants one of the two result shapes either way.
      return commands();
    },

    // The core relays print calls here (`<pluginId>.print-driver`). `describe`
    // is answered by the CORE from the manifest — every print dialog asks what
    // can print, and that question must not wake this container.
    capability: async ({ method, args }) => {
      if (method !== 'print') return null;
      const job = parseJob(args[0]);
      if (!job) return { ok: false, errorKey: 'errRaster' };
      if (job.raster.widthDots > (manifest.printDriver?.maxWidthDots ?? 384)) {
        return { ok: false, errorKey: 'errRaster' };
      }
      // Awaited: the caller is a person watching a dialog, and "printed" must
      // mean paper exists — which is also what makes the per-job answer honest
      // when two clients print at once.
      return print(job);
    },
  },
});

console.log(
  `mk-plugin-niimbot-bridge: ready (printer: ${state.address || 'not configured'})`,
);
