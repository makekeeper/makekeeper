import {
  screen,
  paragraph,
  heading,
  stat,
  divider,
  table,
  callout,
} from '@makekeeper/plugin-sdk';
import type { UiScreen } from '@makekeeper/plugin-contract';
import type { State } from './state.ts';

// Renders from the snapshot the scheduler already produced — never from a live
// cross-scope query. That is what keeps the 5s screen budget comfortable no
// matter how big the instance gets.

export const homeScreen = (state: State): UiScreen => {
  const snapshot = state.latest;
  if (!snapshot) {
    return screen('title', [callout('pending', 'warning')]);
  }
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    stat('scopes', String(snapshot.scopeCount)),
    paragraph('takenAt', {
      params: { date: snapshot.takenAt },
      variant: 'muted',
    }),
    divider(),
    heading('series'),
    table({
      columns: [
        { key: 'date', labelKey: 'colDate' },
        { key: 'value', labelKey: 'colValue', align: 'right' },
      ],
      rows: snapshot.points.map((point) => ({
        cells: {
          date: { text: point.date },
          value: { text: String(point.value) },
        },
      })),
    }),
  ]);
};

export const widgetScreen = (state: State): UiScreen => {
  const snapshot = state.latest;
  if (!snapshot) return screen('name', [callout('pending', 'warning')]);
  const total = snapshot.points.reduce((sum, p) => sum + p.value, 0);
  return screen('name', [stat('series', String(total))]);
};
