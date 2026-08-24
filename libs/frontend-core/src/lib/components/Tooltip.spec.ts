import { mount } from '@vue/test-utils';
import { h } from 'vue';
import Tooltip from './Tooltip.vue';

// The bubble is teleported to `body`, so it is asserted there rather than in
// the wrapper — which is the whole point of the primitive: a trigger inside a
// clipping container (a scroll strip, an overflow-hidden card) must not have
// its explanation cut off.
// The component has two roots (the wrapper and the teleport), so events go to
// the wrapper element explicitly rather than through `wrapper.trigger`.
const mounted: ReturnType<typeof mount>[] = [];

const render = (text?: string) => {
  const wrapper = mount(Tooltip, {
    props: { text },
    slots: { default: () => h('em', 'trigger') },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, trigger: wrapper.find('span') };
};

const bubble = () => document.body.querySelector('[role="tooltip"]');

const rectOf = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => undefined,
  }) satisfies DOMRect;

describe('Tooltip', () => {
  afterEach(() => {
    // Unmounted, not wiped: the window listeners live as long as the component
    // does, so a left-behind instance keeps reacting to the next test's scroll
    // — with its teleport target already gone.
    while (mounted.length) mounted.pop()?.unmount();
  });

  it('shows nothing until the trigger is hovered', async () => {
    const { trigger } = render('what this counts');
    expect(bubble()).toBeNull();

    await trigger.trigger('mouseenter');
    expect(bubble()?.textContent?.trim()).toBe('what this counts');
  });

  it('hides again on leave', async () => {
    const { trigger } = render('what this counts');
    await trigger.trigger('mouseenter');
    await trigger.trigger('mouseleave');
    expect(bubble()).toBeNull();
  });

  it('opens on keyboard focus, for a trigger that can take focus', async () => {
    const { trigger } = render('what this counts');
    await trigger.trigger('focusin');
    expect(bubble()).not.toBeNull();
    await trigger.trigger('focusout');
    expect(bubble()).toBeNull();
  });

  it('stays shut with no text, so an optional label needs no v-if', async () => {
    const { trigger } = render();
    await trigger.trigger('mouseenter');
    expect(bubble()).toBeNull();
  });

  it('never eats a click meant for the trigger', async () => {
    // It explains, it does not contain: a bubble that can be hovered or
    // clicked sits between the pointer and the control underneath it.
    const { trigger } = render('what this counts');
    await trigger.trigger('mouseenter');
    expect(bubble()?.className).toContain('pointer-events-none');
  });

  it('measures what it wraps when it has no box of its own', async () => {
    // `display: contents` is what keeps a trigger from disturbing a table cell
    // or a grid — and it is exactly the case where the wrapper's own rect is
    // all zeroes, which would drop the bubble in the window's corner.
    const wrapper = mount(Tooltip, {
      props: { text: 'the whole description', display: 'contents' },
      slots: { default: () => h('span', { class: 'inner' }, 'clamped') },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    // jsdom lays nothing out, so every rect is zero unless it is stubbed —
    // including the bubble's, which would then read as hard against the left
    // edge and earn a correction. Give it a mid-screen one so this test is
    // about the ANCHOR and nothing else.
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(rectOf(400, 200, 200, 30));
    const inner = wrapper.find('.inner').element;
    inner.getBoundingClientRect = () => rectOf(100, 40, 60, 20);

    await wrapper.find('span').trigger('mouseenter');
    await wrapper.vm.$nextTick();

    const style = bubble()?.getAttribute('style') ?? '';
    // Centred on the CHILD (100 + 60/2), not on the box-less wrapper.
    expect(style).toContain('left: 130px');
    expect(style).toContain('top: 34px');
    spy.mockRestore();
  });

  it('sits beside the trigger, vertically centred, when placed right', async () => {
    // The collapsed rail (#268): a bubble ABOVE the item would cover the item
    // above it, so the rail's tooltip goes to the right of the icon and lines
    // up with its middle.
    const wrapper = mount(Tooltip, {
      props: { text: 'Inventory', placement: 'right' },
      slots: { default: () => h('em', 'icon') },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    // jsdom lays nothing out: an unstubbed bubble rect reads as hard against
    // the top-left corner and earns an edge correction. Park it mid-screen so
    // this test is about the ANCHOR alone.
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(rectOf(400, 200, 200, 30));
    const trigger = wrapper.find('span');
    trigger.element.getBoundingClientRect = () => rectOf(16, 100, 48, 44);

    await trigger.trigger('mouseenter');
    await wrapper.vm.$nextTick();
    const style = bubble()?.getAttribute('style') ?? '';
    spy.mockRestore();
    // Right edge of the trigger (16 + 48) plus the 8px gap; middle of its
    // height (100 + 44/2), the -50% translate doing the centring.
    expect(style).toContain('left: 72px');
    expect(style).toContain('top: 122px');
    expect(bubble()?.className).toContain('-translate-y-1/2');
  });

  it('caps its width to the room left beside the trigger', async () => {
    // Sliding a right-placed bubble back inwards would park it on top of the
    // very icon it explains, so it wraps within what is left instead.
    const wrapper = mount(Tooltip, {
      props: { text: 'a name long enough to matter', placement: 'right' },
      slots: { default: () => h('em', 'icon') },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    const trigger = wrapper.find('span');
    trigger.element.getBoundingClientRect = () => rectOf(16, 100, 48, 44);

    await trigger.trigger('mouseenter');
    const style = bubble()?.getAttribute('style') ?? '';
    // window.innerWidth (jsdom: 1024) - anchor 64 - gap 8 - edge 8, and never
    // wider than the primitive's own cap.
    expect(style).toContain(
      `max-width: min(20rem, ${window.innerWidth - 80}px)`,
    );
  });

  it('reads at the label size when it stands in for a label', async () => {
    const wrapper = mount(Tooltip, {
      props: { text: 'Inventory', size: 'sm' },
      slots: { default: () => h('em', 'icon') },
      attachTo: document.body,
    });
    mounted.push(wrapper);

    await wrapper.find('span').trigger('mouseenter');
    expect(bubble()?.className).toContain('text-sm');
    expect(bubble()?.className).not.toContain('text-xxs');
  });

  it('lifts itself back inside the viewport when it hangs off the bottom', async () => {
    // A bubble beside the rail's LAST item runs off the bottom as readily as a
    // top-placed one runs off the side — the vertical correction is the one the
    // `right` placement made necessary.
    const wrapper = mount(Tooltip, {
      props: { text: 'Agent capabilities', placement: 'right' },
      slots: { default: () => h('em', 'icon') },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    // The prototype stub is the BUBBLE's rect; the trigger's own property wins
    // over it, so the anchor stays where this test puts it.
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(rectOf(72, 722, 200, 60));
    const trigger = wrapper.find('span');
    trigger.element.getBoundingClientRect = () => rectOf(16, 700, 48, 44);

    await trigger.trigger('mouseenter');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const style = bubble()?.getAttribute('style') ?? '';
    // Anchor y 722, bubble bottom 782 against a 768-tall window with an 8px
    // margin: 22px too low, so it comes up by exactly that.
    expect(style).toContain(`top: ${722 - (782 - (window.innerHeight - 8))}px`);
    spy.mockRestore();
  });

  it('closes when the page moves under it', async () => {
    // It is `fixed`: scrolling the container the trigger lives in would
    // otherwise leave it pointing at nothing.
    const { wrapper, trigger } = render('what this counts');
    await trigger.trigger('mouseenter');
    window.dispatchEvent(new Event('scroll'));
    await wrapper.vm.$nextTick();
    expect(bubble()).toBeNull();
  });
});
