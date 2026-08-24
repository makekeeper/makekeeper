import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { profileOf } from './profiles.ts';

const STATE_DIR = process.env['MK_STATE_DIR'] ?? '.';
const STATE_FILE = join(STATE_DIR, 'climate.json');
// Bounded history: this plugin is a monitor, not an archive. A workshop that
// wants long-term series already has Home Assistant for that.
const HISTORY_PER_SPOT = 48;

export interface Reading {
  at: string;
  temp: number | null;
  humidity: number | null;
}

export interface Spot {
  id: string;
  label: string;
  profile: string;
  // ORef of the storage this sensor watches, when the user bound one.
  storageRef?: string;
  // PULL source: Home Assistant entity ids. PUSH source: the sensor posts
  // using this spot's name or id, so no entity is configured.
  haTempEntity?: string;
  haHumidityEntity?: string;
  readings: Reading[];
}

export interface State {
  version: 1;
  spots: Spot[];
  secret?: string;
  lastPollAt?: string;
  lastPollError?: string;
}

export const loadState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { version: 1, spots: [] };
  }
};

export const saveState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};

export const latestReading = (spot: Spot): Reading | null =>
  spot.readings.length > 0 ? spot.readings[spot.readings.length - 1] : null;

// A spot is out of spec when its newest reading breaches its profile. No
// hysteresis and no averaging on purpose: a storage cupboard is slow, and a
// reading out of range for one poll is worth seeing.
export const isOutOfSpec = (spot: Spot): boolean => {
  const reading = latestReading(spot);
  if (!reading) return false;
  const profile = profileOf(spot.profile);
  if (reading.humidity !== null && reading.humidity > profile.maxHumidity) {
    return true;
  }
  return (
    reading.temp !== null &&
    (reading.temp < profile.minTemp || reading.temp > profile.maxTemp)
  );
};

export const recordReading = (
  spot: Spot,
  temp: number | null,
  humidity: number | null,
): void => {
  spot.readings.push({ at: new Date().toISOString(), temp, humidity });
  if (spot.readings.length > HISTORY_PER_SPOT) {
    spot.readings.splice(0, spot.readings.length - HISTORY_PER_SPOT);
  }
};

export const findSpot = (state: State, key: string): Spot | undefined =>
  state.spots.find((spot) => spot.id === key || spot.label === key);
