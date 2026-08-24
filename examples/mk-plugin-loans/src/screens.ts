import {
  screen,
  paragraph,
  heading,
  stat,
  divider,
  list,
  form,
} from '@makekeeper/plugin-sdk';
import type { UiScreen } from '@makekeeper/plugin-contract';
import { loansOf, type State } from './state.ts';

// Every read is scoped — there is no unscoped accessor to reach for.

export const homeScreen = (state: State, scopeId: string): UiScreen => {
  const loans = loansOf(state, scopeId);
  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    stat('count', String(loans.length)),
    divider(),
    heading('count'),
    list({
      items: loans.map((loan) => ({
        title: loan.what,
        subtitle: loan.toWhom,
        onClick: { action: 'return', params: { id: loan.id } },
      })),
      emptyKey: 'none',
    }),
    form({
      fields: [
        { name: 'what', type: 'text', labelKey: 'fieldWhat', required: true },
        { name: 'who', type: 'text', labelKey: 'fieldWho', required: true },
      ],
      submitKey: 'add',
      onSubmit: { action: 'add' },
    }),
  ]);
};

export const widgetScreen = (state: State, scopeId: string): UiScreen =>
  screen('count', [stat('count', String(loansOf(state, scopeId).length))]);
