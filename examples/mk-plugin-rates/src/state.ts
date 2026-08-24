import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'rates.json');

export interface Snapshot {
  // The ECB business day the rates belong to — NOT when they were fetched.
  date: string;
  base: string;
  rates: Record<string, number>;
  fetchedAt: string;
}

// The schedule, owned by the admin rather than by the container's environment.
// A workshop that converts a purchase once a month does not need six-hourly
// polling of a free service, and one that invoices daily may want it hourly.
export interface Schedule {
  autoRefresh: boolean;
  // Once a day, at a time the admin picks, in UTC. "Every N hours" from an
  // unstated starting point meant updates wandered around the clock and
  // nobody could say when the next one was — a schedule you cannot plan
  // around is not a schedule.
  //
  // UTC because the container's clock is not the reader's, and the ECB
  // publishes around 14:00 UTC — so a default just after it is the useful one.
  dailyAt: string;
  // Rates are quoted AGAINST a base, so this is not cosmetic: every number in
  // the table and every conversion goes through it. A workshop that buys in
  // dollars reads a USD-based table without doing arithmetic in its head.
  base: string;
}

// The ECB publishes once per working day around 16:00 CET, so six hours is
// generous already; the environment variables stay as defaults for a headless
// install.
export const defaultSchedule = (): Schedule => ({
  autoRefresh: (process.env['RATES_AUTO'] ?? 'true') !== 'false',
  dailyAt: normalizeTime(process.env['RATES_DAILY_AT'] ?? '15:00'),
  base: normalizeCode(process.env['RATES_BASE'] ?? 'EUR'),
});

// `HH:MM`, 24-hour. Anything else is a typo, and a typo here would silently
// mean "never".
export function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return '15:00';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '15:00';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// When the next daily run is due, from a given moment. Today's slot if it is
// still ahead, tomorrow's otherwise.
export function nextRunAfter(from: Date, dailyAt: string): Date {
  const [hours, minutes] = normalizeTime(dailyAt).split(':').map(Number);
  const next = new Date(from);
  next.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

// A currency code is three letters, upper case. Anything else is a typo, and a
// typo sent as `base` returns an error page instead of rates.
export function normalizeCode(value: string): string {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'EUR';
}


export interface State {
  version: 1;
  schedule: Schedule;
  latest: Snapshot | null;
  // Code → English name, from the API. Cached because it changes about never
  // and a picker of 165 codes without names is a wall of letters.
  currencyNames?: Record<string, string>;
  // Historical days already looked up, so a repeated conversion of an old
  // purchase does not hit the API again.
  history: Record<string, Snapshot>;
  lastError?: string;
  secret?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
    // A state file written before the schedule existed has none; fill it from
    // the environment rather than leaving the plugin unschedulable.
    return {
      ...stored,
      schedule: { ...defaultSchedule(), ...(stored.schedule ?? {}) },
    };
  } catch {
    return {
      version: 1,
      schedule: defaultSchedule(),
      latest: null,
      history: {},
    };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};
