import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import CopyField from './CopyField.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { copy: 'Copy' } } },
});

const TOKEN = 'mkt_0123456789abcdef0123456789abcdef';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

const mountField = () =>
  mount(CopyField, {
    props: { value: TOKEN, ariaLabel: 'Connection token' },
    global: { plugins: [i18n] },
  });

describe('CopyField', () => {
  it('copies the whole value on a click anywhere on the row', async () => {
    const wrapper = mountField();
    await wrapper.get('button').trigger('click');
    expect(writeText).toHaveBeenCalledWith(TOKEN);
    expect(wrapper.emitted('copied')).toHaveLength(1);
  });

  // The row is one line with an ellipsis; the text node still carries the
  // full value, so the clipboard and assistive tech never see the truncation.
  it('renders the value on a single truncated line', () => {
    const code = mountField().get('code');
    expect(code.classes()).toContain('truncate');
    expect(code.text()).toBe(TOKEN);
  });

  it('names itself for screen readers, falling back to the generic label', () => {
    expect(mountField().get('button').attributes('aria-label')).toBe(
      'Connection token',
    );
    const bare = mount(CopyField, {
      props: { value: TOKEN },
      global: { plugins: [i18n] },
    });
    expect(bare.get('button').attributes('aria-label')).toBe('Copy');
  });
});
