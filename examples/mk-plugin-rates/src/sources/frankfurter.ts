// Frankfurter v2 — the whole ISO set, with history.
//
// Worth stating, because the v1 shape is still all over the internet and it is
// a different service in practice:
//
//   v1 (api.frankfurter.dev/v1, api.frankfurter.app) — the ECB's daily
//     reference rates. Thirty currencies. No RUB since 2022, no UAH, no RSD.
//   v2 (api.frankfurter.dev/v2) — 165 currencies, dated the same way, and
//     still free and keyless.
//
// The response shape changed with it: v1 returned one object with a `rates`
// map, v2 returns one ROW PER QUOTE. Parsing v2 as if it were v1 yields an
// empty table rather than an error, which is the kind of failure that reaches
// production.

import type { Snapshot } from '../state.ts';

const API = process.env['RATES_API'] ?? 'https://api.frankfurter.dev/v2';
const FETCH_TIMEOUT_MS = 15_000;

interface RateRow {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
}

interface CurrencyRow {
  iso_code?: string;
  name?: string;
}

const call = async <T>(path: string): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`rates API ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

// `date` omitted ⇒ the latest published day. A dated request returns that
// day's rates, which is what makes a past purchase reconcile.
export const fetchSnapshot = async (
  base: string,
  date?: string,
): Promise<Snapshot> => {
  const query = new URLSearchParams({ base });
  if (date) query.set('date', date);
  const rows = await call<RateRow[]>(`/rates?${query.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('malformed rates payload');
  }
  const rates: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.quote === 'string' && typeof row.rate === 'number') {
      rates[row.quote] = row.rate;
    }
  }
  if (Object.keys(rates).length === 0) throw new Error('no rates in payload');
  return {
    // The business day the rates belong to — NOT when they were fetched.
    date: rows[0]?.date ?? new Date().toISOString().slice(0, 10),
    base: rows[0]?.base ?? base,
    rates,
    fetchedAt: new Date().toISOString(),
  };
};

// Code → name, for the base-currency picker. Names are the API's own, in
// English: they are data about currencies, not our interface text, and
// inventing translations for 165 of them would be worse than showing the
// canonical name next to the ISO code.
export const fetchCurrencyNames = async (): Promise<Record<string, string>> => {
  const rows = await call<CurrencyRow[]>('/currencies');
  const names: Record<string, string> = {};
  for (const row of rows ?? []) {
    if (typeof row.iso_code === 'string' && typeof row.name === 'string') {
      names[row.iso_code] = row.name;
    }
  }
  return names;
};
