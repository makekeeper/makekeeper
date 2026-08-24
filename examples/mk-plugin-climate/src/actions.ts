import { commands, refresh, toast } from '@makekeeper/plugin-sdk';
import type { UiActionResult } from '@makekeeper/plugin-contract';
import { saveState, type State } from './state.ts';

export const addSpot = async (
  state: State,
  values: Record<string, string | number | boolean>,
): Promise<UiActionResult> => {
  const label = String(values['label'] ?? '').trim();
  if (!label) return commands(toast('error', 'noSpots'));
  state.spots.push({
    id: `${Date.now()}`,
    label,
    profile: String(values['profile'] ?? 'generic'),
    storageRef: String(values['storageRef'] ?? '') || undefined,
    haTempEntity: String(values['haTemp'] ?? '') || undefined,
    haHumidityEntity: String(values['haHumidity'] ?? '') || undefined,
    readings: [],
  });
  await saveState(state);
  return commands(refresh({ tone: 'success', key: 'added', params: { label } }));
};

export const removeSpot = async (
  state: State,
  id: string,
): Promise<UiActionResult> => {
  state.spots = state.spots.filter((spot) => spot.id !== id);
  await saveState(state);
  return commands(refresh({ tone: 'success', key: 'removed' }));
};
