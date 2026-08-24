import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Disclosure from './Disclosure.vue';

const props = {
  open: false,
  title: 'Reference',
  contentId: 'reference-body',
} as const;

describe('Disclosure', () => {
  // jsdom implements no scrolling; `reveal()` asks for both halves anyway.
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('ties the toggle to the region it controls', () => {
    const wrapper = mount(Disclosure, { props });
    const button = wrapper.get('button');
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(button.attributes('aria-controls')).toBe('reference-body');
    expect(wrapper.get('#reference-body').attributes('style')).toContain(
      'display: none',
    );
  });

  it('asks its owner to flip the flag rather than flipping it itself', async () => {
    const wrapper = mount(Disclosure, { props });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:open')?.[0]).toEqual([true]);
    // Controlled: nothing opened until the owner passes the new value back.
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });

  it('keeps the closed content mounted so state inside it survives', () => {
    const wrapper = mount(Disclosure, {
      props,
      slots: { default: '<p class="inner">kept</p>' },
    });
    expect(wrapper.find('.inner').exists()).toBe(true);
  });

  it('reveals by focusing its own toggle, without letting focus move the page', () => {
    const wrapper = mount(Disclosure, {
      props: { ...props, open: true },
      attachTo: document.body,
    });
    const focus = vi.spyOn(wrapper.get('button').element, 'focus');
    (wrapper.vm as unknown as { reveal: () => void }).reveal();
    expect(document.activeElement).toBe(wrapper.get('button').element);
    // The scroll is the section's to do; `focus()` doing its own would abort it.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    wrapper.unmount();
  });

  it('drops the glide for a reader who asked for less motion', () => {
    // jsdom ships no `matchMedia`, so the preference has to be stubbed in.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const wrapper = mount(Disclosure, { props: { ...props, open: true } });
    (wrapper.vm as unknown as { reveal: () => void }).reveal();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });
});
