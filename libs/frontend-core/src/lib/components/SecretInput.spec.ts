import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ShieldCheck, Trash2 } from '@lucide/vue';
import SecretInput from './SecretInput.vue';
import { secretPatch, type SecretAction } from '../secret-field';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: {
        secret: {
          stored: 'Value saved',
          change: 'Change',
          remove: 'Remove',
          keep: 'Keep saved value',
          willBeRemoved: 'Will be removed',
          keepsSaved: 'Empty leaves the saved value in place',
          emptyRemoves: 'Empty removes the saved value',
        },
      },
    },
  },
});

const mountInput = (props: {
  modelValue?: string;
  action?: SecretAction;
  stored: boolean;
  preview?: string | null;
  removable?: boolean;
  id?: string;
  type?: 'password' | 'text' | 'url';
}) => {
  // Both models write back, exactly as a `v-model` caller does — the field
  // reads the admin's intent off its own content, so a test that never updates
  // the props would be testing a component nobody mounts.
  const wrapper = mount(SecretInput, {
    props: {
      modelValue: '',
      action: 'keep',
      ...props,
      'onUpdate:modelValue': (modelValue: string) =>
        wrapper.setProps({ modelValue }),
      'onUpdate:action': (action: SecretAction) => wrapper.setProps({ action }),
    },
    global: { plugins: [i18n] },
  });
  return wrapper;
};

