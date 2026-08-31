import { useI18n } from 'vue-i18n';

// Dates written in the language the app is set to, not the one the browser was
// installed in.
//
// `Intl.DateTimeFormat(undefined, …)` and `toLocaleString()` both read the
// BROWSER's locale, which is a different setting from the app's: a Russian UI
// in a browser installed in English produced "Aug 29, 2026 at 2:45 AM" in the
// middle of Russian text. Passing the i18n locale is the whole fix, and it
// lives here so no call site has to remember it.
export interface DateFormatters {
  // "29 авг. 2026 г., 02:45" — a moment, spelled out.
  dateTime: (value: string | Date) => string;
  // "29 авг. 2026 г."
  date: (value: string | Date) => string;
  // "02:45"
  time: (value: string | Date) => string;
  // "29.08.2026, 02:45" — dense, for table cells and log rows.
  short: (value: string | Date) => string;
}

const asDate = (value: string | Date): Date =>
  value instanceof Date ? value : new Date(value);

export function useDateFormat(): DateFormatters {
  const { locale } = useI18n();
  const format = (
    value: string | Date,
    options: Intl.DateTimeFormatOptions,
  ): string =>
    // Read inside the call, not captured: switching the language re-renders
    // whatever called this, and a formatter built once would keep answering in
    // the old language.
    new Intl.DateTimeFormat(locale.value, options).format(asDate(value));

  return {
    dateTime: (value) =>
      format(value, { dateStyle: 'medium', timeStyle: 'short' }),
    date: (value) => format(value, { dateStyle: 'medium' }),
    time: (value) => format(value, { timeStyle: 'short' }),
    short: (value) => format(value, { dateStyle: 'short', timeStyle: 'short' }),
  };
}
