import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import Modal from './Modal.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { close: 'Close' } } },
});

let wrapper: VueWrapper | null = null;

const mountModal = (props: Record<string, unknown>): VueWrapper => {
  wrapper = mount(Modal, {
    props,
    slots: { default: 'Body content' },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('Modal', () => {
  it('renders nothing while closed', () => {
    mountModal({ modelValue: false });
    expect(document.body.textContent).not.toContain('Body content');
  });

  it('renders the dialog and title when open', async () => {
    const w = mountModal({ modelValue: false, title: 'Confirm' });
    await w.setProps({ modelValue: true });
    expect(document.body.textContent).toContain('Body content');
    expect(document.body.textContent).toContain('Confirm');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('emits close and update:modelValue when the close button is clicked', async () => {
    const w = mountModal({ modelValue: false, title: 'Confirm' });
    await w.setProps({ modelValue: true });
    const closeBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    closeBtn?.click();
    expect(w.emitted('close')).toBeTruthy();
    expect(w.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('closes on Escape', async () => {
    const w = mountModal({ modelValue: false });
    await w.setProps({ modelValue: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toBeTruthy();
  });

  it('is not dismissible when dismissible is false', async () => {
    const w = mountModal({ modelValue: false, dismissible: false });
    await w.setProps({ modelValue: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toBeUndefined();
  });

  // A confirmation raised from inside a dialog must cover it. Both teleport to
  // <body>, so with equal z-index the one mounted later wins — and the confirm
  // host is mounted first, at app start, which is precisely the losing order.
  it('sits on the confirm rung when asked to', () => {
    mountModal({ modelValue: true });
    expect(document.body.querySelector('.z-modal')).not.toBeNull();
    expect(document.body.querySelector('.z-confirm')).toBeNull();
    wrapper?.unmount();

    mountModal({ modelValue: true, layer: 'confirm' });
    expect(document.body.querySelector('.z-confirm')).not.toBeNull();
    expect(document.body.querySelector('.z-modal')).toBeNull();
  });
});
