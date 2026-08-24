// Render handlers: one function per screen the manifest declares.
//
// Screens stay pure — state in, tree out — so they are readable on their own
// and trivially testable without a running core.

import {
  screen,
  paragraph,
  heading,
  stat,
  divider,
  table,
  form,
} from '@makekeeper/plugin-sdk';
import type { UiScreen } from '@makekeeper/plugin-contract';
import { batchesOf, daysLeft, type State } from './state.ts';

const SOON_DAYS = 30;

export const homeScreen = (state: State, scopeId: string): UiScreen => {
  const batches = batchesOf(state, scopeId);
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    stat(
      'expiring',
      String(batches.filter((b) => daysLeft(b.expiresOn) <= SOON_DAYS).length),
    ),
    divider(),
    heading('expiring'),
    table({
      columns: [
        { key: 'label', labelKey: 'colLabel' },
        { key: 'days', labelKey: 'colDays', align: 'right' },
      ],
      rows: batches.map((batch) => ({
        cells: {
          // An ORef cell renders as an in-app link to the inventory item.
          label: { text: batch.label, ref: batch.itemRef },
          days: { text: String(daysLeft(batch.expiresOn)) },
        },
      })),
      emptyKey: 'none',
    }),
    form({
      fields: [
        { name: 'label', type: 'text', labelKey: 'fieldLabel', required: true },
        { name: 'expiresOn', type: 'date', labelKey: 'fieldDate', required: true },
      ],
      submitKey: 'add',
      onSubmit: { action: 'add' },
    }),
  ]);
};

export const widgetScreen = (state: State, scopeId: string): UiScreen => {
  const soon = batchesOf(state, scopeId).filter(
    (b) => daysLeft(b.expiresOn) <= SOON_DAYS,
  );
  return screen('widget', [stat('expiring', String(soon.length))]);
};
