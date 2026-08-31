import { ref } from 'vue';
import { useDateFormat } from './use-date-format';

const locale = ref('en');
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale }) }));

describe('useDateFormat', () => {
  const moment = '2026-08-29T02:45:00.000Z';

  it('writes the date in the app language, not the browser one', () => {
    locale.value = 'ru';
    const ru = useDateFormat().dateTime(moment);
    locale.value = 'en';
    const en = useDateFormat().dateTime(moment);
    expect(ru).not.toEqual(en);
    expect(ru).toMatch(/авг/);
  });

  it('follows a language change without being rebuilt', () => {
    locale.value = 'en';
    const dates = useDateFormat();
    const before = dates.date(moment);
    locale.value = 'ru';
    expect(dates.date(moment)).not.toEqual(before);
  });

  it('takes a Date as readily as an ISO string', () => {
    locale.value = 'en';
    const dates = useDateFormat();
    expect(dates.time(new Date(moment))).toEqual(dates.time(moment));
  });
});