describe('SecretInput', () => {
  it('shows a stored value as a shielded read-only field, never an empty box', () => {
    const wrapper = mountInput({ stored: true });
    const input = wrapper.get('input');
    expect(input.attributes('readonly')).toBeDefined();
    expect((input.element as HTMLInputElement).value).toBe('••••••••');
    expect(wrapper.text()).toContain('Value saved');
  });

  it('renders the redacted preview when the backend offers one', () => {
    const wrapper = mountInput({
      stored: true,
      preview: 'https://deploy.example.com/…',
    });
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(
      'https://deploy.example.com/…',
    );
  });

  it('never masks a password: the read-only field is plain text', () => {
    const wrapper = mountInput({ stored: true, type: 'password' });
    expect(wrapper.get('input').attributes('type')).toBe('text');
  });

  it('is an ordinary editable field when nothing is stored', () => {
    const wrapper = mountInput({ stored: false, id: 'hook-token' });
    const input = wrapper.get('input');
    expect(input.attributes('readonly')).toBeUndefined();
    expect(input.attributes('type')).toBe('password');
    // The caller's <label for> stays attached in every state.
    expect(input.attributes('id')).toBe('hook-token');
    expect(wrapper.text()).not.toContain('Value saved');
  });

  it('offers removal only when the caller allows it', () => {
    expect(mountInput({ stored: true }).findAll('button')).toHaveLength(1);
    expect(
      mountInput({ stored: true, removable: true }).findAll('button'),
    ).toHaveLength(2);
  });

  it('clears anything typed when the intent changes', async () => {
    const wrapper = mountInput({
      stored: true,
      action: 'replace',
      modelValue: 'half-typed',
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:action')?.[0]).toEqual(['keep']);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['']);
  });

  it('stages a removal as an undoable state rather than an immediate one', async () => {
    const wrapper = mountInput({ stored: true, action: 'remove' });
    expect(wrapper.text()).toContain('Will be removed');
    expect(wrapper.get('input').attributes('readonly')).toBeDefined();
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:action')?.[0]).toEqual(['keep']);
  });

  it('emits what the admin types while replacing', async () => {
    const wrapper = mountInput({ stored: true, action: 'replace' });
    await wrapper.get('input').setValue('new-secret');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      'new-secret',
    ]);
    // Already replacing — no redundant intent change.
    expect(wrapper.emitted('update:action')).toBeUndefined();
  });

  // The #270 defect: emptying a field and saving reported success while the
  // stored value survived untouched. The intent stays `replace` — what an empty
  // box does is decided by `secretPatch(emptyClears)` at save time, and the
  // caption warns about it up front.
  it('warns that an empty open box clears the value where clearing is allowed', async () => {
    const wrapper = mountInput({ stored: true, removable: true });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:action')?.at(-1)).toEqual(['replace']);
    expect(wrapper.text()).toContain('Empty removes the saved value');
    const input = wrapper.get('input');
    expect(input.attributes('readonly')).toBeUndefined();
  });

  // The regression the first fix shipped: a watcher inferred `remove` from the
  // empty box and raced the caller's own reset, so the field announced a
  // removal right after a successful save. The component is fully controlled
  // now — a caller saying `keep` is never argued with.
  it('returns to the masked state when the caller resets after a save', async () => {
    const wrapper = mountInput({ stored: true, removable: true });
    await wrapper.get('button').trigger('click');
    await wrapper.get('input').setValue('new-value');
    // The save handler resets both models, exactly as the real forms do.
    await wrapper.setProps({ modelValue: '', action: 'keep' });
    await new Promise((resolve) => setTimeout(resolve));
    expect(wrapper.get('input').attributes('readonly')).toBeDefined();
    expect(wrapper.text()).toContain('Value saved');
    expect(wrapper.text()).not.toContain('removes');
    expect(wrapper.text()).not.toContain('Will be removed');
  });

  it('wears no glyph while the box is open: "Change" is not a delete', async () => {
    const wrapper = mountInput({ stored: true, removable: true });
    expect(wrapper.findComponent(ShieldCheck).exists()).toBe(true);
    await wrapper.get('button').trigger('click');
    expect(wrapper.findComponent(Trash2).exists()).toBe(false);
    expect(wrapper.findComponent(ShieldCheck).exists()).toBe(false);
  });

  it('keeps the trash glyph on a settled, struck-through removal', () => {
    const wrapper = mountInput({ stored: true, action: 'remove' });
    expect(wrapper.findComponent(Trash2).exists()).toBe(true);
  });

  it('says so when an emptied box cannot clear the stored value', async () => {
    const wrapper = mountInput({
      stored: true,
      removable: false,
      action: 'replace',
      modelValue: '',
    });
    expect(wrapper.text()).toContain('Empty leaves the saved value in place');
    // Undo stays reachable alongside the explanation.
    expect(wrapper.text()).toContain('Keep saved value');
  });

  it('never warns on a fresh field: there is nothing an empty box could clear', async () => {
    const wrapper = mountInput({
      stored: false,
      removable: true,
      action: 'replace',
      modelValue: 'x',
    });
    await wrapper.get('input').setValue('');
    expect(wrapper.text()).not.toContain('removes');
  });

  it('treats typing into a fresh field as the intent to replace', async () => {
    const wrapper = mountInput({ stored: false, action: 'keep' });
    await wrapper.get('input').setValue('first-secret');
    expect(wrapper.emitted('update:action')?.[0]).toEqual(['replace']);
  });
});

describe('secretPatch', () => {
  it('omits the field while the stored value is kept', () => {
    expect(secretPatch('keep', '')).toBeUndefined();
    expect(secretPatch('keep', 'ignored')).toBeUndefined();
  });

  it('sends the trimmed new value on replace', () => {
    expect(secretPatch('replace', '  abc  ')).toBe('abc');
  });

  it('treats an abandoned replace as no change at all', () => {
    expect(secretPatch('replace', '   ')).toBeUndefined();
    expect(secretPatch('replace', '   ', { trim: false })).toBeUndefined();
  });

  it('clears on an empty replace when the caller allows clearing', () => {
    expect(secretPatch('replace', '', { emptyClears: true })).toBeNull();
    expect(secretPatch('replace', '  ', { emptyClears: true })).toBeNull();
    // A typed value still wins over the option.
    expect(secretPatch('replace', 'abc', { emptyClears: true })).toBe('abc');
    // Keep is keep, whatever the options say.
    expect(secretPatch('keep', '', { emptyClears: true })).toBeUndefined();
  });

  it('keeps edge whitespace when the caller says the value owns it', () => {
    expect(secretPatch('replace', ' pa ss ', { trim: false })).toBe(' pa ss ');
  });

  it('clears on remove', () => {
    expect(secretPatch('remove', '')).toBeNull();
  });
});
