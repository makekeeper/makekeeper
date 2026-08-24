// mk-plugin-climate — workshop climate monitor.
//
// Watches temperature and humidity where materials are stored and says when a
// spot has drifted out of spec for what lives there. Filament, resin, PCBs and
// cells all have storage conditions; nobody tracks them because there is
// nowhere to.
//
// Why this belongs OUTSIDE the core: it integrates with whatever sensor stack
// the workshop happens to have, and a workshop without sensors should not
// carry the feature at all.
//
// Wiring only:
//   profiles.ts            — what "out of spec" means per material
//   state.ts               — spots, readings, the out-of-spec rule
//   sources/home-assistant — the PULL path (polling)
//   sources/ingest         — the PUSH path (a plugin-owned public route)
//   screens.ts / actions.ts

import { startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import {
  isOutOfSpec,
  latestReading,
  loadState,
  saveState,
} from './state.ts';
import { homeScreen, widgetScreen } from './screens.ts';
import { addSpot, removeSpot } from './actions.ts';
import { startPolling } from './sources/home-assistant.ts';
import { makeIngestRoute } from './sources/ingest.ts';

const state = await loadState();

// Declared before the plugin so both intake paths can nudge open screens; the
// client refetches the render, which is all an invalidation ever carries.
const notifyChanged = async (): Promise<void> => {
  await plugin.core.forScope(null).notifyChanged('home').catch(() => undefined);
};

const plugin = await startPlugin({
  manifest,
  publicRoutes: { '/ingest': makeIngestRoute(state, notifyChanged) },
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    render: async ({ screen: which, core }) =>
      which === 'widget' ? widgetScreen(state) : homeScreen(state, core),

    action: async ({ action, params, form }) => {
      if (action === 'add' && form) return addSpot(state, form);
      if (action === 'remove') {
        return removeSpot(state, String(params['id'] ?? ''));
      }
      return { commands: [] };
    },

    tool: async () =>
      state.spots.map((spot) => {
        const reading = latestReading(spot);
        return {
          spot: spot.label,
          profile: spot.profile,
          storageRef: spot.storageRef ?? null,
          temperatureC: reading?.temp ?? null,
          humidityPercent: reading?.humidity ?? null,
          outOfSpec: isOutOfSpec(spot),
          readingAt: reading?.at ?? null,
        };
      }),

    purge: async () => {
      state.spots = [];
      await saveState(state);
    },
  },
});

startPolling(state, notifyChanged);
