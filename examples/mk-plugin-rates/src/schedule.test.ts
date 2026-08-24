import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSchedule, nextRunAfter, normalizeTime } from './state.ts';
import { convert, nextRefreshAt, supportedCurrencies } from './rates.ts';
import type { Snapshot, State } from './state.ts';

// The two things the admin now controls, and the one promise that depends on
// the choice: whether a dated conversion means anything.

const snapshot: Snapshot = {
  date: '2026-07-29',
  base: 'EUR',
  rates: { USD: 1.14, RUB: 89.42 },
  fetchedAt: '2026-07-29T12:00:00.000Z',
};

const state = (over: Partial<State['schedule']> = {}): State => ({
  version: 1,
  schedule: { ...defaultSchedule(), ...over },
  latest: snapshot,
  history: {},
});

test('a time that is not a time is a typo, not a schedule', () => {
  assert.equal(normalizeTime('7:5'), '15:00');
  assert.equal(normalizeTime('25:00'), '15:00');
  assert.equal(normalizeTime('12:60'), '15:00');
  assert.equal(normalizeTime(''), '15:00');
  assert.equal(normalizeTime('7:05'), '07:05');
  assert.equal(normalizeTime(' 23:59 '), '23:59');
});

test('the daily slot is today when it is still ahead, tomorrow once it passed', () => {
  const morning = new Date('2026-07-29T09:00:00.000Z');
  assert.equal(
    nextRunAfter(morning, '15:00').toISOString(),
    '2026-07-29T15:00:00.000Z',
  );
  const evening = new Date('2026-07-29T20:00:00.000Z');
  assert.equal(
    nextRunAfter(evening, '15:00').toISOString(),
    '2026-07-30T15:00:00.000Z',
  );
  // Exactly on the slot counts as passed: the run that is happening now is
  // not the next one.
  assert.equal(
    nextRunAfter(new Date('2026-07-29T15:00:00.000Z'), '15:00').toISOString(),
    '2026-07-30T15:00:00.000Z',
  );
});

test('with automatic updates off there is no next update to promise', () => {
  assert.equal(nextRefreshAt(state({ autoRefresh: false })), null);
});

test('the currency list comes from the data, base included', () => {
  // A hardcoded picker eventually offers something the service stopped
  // publishing, and that fails at conversion time rather than at pick time.
  assert.deepEqual(supportedCurrencies(state()), ['EUR', 'RUB', 'USD']);
});

test('conversion goes through the base and stays unrounded', () => {
  // 89.42 RUB per EUR, 1.14 USD per EUR → RUB→USD via the base.
  const value = convert(snapshot, 100, 'RUB', 'USD');
  assert.ok(value !== null);
  assert.ok(Math.abs(value! - (100 / 89.42) * 1.14) < 1e-12);
});
