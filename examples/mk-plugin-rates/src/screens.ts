import {
  screen,
  paragraph,
  heading,
  divider,
  button,
  form,
  table,
  callout,
} from '@makekeeper/plugin-sdk';
import type { UiNode, UiScreen, UiText } from '@makekeeper/plugin-contract';
import { ageHours, nextRefreshAt, supportedCurrencies } from './rates.ts';
import type { State } from './state.ts';

// Rows per page. The core paginates and filters what it is given (contract
// 1.7) — instant, no round trip, and the same behaviour in every plugin's
// table instead of one hand-rolled filter per plugin.
const PAGE = 25;

export const homeScreen = (state: State): UiScreen => {
  const snapshot = state.latest;
  if (!snapshot) {
    return screen('title', [
      paragraph('intro', { variant: 'muted' }),
      callout('pending', 'warning'),
      // An empty screen with no way out of being empty is a dead end: the
      // update this is waiting for can be asked for right here.
      button('refreshNow', { action: 'refreshNow' }),
    ]);
  }

  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    state.lastError
      ? // Why it is stale, not merely that it is: the reason is what tells an
        // admin whether to wait or to go and look.
        callout('staleWhy', 'warning', { detail: state.lastError })
      : paragraph('asOf', {
          params: { date: snapshot.date, hours: ageHours(snapshot) },
          variant: 'muted',
        }),
    paragraph('using', {
      params: {
        count: Object.keys(snapshot.rates).length + 1,
        base: snapshot.base,
      },
      variant: 'muted',
    }),
    ...refreshLine(state),
    // The update button belongs where the numbers are: someone who doubts a
    // rate is looking at the table, not at the settings.
    button('refreshNow', { action: 'refreshNow' }, { variant: 'secondary' }),
    divider(),
    heading('table', { base: snapshot.base }),
    table({
      // Everything, and the core makes it navigable.
      filterable: true,
      pageSize: PAGE,
      // Sortable in both directions; the core holds every row here, so it
      // sorts them itself and the rate column compares as numbers.
      columns: [
        { key: 'code', labelKey: 'colCode', sortable: true },
        { key: 'name', labelKey: 'colName', sortable: true },
        { key: 'rate', labelKey: 'colRate', align: 'right', sortable: true },
      ],
      rows: Object.entries(snapshot.rates)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, rate]) => ({
        cells: {
          code: { text: code },
          name: { text: state.currencyNames?.[code] ?? '' },
          rate: { text: String(rate) },
        },
      })),
      emptyKey: 'tableEmpty',
    }),
  ]);
};

// What the schedule is doing, said on the screen that shows the numbers: a
// table of rates with no word about their age invites the reader to assume
// they are current.
const refreshLine = (state: State): UiNode[] => {
  if (!state.schedule.autoRefresh) return [paragraph('autoOff', { variant: 'muted' })];
  const next = nextRefreshAt(state);
  return [
    paragraph('autoOn', {
      params: { at: state.schedule.dailyAt },
      variant: 'muted',
    }),
    // In HOURS, not as a timestamp: the plugin knows neither the reader's
    // timezone nor their locale, and "in 4 h" needs neither.
    ...(next
      ? [
          paragraph('nextIn', {
            params: {
              hours: Math.max(
                0,
                Math.round((new Date(next).getTime() - Date.now()) / 3_600_000),
              ),
            },
            variant: 'muted',
          }),
        ]
      : []),
  ];
};

// Codes with their English names — the API's own, because they are data about
// currencies rather than our interface text, and inventing translations for
// 165 of them would be worse than showing the canonical name.
const baseOptions = (state: State): Array<{ value: string; label: UiText }> => {
  const names = state.currencyNames ?? {};
  const codes = supportedCurrencies(state);
  const list = codes.length > 0 ? codes : [state.schedule.base];
  return list.map((code) => {
    const name = names[code];
    // Only the params the chosen key actually uses: a spare one means the two
    // branches drifted, and the i18n guard treats it as such.
    const label: UiText = name
      ? { key: 'currencyOption', params: { code, name } }
      : { key: 'currencyOptionBare', params: { code } };
    return { value: code, label };
  });
};

// The schedule, in the plugin's card. Two questions and nothing else: whether
// to refresh on its own, and how often.
export const settingsScreen = (
  state: State,
  pending?: Record<string, string | number | boolean>,
): UiScreen => {
  // What the user has toggled but not saved. Asking "how often" under a switch
  // that is off is asking a question with no answer.
  const auto = pending?.['autoRefresh'] ?? state.schedule.autoRefresh;
  return screen('settingsTitle', [
    paragraph('settingsIntro', { variant: 'muted' }),
    form({
      fields: [
        {
          name: 'base',
          type: 'select',
          labelKey: 'fieldBase',
          value: state.schedule.base,
          hintKey: 'fieldBaseHint',
          // Built from what the API actually publishes, never a hardcoded
          // list: the set changes, and a picker offering a currency the
          // service dropped fails silently at conversion time.
          options: baseOptions(state),
        },
        {
          name: 'autoRefresh',
          type: 'switch',
          labelKey: 'fieldAuto',
          value: auto === true,
          width: 'half',
          hintKey: 'fieldAutoHint',
          reloadOnChange: true,
        },
        ...(auto === true
          ? [
              {
                name: 'dailyAt',
                // Contract 1.7: a time of day, because that is what a person
                // sets. "Every N hours" made the next update unpredictable.
                type: 'time' as const,
                labelKey: 'fieldDailyAt',
                value: state.schedule.dailyAt,
                width: 'half' as const,
                hintKey: 'fieldDailyAtHint',
              },
            ]
          : []),
      ],
      submitKey: 'save',
      onSubmit: { action: 'saveSchedule' },
    }),
    // No update button here: it lives on the screen with the numbers, where
    // the doubt about a rate actually arises. Two of them in two places is one
    // button too many.

    ...(state.lastError
      ? [callout('lastErrorLine', 'danger', { detail: state.lastError })]
      : []),
  ]);
};
