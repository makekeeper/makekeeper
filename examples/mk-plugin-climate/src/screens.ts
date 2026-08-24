import {
  screen,
  paragraph,
  heading,
  stat,
  divider,
  table,
  form,
  callout,
} from '@makekeeper/plugin-sdk';
import type { CoreClient } from '@makekeeper/plugin-sdk';
import type { UiScreen } from '@makekeeper/plugin-contract';
import { PROFILES } from './profiles.ts';
import { isOutOfSpec, latestReading, type State } from './state.ts';

interface CoreStorage {
  id: string;
  name: string;
  ref: string;
}

// The storage picker is built from the CORE's own list — the plugin keeps no
// copy, so a renamed or deleted storage cannot go stale here.
const loadStorages = async (core: CoreClient): Promise<CoreStorage[]> => {
  try {
    return await core.invoke<CoreStorage[]>('list_storages');
  } catch {
    // Degrade to "no linking" rather than failing the screen: the readings are
    // still the point.
    return [];
  }
};

export const widgetScreen = (state: State): UiScreen => {
  const alerting = state.spots.filter(isOutOfSpec);
  return screen('widget', [
    alerting.length > 0
      ? callout('alert', 'danger')
      : callout('okAll', 'success'),
    stat('colSpot', String(state.spots.length)),
  ]);
};

export const homeScreen = async (
  state: State,
  core: CoreClient,
): Promise<UiScreen> => {
  const alerting = state.spots.filter(isOutOfSpec);
  const storages = await loadStorages(core);

  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    alerting.length > 0
      ? callout('alert', 'danger')
      : callout('okAll', 'success'),
    state.lastPollError
      ? callout('pollFailed', 'warning')
      : paragraph('lastPoll', {
          params: { at: state.lastPollAt ?? '—' },
          variant: 'muted',
        }),
    divider(),
    heading('colSpot'),
    table({
      columns: [
        { key: 'spot', labelKey: 'colSpot' },
        { key: 'temp', labelKey: 'colTemp', align: 'right' },
        { key: 'humidity', labelKey: 'colHumidity', align: 'right' },
        { key: 'state', labelKey: 'colState' },
      ],
      rows: state.spots.map((spot) => {
        const reading = latestReading(spot);
        const alert = isOutOfSpec(spot);
        return {
          cells: {
            // The spot links to its storage: one click from "the cupboard is
            // damp" to the cupboard's contents.
            spot: { text: spot.label, ref: spot.storageRef },
            temp: {
              text:
                reading?.temp !== null && reading?.temp !== undefined
                  ? `${reading.temp} °C`
                  : '—',
            },
            humidity: {
              text:
                reading?.humidity !== null && reading?.humidity !== undefined
                  ? `${reading.humidity} %`
                  : '—',
            },
            state: {
              badge: reading
                ? alert
                  ? { text: { key: 'stateAlert' }, tone: 'danger' }
                  : { text: { key: 'stateOk' }, tone: 'success' }
                : { text: { key: 'stateStale' }, tone: 'neutral' },
            },
          },
          onClick: { action: 'remove', params: { id: spot.id } },
        };
      }),
      emptyKey: 'noSpots',
    }),
    divider(),
    heading('addSpot'),
    form({
      fields: [
        { name: 'label', type: 'text', labelKey: 'fieldLabel', required: true },
        {
          name: 'storageRef',
          type: 'select',
          labelKey: 'fieldStorage',
          options: [
            { value: '', label: { key: 'storageNone' } },
            ...storages.map((storage) => ({
              value: storage.ref,
              // A storage NAME is user data, not translatable text: it travels
              // as a parameter of a key rather than as a literal.
              label: { key: 'fieldStorage', params: { name: storage.name } },
            })),
          ],
        },
        {
          name: 'profile',
          type: 'select',
          labelKey: 'fieldProfile',
          value: 'pla',
          options: Object.entries(PROFILES).map(([id, profile]) => ({
            value: id,
            label: { key: profile.labelKey },
          })),
        },
        { name: 'haTemp', type: 'text', labelKey: 'fieldHaTemp' },
        { name: 'haHumidity', type: 'text', labelKey: 'fieldHaHumidity' },
      ],
      submitKey: 'addSpot',
      onSubmit: { action: 'add' },
    }),
  ]);
};
