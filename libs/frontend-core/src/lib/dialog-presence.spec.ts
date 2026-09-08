import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { isDialogOpen, useDialogPresence } from './dialog-presence';

// The signal anything self-initiated asks before drawing on screen (#351):
// it must be true for exactly as long as a dialog owns the page — through
// nesting, and through a dialog that unmounts while still open.
const Dialog = defineComponent({
  props: { open: { type: Boolean, required: true } },
  setup(props) {
    useDialogPresence(() => props.open);
    return () => h('div');
  },
});

describe('useDialogPresence', () => {
  it('is open only while a dialog is', async () => {
    const wrapper = mount(Dialog, { props: { open: false } });
    expect(isDialogOpen.value).toBe(false);

    await wrapper.setProps({ open: true });
    expect(isDialogOpen.value).toBe(true);

    await wrapper.setProps({ open: false });
    expect(isDialogOpen.value).toBe(false);
    wrapper.unmount();
  });

  it('counts a dialog mounted already open, and releases it on unmount', () => {
    const wrapper = mount(Dialog, { props: { open: true } });
    expect(isDialogOpen.value).toBe(true);

    wrapper.unmount();
    expect(isDialogOpen.value).toBe(false);
  });

  it('stays open while a second dialog covers the first', async () => {
    const outer = mount(Dialog, { props: { open: true } });
    const inner = mount(Dialog, { props: { open: true } });

    inner.unmount();
    expect(isDialogOpen.value).toBe(true);

    await outer.setProps({ open: false });
    expect(isDialogOpen.value).toBe(false);

    // Unmounting a dialog that already closed must not push the count below
    // zero, which would report the next dialog's absence as its presence.
    outer.unmount();
    const next = mount(Dialog, { props: { open: false } });
    expect(isDialogOpen.value).toBe(false);
    next.unmount();
  });
});
