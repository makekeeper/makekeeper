import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import TimePicker from './TimePicker.vue';

// The picker follows the APP's language, not the browser's. That is the whole
// reason it exists: `<input type="time">` reads the machine's locale, so a
// Russian interface on a US laptop offered AM/PM and an English one in Europe
// did not.

const i18n = (locale: string) =>
  createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: {
      en: {
        common: {
          time: 'Time',
          hours: 'Hours',
          minutes: 'Minutes',
          select: '…',
          nothingFound: '—',
          search: 'Search',
        },
      },
      ru: {
        common: {
          time: 'Время',
          hours: 'Часы',
          minutes: 'Минуты',
          select: '…',
          nothingFound: '—',
          search: 'Поиск',
        },
      },
    },
  });

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

const mountAt = (locale: string, modelValue = '15:30'): VueWrapper => {
  wrapper = mount(TimePicker, {
    props: { modelValue },
    global: { plugins: [i18n(locale)] },
    attachTo: document.body,
  });
  return wrapper;
};

const triggers = (w: VueWrapper): string[] =>
  w.findAll('button').map((b) => b.text().trim());

describe('TimePicker', () => {
  it('is 24-hour in Russian: two selects, no meridiem', () => {
    const w = mountAt('ru');
    const labels = triggers(w);
    expect(labels.length).toBe(2);
    expect(labels[0]).toBe('15');
    expect(labels[1]).toBe('30');
  });

  it('is 12-hour in US English: three selects, with a day period', () => {
    const w = mountAt('en-US');
    const labels = triggers(w);
    expect(labels.length).toBe(3);
    expect(labels[0]).toBe('3');
    expect(labels[1]).toBe('30');
    expect(labels[2]).toMatch(/PM/i);
  });

  it('emits the canonical 24-hour value whatever it displays', async () => {
    const w = mountAt('en-US', '09:00');
    // Switching to the afternoon must produce 21:00, not "9 PM".
    const meridiem = w.findAllComponents({ name: 'Select' })[2];
    meridiem.vm.$emit('update:modelValue', 'pm');
    await w.vm.$nextTick();
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['21:00']);
  });

  it('keeps a value that sits between the offered minutes', () => {
    // A schedule set to 15:37 elsewhere must not be silently snapped to 15:35.
    const w = mountAt('ru', '15:37');
    expect(triggers(w)[1]).toBe('37');
  });

  it('does not put a search box in front of twenty-four hours', async () => {
    const w = mountAt('ru');
    await w.findAll('button')[0]!.trigger('click');
    await w.vm.$nextTick();
    expect(document.querySelector('[role="listbox"] input')).toBeNull();
  });

  it('survives a locale it cannot read', () => {
    // Intl resolves an unknown tag to its own default rather than throwing —
    // what matters is that the picker still renders and still speaks in
    // canonical values.
    const w = mountAt('xx-nonsense', '15:30');
    expect(triggers(w).length).toBeGreaterThanOrEqual(2);
    expect(triggers(w)).toContain('30');
  });
});
