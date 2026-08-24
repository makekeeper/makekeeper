import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Switch from './Switch.vue';

describe('Switch', () => {
  it('exposes switch semantics reflecting modelValue', () => {
    const wrapper = mount(Switch, {
      props: { modelValue: true, ariaLabel: 'Enable' },
    });
    const btn = wrapper.get('button');
    expect(btn.attributes('role')).toBe('switch');
    expect(btn.attributes('aria-checked')).toBe('true');
    expect(btn.attributes('aria-label')).toBe('Enable');
  });

  it('emits the toggled value on click', async () => {
    const wrapper = mount(Switch, { props: { modelValue: false } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
    expect(wrapper.emitted('change')?.[0]).toEqual([true]);
  });

  it('does not emit when disabled', async () => {
    const wrapper = mount(Switch, {
      props: { modelValue: false, disabled: true },
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
