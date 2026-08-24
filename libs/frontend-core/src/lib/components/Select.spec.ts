import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import Select from './Select.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: {
        select: 'Select…',
        noOptions: 'No options',
        search: 'Search',
        nothingFound: 'Nothing found',
        addNew: 'New',
      },
    },
  },
});

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

let wrapper: VueWrapper | null = null;

const mountSelect = (props: Record<string, unknown> = {}): VueWrapper => {
  wrapper = mount(Select, {
    props: { modelValue: 'a', options: OPTIONS, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  return wrapper;
};

// jsdom has no layout: rects and offset sizes are all zero. The positioning
// branches (flip, clamp, align) are driven entirely by these two mocks.
const anchorRect = (
  w: VueWrapper,
  rect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
  },
): void => {
  w.element.getBoundingClientRect = () =>
    new DOMRect(rect.left, rect.top, rect.width, rect.bottom - rect.top);
};

const panel = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="listbox"]');

const panelSize = (height: number, width: number): void => {
  const el = panel();
  if (!el) expect.unreachable();
  Object.defineProperties(el, {
    offsetHeight: { value: height, configurable: true },
    offsetWidth: { value: width, configurable: true },
  });
};

const openViaTrigger = async (w: VueWrapper): Promise<void> => {
  await w.find('button').trigger('click');
  await nextTick();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Select', () => {
  it('teleports the open panel to <body>, outside the component root', async () => {
    const w = mountSelect();
    anchorRect(w, { top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    const p = panel();
    expect(p).not.toBeNull();
    // VTU stubs <Transition>, so the panel's direct parent is the stub — what
    // matters is that it left the component subtree and landed under <body>.
    expect(document.body.contains(p)).toBe(true);
    expect(w.element.contains(p)).toBe(false);
  });

  it('positions the panel below the trigger and matches its width by default', async () => {
    const w = mountSelect();
    anchorRect(w, { top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    const style = panel()!.style;
    expect(style.top).toBe('146px'); // bottom 140 + 6px gap
    expect(style.left).toBe('50px');
    expect(style.width).toBe('200px');
    expect(style.bottom).toBe('');
  });

  it('flips upward when there is no room below and more room above', async () => {
    const w = mountSelect();
    // window.innerHeight is 768 in jsdom: 28px left below, plenty above.
    anchorRect(w, { top: 700, bottom: 740, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    panelSize(240, 200);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    const style = panel()!.style;
    expect(style.bottom).toBe('74px'); // 768 - top 700 + 6px gap
    expect(style.top).toBe('');
    expect(panel()!.className).toContain('origin-bottom');
  });

  it('anchors to the trigger right edge with align="end"', async () => {
    const w = mountSelect({ align: 'end', customTrigger: true });
    anchorRect(w, { top: 100, bottom: 120, left: 900, right: 960, width: 60 });
    await openViaTrigger(w);
    const style = panel()!.style;
    // window.innerWidth is 1024 in jsdom.
    expect(style.right).toBe('64px'); // 1024 - right 960
    expect(style.left).toBe('');
    expect(style.width).toBe(''); // customTrigger: no forced trigger width
  });

  it('clamps a start-aligned panel that would overflow the right viewport edge', async () => {
    const w = mountSelect({ customTrigger: true });
    anchorRect(w, {
      top: 100,
      bottom: 120,
      left: 1000,
      right: 1020,
      width: 20,
    });
    await openViaTrigger(w);
    panelSize(100, 120);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    // 1024 - 120 - 6 = 898 < trigger left 1000 → clamped.
    expect(panel()!.style.left).toBe('898px');
  });

  it('repositions when an ancestor scrolls (capture-phase scroll)', async () => {
    const w = mountSelect();
    anchorRect(w, { top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    anchorRect(w, { top: 60, bottom: 100, left: 50, right: 250, width: 200 });
    window.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(panel()!.style.top).toBe('106px');
  });

  it('re-runs positioning when options change while open', async () => {
    const w = mountSelect();
    anchorRect(w, { top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    expect(panel()!.style.top).toBe('146px');
    // Async options arriving: the panel re-measures against the current rect.
    anchorRect(w, { top: 60, bottom: 100, left: 50, right: 250, width: 200 });
    await w.setProps({ options: [...OPTIONS, { value: 'd', label: 'Delta' }] });
    await nextTick();
    expect(panel()!.style.top).toBe('106px');
  });

  it('keeps the panel open on a click inside the teleported panel', async () => {
    const w = mountSelect();
    anchorRect(w, { top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    await openViaTrigger(w);
    panel()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(panel()).not.toBeNull();
  });

  it('closes on a click outside both trigger and panel', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(panel()).toBeNull();
  });

  it('selects an option on click and emits both events', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    const options = document.querySelectorAll<HTMLElement>('[role="option"]');
    options[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['b']);
    expect(w.emitted('change')?.[0]).toEqual(['b']);
    expect(panel()).toBeNull();
  });

  it('keyboard navigation still selects from the teleported panel', async () => {
    const w = mountSelect();
    await w.trigger('keydown', { key: 'ArrowDown' }); // opens
    await nextTick();
    await w.trigger('keydown', { key: 'ArrowDown' }); // a → b
    await w.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['b']);
  });

  it('closes on Escape', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    await w.trigger('keydown', { key: 'Escape' });
    expect(panel()).toBeNull();
  });

  it('detaches window listeners on close', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const w = mountSelect();
    await openViaTrigger(w);
    await w.trigger('keydown', { key: 'Escape' });
    await nextTick();
    const removed = removeSpy.mock.calls.map(([name]) => name);
    expect(removed).toContain('scroll');
    expect(removed).toContain('resize');
  });
});

// Focus and search (#171). Both were reported from the base-currency picker:
// tabbing away reopened the list, and a 165-item list had no way to search.

describe('Select focus and search', () => {
  const MANY = Array.from({ length: 12 }, (_, i) => ({
    value: `c${i}`,
    label: `Currency ${i}`,
  }));

  it('has one tab stop — the trigger, not the wrapper', () => {
    const w = mountSelect();
    // The wrapper being focusable too is what made tabbing away look like the
    // control grabbing focus back.
    expect(w.element.getAttribute('tabindex')).toBe('-1');
    expect(w.find('button').attributes('disabled')).toBeUndefined();
  });

  it('closes when focus leaves the control entirely', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    expect(panel()).not.toBeNull();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await w.trigger('focusout', { relatedTarget: outside });
    await nextTick();
    expect(panel()).toBeNull();
  });

  it('stays open while focus moves inside its own panel', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    const inside = panel()!.querySelector('[role="option"]');
    await w.trigger('focusout', { relatedTarget: inside });
    await nextTick();
    expect(panel()).not.toBeNull();
  });

  it('offers a search box for a long list and filters by it', async () => {
    const w = mountSelect({ options: MANY, modelValue: 'c0' });
    await openViaTrigger(w);
    const search = panel()!.querySelector<HTMLInputElement>('input');
    expect(search).not.toBeNull();

    search!.value = 'y 1';
    search!.dispatchEvent(new Event('input'));
    await nextTick();
    // "Currency 1", "Currency 10" and "Currency 11" match; the rest do not.
    expect(panel()!.querySelectorAll('[role="option"]').length).toBe(3);
  });

  it('leaves a short list alone', async () => {
    const w = mountSelect();
    await openViaTrigger(w);
    expect(panel()!.querySelector('input')).toBeNull();
  });

  // A category vocabulary is the shape this exists for (#205): the panel has to
  // read as the tree it came from, and the filter must not orphan a match.
  describe('hierarchical options', () => {
    const TREE = [
      { value: '', label: 'None' },
      { value: 'e', label: 'Electronics', depth: 0, parentValue: null },
      { value: 'p', label: 'Passive', depth: 1, parentValue: 'e' },
      { value: 'r', label: 'Resistors', depth: 2, parentValue: 'p' },
      { value: 'm', label: 'Mechanical', depth: 0, parentValue: null },
    ];

    const labels = (): string[] =>
      Array.from(panel()!.querySelectorAll('[role="option"]')).map(
        (row) => row.textContent?.trim() ?? '',
      );

    const search = async (text: string): Promise<void> => {
      const input = panel()!.querySelector<HTMLInputElement>('input');
      input!.value = text;
      input!.dispatchEvent(new Event('input'));
      await nextTick();
    };

    it('indents each row by its depth', async () => {
      const w = mountSelect({ options: TREE, modelValue: '' });
      await openViaTrigger(w);
      const rows = panel()!.querySelectorAll<HTMLElement>('[role="option"]');
      // Depth 0 keeps the class padding — no inline override to undo it.
      expect(rows[1].style.paddingLeft).toBe('');
      expect(rows[2].style.paddingLeft).toBe('1.75rem');
      expect(rows[3].style.paddingLeft).toBe('2.75rem');
    });

    it('offers the filter even though the list is short', async () => {
      const w = mountSelect({ options: TREE, modelValue: '' });
      await openViaTrigger(w);
      expect(panel()!.querySelector('input')).not.toBeNull();
    });

    it('keeps a match ancestors so its indentation still means something', async () => {
      const w = mountSelect({ options: TREE, modelValue: '' });
      await openViaTrigger(w);
      await search('resist');
      expect(labels()).toEqual(['Electronics', 'Passive', 'Resistors']);
    });

    it('keeps a match descendants, so naming a branch asks for all of it', async () => {
      const w = mountSelect({ options: TREE, modelValue: '' });
      await openViaTrigger(w);
      await search('passive');
      expect(labels()).toEqual(['Electronics', 'Passive', 'Resistors']);
    });

    it('filters a flat list flat', async () => {
      const w = mountSelect({ options: MANY, modelValue: 'c0' });
      await openViaTrigger(w);
      await search('y 11');
      expect(labels()).toEqual(['Currency 11']);
    });
  });

  // "Nothing chosen" rendered exactly like a record is how "Top level" in the
  // category parent picker read as the NAME of a category.
  describe('the empty option', () => {
    const WITH_EMPTY = [
      { value: '', label: 'No parent', empty: true },
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];

    const rows = (): HTMLElement[] =>
      Array.from(panel()!.querySelectorAll<HTMLElement>('[role="option"]'));

    it('mutes it and rules it off from the data below', async () => {
      const w = mountSelect({ options: WITH_EMPTY, modelValue: '' });
      await openViaTrigger(w);
      const [none, first] = rows();
      expect(none.classList).toContain('text-slate-500');
      expect(none.classList).toContain('border-b');
      expect(first.classList).not.toContain('border-b');
    });

    // The dashes belong to the component, not to the translations: logistics
    // had them on two of its four "none" labels and not the other two, which is
    // what a decoration every locale must remember always decays into.
    it('brackets it in dashes, in the list and in the trigger alike', async () => {
      const w = mountSelect({ options: WITH_EMPTY, modelValue: '' });
      expect(w.find('button span').text()).toBe('— No parent —');
      await openViaTrigger(w);
      expect(rows()[0].textContent?.trim()).toBe('— No parent —');
      expect(rows()[1].textContent?.trim()).toBe('Alpha');
    });

    it('drops the rule when nothing is left to separate from', async () => {
      const w = mountSelect({
        options: [{ value: '', label: 'No parent', empty: true }],
        modelValue: '',
      });
      await openViaTrigger(w);
      expect(rows()[0].classList).not.toContain('border-b');
    });

    it('reads as "nothing chosen" in the trigger, not as a value', async () => {
      const chosen = mountSelect({ options: WITH_EMPTY, modelValue: 'a' });
      expect(chosen.find('button span').classes()).toContain('text-slate-900');

      const none = mountSelect({ options: WITH_EMPTY, modelValue: '' });
      expect(none.find('button span').classes()).toContain('text-slate-400');
      expect(none.find('button span').text()).toBe('— No parent —');
    });
  });

  describe('combobox mode', () => {
    it('offers the typed text as a value of its own', async () => {
      const w = mountSelect({ allowCustom: true, modelValue: '' });
      await openViaTrigger(w);
      const input = panel()!.querySelector<HTMLInputElement>('input');
      input!.value = 'Delta';
      input!.dispatchEvent(new Event('input'));
      await nextTick();

      const rows = panel()!.querySelectorAll('[role="option"]');
      expect(rows[0].textContent).toContain('Delta');
      expect(rows[0].textContent).toContain('New');

      (rows[0] as HTMLElement).click();
      await nextTick();
      expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['Delta']);
    });

    it('does not offer a duplicate of an option that already says it', async () => {
      const w = mountSelect({ allowCustom: true, modelValue: '' });
      await openViaTrigger(w);
      const input = panel()!.querySelector<HTMLInputElement>('input');
      input!.value = 'Alpha';
      input!.dispatchEvent(new Event('input'));
      await nextTick();
      expect(panel()!.querySelectorAll('[role="option"]').length).toBe(1);
    });

    it('shows a value no option offers', async () => {
      const w = mountSelect({ allowCustom: true, modelValue: 'Delta' });
      expect(w.find('button').text()).toContain('Delta');
    });
  });

  // `highlight` is what lets a caller show the consequence of a choice before
  // it is made (the scheme picker repaints the app under the pointer).
  describe('highlight reporting', () => {
    it('reports the pointed row, then null once the panel closes', async () => {
      const w = mountSelect({ modelValue: 'a' });
      await openViaTrigger(w);

      const rows = panel()!.querySelectorAll('[role="option"]');
      rows[2].dispatchEvent(new MouseEvent('mouseenter'));
      await nextTick();
      expect(w.emitted('highlight')?.at(-1)).toEqual([OPTIONS[2]]);

      await w.find('button').trigger('keydown', { key: 'Escape' });
      await nextTick();
      expect(w.emitted('highlight')?.at(-1)).toEqual([null]);
    });

    it('reports the keyboard highlight too, and null after a choice', async () => {
      const w = mountSelect({ modelValue: 'a' });
      await openViaTrigger(w);

      await w.find('button').trigger('keydown', { key: 'ArrowDown' });
      await nextTick();
      expect(w.emitted('highlight')?.at(-1)).toEqual([OPTIONS[1]]);

      await w.find('button').trigger('keydown', { key: 'Enter' });
      await nextTick();
      expect(w.emitted('change')?.at(-1)).toEqual(['b']);
      // Chosen is not "still being pointed at": the caller has to be told to
      // drop the preview, or it keeps showing one over the real selection.
      expect(w.emitted('highlight')?.at(-1)).toEqual([null]);
    });
  });

  // The slots exist so a caller that needs a different-LOOKING select (an
  // icon-only trigger, a row with a colour swatch) re-skins this one instead
  // of forking a dropdown that misses the teleport and the keyboard handling.
  describe('slots', () => {
    it('replaces the trigger content, keeping the trigger itself', async () => {
      wrapper = mount(Select, {
        props: { modelValue: 'a', options: OPTIONS, customTrigger: true },
        slots: { trigger: '<i class="marker"></i>' },
        global: { plugins: [i18n] },
        attachTo: document.body,
      });
      expect(wrapper.find('button .marker').exists()).toBe(true);
      expect(wrapper.find('button').text()).not.toContain('Alpha');

      await openViaTrigger(wrapper);
      expect(panel()).not.toBeNull();
    });

    it('replaces a row body but keeps the selected marker', async () => {
      wrapper = mount(Select, {
        props: { modelValue: 'a', options: OPTIONS },
        slots: { option: '<span class="row">{{ params.option.value }}</span>' },
        global: { plugins: [i18n] },
        attachTo: document.body,
      });
      await openViaTrigger(wrapper);

      const rows = panel()!.querySelectorAll('[role="option"]');
      expect(rows.length).toBe(OPTIONS.length);
      expect(rows[0].querySelector('.row')?.textContent).toBe('a');
      expect(rows[0].getAttribute('aria-selected')).toBe('true');
      expect(rows[0].querySelector('svg')).not.toBeNull();
    });
  });
});
