import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import LanguageSelect from './LanguageSelect.vue';
import { LOCALE_STORAGE_KEY } from '../i18n';

// The picker exists twice on screen — header and consent dialog (#343) — from
// one component. What is worth guarding is the pair that a second hand-rolled
// copy would get wrong: a choice must both apply now AND survive a reload, and
// the trigger must follow a language changed by the other copy.
const messages = {
  en: { header: { language: 'Language' }, common: { search: 'Search' } },
  ru: { header: { language: 'Язык' }, common: { search: 'Поиск' } },
};

let wrapper: VueWrapper | null = null;

const mountPicker = () => {
  const i18n = createI18n({ legacy: false, locale: 'en', messages });
  wrapper = mount(LanguageSelect, { global: { plugins: [i18n] } });
  return { wrapper, i18n };
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('LanguageSelect', () => {
  it('shows the active language as its own tag', () => {
    const { wrapper: w } = mountPicker();
    expect(w.text()).toContain('EN');
  });

  it('applies a chosen language and persists it', async () => {
    const { wrapper: w, i18n } = mountPicker();

    await w.findComponent({ name: 'Select' }).vm.$emit('change', 'ru');

    expect(i18n.global.locale.value).toBe('ru');
    // The half a second copy forgets: without this the language lasts until the
    // next reload and then silently reverts.
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
  });

  it('ignores a language we do not ship', async () => {
    const { wrapper: w, i18n } = mountPicker();

    await w.findComponent({ name: 'Select' }).vm.$emit('change', 'de');

    expect(i18n.global.locale.value).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('follows a language changed elsewhere', async () => {
    const { wrapper: w, i18n } = mountPicker();

    i18n.global.locale.value = 'ru';
    await w.vm.$nextTick();

    expect(w.text()).toContain('RU');
  });
});
