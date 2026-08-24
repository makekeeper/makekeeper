import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import Refreshable from './Refreshable.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { refreshing: 'Refreshing' } } },
});

const render = (props: Record<string, unknown>) =>
  mount(Refreshable, {
    props: { refreshing: false, ...props },
    slots: { default: '<p>the numbers</p>' },
    global: { plugins: [i18n] },
  });

describe('Refreshable', () => {
  it('renders its content untouched while idle', () => {
    const wrapper = render({});
    expect(wrapper.text()).toContain('the numbers');
    expect(wrapper.find('.blur-sm').exists()).toBe(false);
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false);
  });

  // The whole point: the content stays put and is dimmed, rather than being
  // swapped out for a spinner and back — which is what makes a section jump.
  it('keeps the content and dims it while refreshing', () => {
    const wrapper = render({ refreshing: true });
    expect(wrapper.text()).toContain('the numbers');
    expect(wrapper.find('.blur-sm').exists()).toBe(true);
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);
  });

  // A click must not land on a value that is about to change under it.
  it('stops the dimmed content from taking clicks', () => {
    const wrapper = render({ refreshing: true });
    expect(wrapper.find('.pointer-events-none').exists()).toBe(true);
  });

  it('announces itself', () => {
    expect(render({ refreshing: true }).html()).toContain(
      'aria-label="Refreshing"',
    );
  });

  // A long section's bottom can be off-screen, so the spinner sits at the top
  // where it stays in sight.
  it('keeps the spinner in sight at the top', () => {
    expect(render({ refreshing: true }).find('.items-start').exists()).toBe(
      true,
    );
  });
});
