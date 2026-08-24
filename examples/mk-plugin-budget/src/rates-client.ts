// Everything this plugin knows about the OTHER plugin (#145).
//
// Isolated deliberately: a capability call can fail for reasons a consumer
// cannot distinguish and should not try to — the offerer is not installed, is
// disabled, or errored. All three mean the same thing here ("the feature isn't
// there"), so this module turns every one of them into `null` and the screens
// simply do without.
//
// That degradation is why capabilities resolve to null rather than throwing: a
// plugin that depends on another must still work alone.

import type { CoreClient } from '@makekeeper/plugin-sdk';

const CAPABILITY = 'rates.convert';
// Used only until the offerer answers once — the real list comes from IT,
// because the ECB set changes (RUB was dropped in 2022) and a hardcoded picker
// eventually offers a currency that silently fails to convert.
const FALLBACK_CURRENCIES = ['EUR', 'USD', 'GBP'];

export const targetCurrency = process.env['BUDGET_BASE'] ?? 'EUR';

export const listCurrencies = async (core: CoreClient): Promise<string[]> => {
  try {
    const codes = await core.capability<string[] | null>(
      CAPABILITY,
      'currencies',
      [],
    );
    return Array.isArray(codes) && codes.length > 0 ? codes : FALLBACK_CURRENCIES;
  } catch {
    return FALLBACK_CURRENCIES;
  }
};

// One call per distinct currency, not per entry: the render budget is 5s and
// each call is a network hop through the core into another container.
export const ratesFor = async (
  core: CoreClient,
  currencies: string[],
): Promise<Map<string, number | null>> => {
  const rates = new Map<string, number | null>();
  for (const currency of currencies) {
    try {
      const rate = await core.capability<number | null>(CAPABILITY, 'convert', [
        1,
        currency,
        targetCurrency,
      ]);
      rates.set(currency, typeof rate === 'number' ? rate : null);
    } catch {
      rates.set(currency, null);
    }
  }
  return rates;
};
