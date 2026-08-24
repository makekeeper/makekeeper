// mk-plugin-bambu — a Bambu Lab printer on your MakeKeeper dashboard.
//
// The archetypal external plugin: the core must never learn what a P1S is —
// not its MQTT topics, not its firmware quirks, not its state vocabulary — and
// a workshop without one should not carry the feature at all.
//
// Where to read the printer from is CONFIGURED IN THE UI, not in the
// container's environment: see config.ts and settings-screen.ts. The source
// manager restarts the connection when settings are saved, so fixing a typo in
// an IP address does not mean redeploying anything.
//
// Wiring only:
//   config.ts / settings-screen.ts — connection settings and their screen
//   printer.ts                      — what a report means
//   sources/manager.ts              — owns whichever source is configured
//   sources/bambu-lan.ts            — the printer's own MQTT interface
//   sources/home-assistant.ts       — HA entities, when HA already watches it
//   state.ts / screens.ts

import { commands, navigate, refresh, startPlugin } from '@makekeeper/plugin-sdk';
import { manifest } from './manifest.ts';
import { applyForm } from './config.ts';
import { appendLog, loadState, saveState } from './state.ts';
import { homeScreen, widgetScreen } from './screens.ts';
import { settingsScreen } from './settings-screen.ts';
import { fetchEntityIds } from './sources/ha-discovery.ts';
import { jobEnded, mergeReport, type PrinterStatus } from './printer.ts';
import { SourceManager } from './sources/manager.ts';

const state = await loadState();

const plugin = await startPlugin({
  manifest,
  pluginSecret: state.secret,
  onSecretIssued: async (secret) => {
    state.secret = secret;
    await saveState(state);
  },
  handlers: {
    render: async ({ screen: which, form }) => {
      if (which === 'widget') return widgetScreen(state);
      // `form` carries what the user has picked but not saved, so the source
      // selector can redraw the form without a round trip through storage.
      if (which === 'settings') {
        return settingsScreen(state.config, form, {
          entities: state.haEntities,
          check: state.haCheck,
        });
      }
      return homeScreen(state);
    },

    action: async ({ action, form }) => {
      // "Test connection" runs against what is TYPED, not what is stored: the
      // whole point is to check credentials before committing to them. A
      // secret field submits empty when unchanged, so a blank token means
      // "the one already stored".
      if (action === 'checkHa') {
        const typed = (name: string): string => {
          const value = form?.[name];
          return typeof value === 'string' ? value.trim() : '';
        };
        const url = typed('haUrl') || state.config.haUrl;
        const token = typed('haToken') || state.config.haToken;
        const at = new Date().toISOString();
        if (!url || !token) {
          // No detail: the screen has its own wording for "nothing to check
          // with", and a sentence built here would be a literal (§5.5).
          state.haCheck = { ok: false, at };
        } else {
          try {
            state.haEntities = await fetchEntityIds(url, token);
            state.haCheck = { ok: true, at };
            // Credentials that just proved themselves are the ones to keep —
            // and the token cannot be shown back, so leaving it unsaved would
            // mean checking one thing and storing another.
            state.config = { ...state.config, haUrl: url, haToken: token };
          } catch (err: unknown) {
            state.haCheck = {
              ok: false,
              detail: err instanceof Error ? err.message : String(err),
              at,
            };
          }
        }
        await saveState(state);
        // A screen, not a toast: the redraw is the result — the dropdowns are
        // now populated — and returning it keeps everything typed so far.
        return {
          screen: settingsScreen(state.config, form, {
            entities: state.haEntities,
            check: state.haCheck,
          }),
        };
      }

      // Ask the source for a reading right now. The screen offers this because
      // nothing on it moves on a visible timer — an idle printer produces no
      // events for hours, and a page nobody can refresh reads as a broken page.
      if (action === 'refreshNow') {
        await sources.refresh();
        return commands(refresh());
      }

      // The "not configured" callout names Settings; this is what takes the
      // user there.
      if (action === 'openSettings') {
        return commands(navigate({ screen: 'settings' }));
      }

      if (action !== 'saveSettings' || !form) return commands();
      state.config = applyForm(state.config, form);
      await saveState(state);
      // Reconnect immediately with the new settings — that is the whole point
      // of settings living here instead of in the environment.
      sources.apply(state.config);
      return commands(refresh({ tone: 'success', key: 'saved' }));
    },

    tool: async () => ({
      connected: state.connection.ok,
      state: state.status.state,
      job: state.status.job,
      percent: state.status.percent,
      remainingMinutes: state.status.remainingMinutes,
      nozzleTempC: state.status.nozzleTempC,
      bedTempC: state.status.bedTempC,
      readingAt: state.status.at,
    }),
  },
});

const nudge = async (): Promise<void> => {
  await plugin.core.forScope(null).notifyChanged('home').catch(() => undefined);
};

// One place where a new status is absorbed, whichever source produced it:
// remember when a job started, log it when it ends, and only nudge open
// screens when something a viewer would notice actually changed.
const applyStatus = async (next: PrinterStatus): Promise<void> => {
  const previous = state.status;
  const ended = jobEnded(previous.state, next.state);

  if (previous.state !== 'printing' && next.state === 'printing') {
    state.jobStartedAt = new Date().toISOString();
  }
  if (ended) {
    appendLog(state, {
      job: previous.job ?? next.job ?? '—',
      outcome: ended,
      startedAt: state.jobStartedAt,
      endedAt: new Date().toISOString(),
    });
    state.jobStartedAt = null;
  }

  state.status = next;
  await saveState(state);

  const worthANudge =
    ended !== null ||
    previous.state !== next.state ||
    previous.percent !== next.percent;
  if (worthANudge) await nudge();
};

const sources = new SourceManager({
  // Reports are deltas — merge onto the last known status, never replace.
  onReport: (report) => applyStatus(mergeReport(state.status, report)),
  onStatus: (status) => applyStatus(status),
  onConnection: async (ok, detail) => {
    state.connection = { ok, detail, at: new Date().toISOString() };
    await saveState(state);
    await nudge();
  },
});

sources.apply(state.config);
