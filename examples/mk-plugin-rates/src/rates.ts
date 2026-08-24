// The domain: fetching, caching and converting ECB reference rates.
//
// Availability policy worth copying: a rate a few hours stale is vastly better
// than an error, so the cache is served whenever the API is unreachable and
// the screen says how old it is rather than pretending everything is fine.

import {
  nextRunAfter,
  saveState,
  type Snapshot,
  type State,
} from './state.ts';
import { fetchCurrencyNames, fetchSnapshot } from './sources/frankfurter.ts';
// The ECB publishes once per working day around 16:00 CET; every six hours is
// generous and still polite to a free service.
const fetchRates = (state: State, day?: string): Promise<Snapshot> =>
  fetchSnapshot(state.schedule.base, day);

export const refresh = async (state: State): Promise<void> => {
  try {
    state.latest = await fetchRates(state);
    delete state.lastError;
    // Names come along on the first successful refresh and then stay: the
    // picker needs them and they change about never.
    if (!state.currencyNames) {
      state.currencyNames = await fetchCurrencyNames().catch(() => undefined);
    }
  } catch (err: unknown) {
    // Keep the previous snapshot. A stale rate still converts; an exception
    // would take out every consumer's screen with it.
    state.lastError = err instanceof Error ? err.message : String(err);
  }
  await saveState(state);
};

// Once a day, at the time the admin set, plus a short retry when an attempt
// fails — a plugin that missed its slot should not serve nothing until
// tomorrow.
//
// Self-rescheduling rather than a fixed interval, so a change to the time
// applies from the next run without a restart.
const RETRY_MS = Number(process.env['RATES_RETRY_MS'] ?? 5 * 60 * 1000);

export const startRefreshing = (state: State): void => {
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    if (!state.schedule.autoRefresh) return;
    const due = state.lastError
      ? Date.now() + RETRY_MS
      : nextRunAfter(new Date(), state.schedule.dailyAt).getTime();
    timer = setTimeout(
      () => void refresh(state).finally(arm),
      Math.max(1_000, due - Date.now()),
    );
    // The timer must not be what keeps the process alive — the server is.
    timer.unref?.();
  };
  // The first fetch happens whichever way automatic updates are set: a plugin
  // serving no rates at all is not a useful "off" state.
  void refresh(state).finally(arm);
  rearm = arm;
};

// Set by startRefreshing; a no-op before that, which is the right behaviour
// for a settings save arriving during boot.
let rearm: () => void = () => undefined;

export const applySchedule = (): void => rearm();

// When the next automatic update is due, for the screen to state plainly.
export const nextRefreshAt = (state: State): string | null =>
  state.schedule.autoRefresh
    ? nextRunAfter(new Date(), state.schedule.dailyAt).toISOString()
    : null;

// Rates are quoted against one base, so a cross rate goes through it. The base
// itself is not in the table (it is 1 by definition).
const rateOf = (snapshot: Snapshot, code: string): number | null => {
  if (code === snapshot.base) return 1;
  const rate = snapshot.rates[code];
  return typeof rate === 'number' ? rate : null;
};

// Deliberately UNROUNDED. A consumer often converts one unit to obtain a rate
// and then scales it — rounding here to two decimals turns that into visible
// money errors. Rounding is a presentation decision and belongs to whoever
// displays the number.
export const convert = (
  snapshot: Snapshot,
  amount: number,
  from: string,
  to: string,
): number | null => {
  const fromRate = rateOf(snapshot, from);
  const toRate = rateOf(snapshot, to);
  if (fromRate === null || toRate === null || !Number.isFinite(amount)) {
    return null;
  }
  return (amount / fromRate) * toRate;
};

export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

// A dated conversion uses the rate of THAT day, which is what makes a past
// purchase reconcile. Days are cached because the ECB never revises them.
export const snapshotFor = async (
  state: State,
  date?: string,
): Promise<Snapshot | null> => {
  if (!date) return state.latest;
  const cached = state.history[date];
  if (cached) return cached;
  try {
    const snapshot = await fetchRates(state, date);
    state.history[date] = snapshot;
    await saveState(state);
    return snapshot;
  } catch {
    return state.latest;
  }
};

// Which currencies this plugin can actually convert. Consumers ask for this
// instead of hardcoding a list: the set is whatever the API publishes today
// (165 with Frankfurter v2, thirty with the old v1 ECB endpoint), so a
// hardcoded picker eventually offers something that silently fails.
export const supportedCurrencies = (state: State): string[] => {
  if (!state.latest) return [];
  // Deduplicated: whether the base appears in the table too is the API's
  // business and it varies — v2 with base=EUR returns a EUR row at 1.0. A
  // repeated code produced a picker with the same currency listed twice, and
  // duplicate keys in a list are how one duplicate becomes several.
  return [
    ...new Set([state.latest.base, ...Object.keys(state.latest.rates)]),
  ].sort();
};

export const ageHours = (snapshot: Snapshot): number =>
  Math.floor((Date.now() - new Date(snapshot.fetchedAt).getTime()) / 3_600_000);
