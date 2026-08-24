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
import { listCurrencies, ratesFor, targetCurrency } from './rates-client.ts';
import type { State } from './state.ts';

export const homeScreen = async (
  state: State,
  core: CoreClient,
): Promise<UiScreen> => {
  const used = [...new Set(state.entries.map((e) => e.currency))];
  const rates = await ratesFor(core, used);
  // With nothing to convert, nothing failed: an empty ledger must not accuse
  // the rates plugin of being down.
  const ratesAvailable =
    used.length === 0 || [...rates.values()].some((v) => v !== null);

  const total = state.entries.reduce((sum, entry) => {
    const rate = rates.get(entry.currency);
    return rate === null || rate === undefined ? sum : sum + entry.amount * rate;
  }, 0);

  // The picker comes from the OFFERER, so it can never list a currency that
  // cannot actually be converted.
  const currencies = await listCurrencies(core);

  return screen('title', [
    paragraph('intro', { variant: 'muted' }),
    ratesAvailable
      ? stat('total', total.toFixed(2), { unitKey: 'colConverted' })
      : callout('noRates', 'warning'),
    divider(),
    heading('colWhat'),
    table({
      columns: [
        { key: 'what', labelKey: 'colWhat' },
        { key: 'amount', labelKey: 'colAmount', align: 'right' },
        { key: 'converted', labelKey: 'colConverted', align: 'right' },
      ],
      rows: state.entries.map((entry) => {
        const rate = rates.get(entry.currency);
        return {
          cells: {
            what: { text: entry.what },
            amount: { text: `${entry.amount} ${entry.currency}` },
            converted: {
              text:
                rate === null || rate === undefined
                  ? '—'
                  : `${(entry.amount * rate).toFixed(2)} ${targetCurrency}`,
            },
          },
        };
      }),
      emptyKey: 'none',
    }),
    form({
      fields: [
        { name: 'what', type: 'text', labelKey: 'fieldWhat', required: true },
        { name: 'amount', type: 'number', labelKey: 'fieldAmount', required: true },
        {
          name: 'currency',
          type: 'select',
          labelKey: 'fieldCurrency',
          value: targetCurrency,
          // A currency CODE is a technical identifier, not translatable text —
          // so it travels as a parameter of a key rather than as a literal.
          options: currencies.map((code) => ({
            value: code,
            label: { key: 'currencyOption', params: { code } },
          })),
        },
      ],
      submitKey: 'add',
      onSubmit: { action: 'add' },
    }),
  ]);
};
