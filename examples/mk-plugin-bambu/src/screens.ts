import {
  screen,
  paragraph,
  heading,
  stat,
  divider,
  detail,
  button,
  table,
  callout,
} from '@makekeeper/plugin-sdk';
import type { UiNode, UiScreen, UiText } from '@makekeeper/plugin-contract';
import { isComplete } from './config.ts';
import type { PrintState } from './printer.ts';
import type { State } from './state.ts';

const STATE_KEY: Record<PrintState, string> = {
  idle: 'stateIdle',
  printing: 'statePrinting',
  paused: 'statePaused',
  finished: 'stateFinished',
  failed: 'stateFailed',
  unknown: 'stateUnknown',
};

// A missing number is a dash, not a zero and not a sentence: the printer did
// not report it, which is not the same as it being nothing.
const DASH = '—';

// Numbers that carry a UNIT go through i18n — "min" is a word, and a language
// that puts it elsewhere in the phrase has nowhere to put it otherwise.
const withUnit = (key: string, value: number | null): string | UiText =>
  value === null ? DASH : { key, params: { value } };

const layerValue = (
  layer: number | null,
  total: number | null,
): string | UiText => {
  if (layer === null) return DASH;
  return total === null
    ? { key: 'layerValue', params: { layer } }
    : { key: 'layerOfValue', params: { layer, total } };
};

// Why there is no data, in the order the user can act on it.
//
// "Not connected ()" was worse than useless: the callout took a {detail} the
// caller never passed, so every cause — nothing configured yet, a refused
// connection, a 401 — printed the same empty parentheses. A screen that
// reports a fault owes the reason.
const notConnected = (state: State): UiNode[] => {
  if (!isComplete(state.config)) {
    return [
      callout('notConfigured', 'warning'),
      // The callout names the place; the button goes there. Telling someone
      // where to click is not the same as letting them click.
      button('openSettings', { action: 'openSettings' }, { variant: 'secondary' }),
    ];
  }
  const reason = state.connection.detail;
  return [
    reason
      ? callout('offline', 'warning', { detail: reason })
      : callout('offlineUnknown', 'warning'),
  ];
};

// How old the reading is, in whole minutes. Age travels better than a
// timestamp: the plugin knows neither the reader's timezone nor their locale,
// and "2 minutes ago" needs neither.
const freshness = (at: string): UiNode => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(at).getTime()) / 60_000),
  );
  return minutes < 1
    ? paragraph('updatedJustNow', { variant: 'muted' })
    : paragraph('updatedAgo', { params: { minutes }, variant: 'muted' });
};

// The headline answers the question the current state makes people ask. Mid
// print that is "how far and how much longer"; otherwise it is "what is it
// doing", which a percentage cannot say.
const headline = (state: State): UiNode[] => {
  const status = state.status;
  if (status.state === 'printing') {
    return [
      stat('progress', status.percent === null ? DASH : String(status.percent), {
        unitKey: 'percent',
      }),
      paragraph('remainingLine', {
        params: { value: status.remainingMinutes ?? DASH },
        variant: 'muted',
      }),
    ];
  }
  if (status.state === 'unknown' && status.percent === null) {
    return [callout('waiting', 'neutral')];
  }
  return [paragraph(STATE_KEY[status.state], { variant: 'heading' })];
};

export const widgetScreen = (state: State): UiScreen => {
  if (!state.connection.ok) {
    // A widget is a guest on someone else's page: it states the problem and
    // stops, without the settings button that belongs on the plugin's own
    // screen.
    return screen('widget', [notConnected(state)[0]!]);
  }
  const status = state.status;
  return screen('widget', [
    paragraph(STATE_KEY[status.state], { variant: 'heading' }),
    ...(status.state === 'printing'
      ? [
          stat('progress', status.percent === null ? DASH : String(status.percent), {
            unitKey: 'percent',
          }),
        ]
      : []),
  ]);
};

export const homeScreen = (state: State): UiScreen => {
  const status = state.status;
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    ...(state.connection.ok ? headline(state) : notConnected(state)),
    // Nothing here moves on a timer the user can see: the plugin pushes an
    // invalidation when something changes, and an idle printer changes nothing
    // for hours. So the page says how old the reading is and offers to ask
    // again — a screen that cannot be refreshed reads as a broken screen.
    freshness(status.at),
    button('refreshNow', { action: 'refreshNow' }, { variant: 'secondary' }),
    divider(),
    heading('stateLabel'),
    detail([
      { labelKey: 'stateLabel', value: { key: STATE_KEY[status.state] } },
      { labelKey: 'job', value: status.job ?? DASH },
      { labelKey: 'remaining', value: withUnit('minutesValue', status.remainingMinutes) },
      { labelKey: 'layer', value: layerValue(status.layer, status.totalLayers) },
      { labelKey: 'nozzle', value: withUnit('celsiusValue', status.nozzleTempC) },
      { labelKey: 'bed', value: withUnit('celsiusValue', status.bedTempC) },
    ]),
    divider(),
    heading('logTitle'),
    table({
      columns: [
        { key: 'job', labelKey: 'colJob' },
        { key: 'outcome', labelKey: 'colOutcome' },
        { key: 'duration', labelKey: 'colDuration', align: 'right' },
        { key: 'ended', labelKey: 'colEnded', align: 'right' },
      ],
      rows: state.log.map((entry) => ({
        cells: {
          job: { text: entry.job },
          outcome: {
            badge:
              entry.outcome === 'finished'
                ? { text: { key: 'stateFinished' }, tone: 'success' }
                : { text: { key: 'stateFailed' }, tone: 'danger' },
          },
          // The duration was already recorded and never shown, though it is
          // the one number a print log gets consulted for.
          duration: {
            text: withUnit(
              'minutesValue',
              entry.startedAt
                ? Math.max(
                    0,
                    Math.round(
                      (new Date(entry.endedAt).getTime() -
                        new Date(entry.startedAt).getTime()) /
                        60_000,
                    ),
                  )
                : null,
            ),
          },
          // ISO minutes, deliberately: the plugin knows neither the reader's
          // timezone nor their locale, and a guessed format is worse than an
          // unambiguous one.
          ended: { text: entry.endedAt.slice(0, 16).replace('T', ' ') },
        },
      })),
      emptyKey: 'logEmpty',
    }),
  ]);
};
