import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ResizeHandle from './ResizeHandle.vue';

const props = {
  size: 384,
  min: 320,
  max: 768,
  resetTo: 384,
  label: 'Chat column width',
} as const;

// jsdom has no pointer capture; the component calls both halves on every drag.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
});

// jsdom ships no PointerEvent, and test-utils' `trigger` cannot set `clientX`
// on the MouseEvent it builds (read-only getter) — so the drag is dispatched by
// hand: a real MouseEvent carrying the coordinate, plus the two pointer fields
// the handler reads.
function drag(el: Element, type: string, clientX: number): void {
  const event = new MouseEvent(type, { clientX, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(event);
}

describe('ResizeHandle', () => {
  it('announces itself as a splitter with its live value', () => {
    const handle = mount(ResizeHandle, { props }).get('[role="separator"]');
    expect(handle.attributes('aria-orientation')).toBe('vertical');
    expect(handle.attributes('aria-label')).toBe('Chat column width');
    expect(handle.attributes('aria-valuenow')).toBe('384');
    expect(handle.attributes('aria-valuemin')).toBe('320');
    expect(handle.attributes('aria-valuemax')).toBe('768');
    expect(handle.attributes('tabindex')).toBe('0');
  });

  it('grows the pane as the pointer travels away from its left edge', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    expect(wrapper.emitted('update:active')?.[0]).toEqual([true]);
    drag(handle.element, 'pointermove', 940);
    expect(wrapper.emitted('update:size')?.[0]).toEqual([444]);
    drag(handle.element, 'pointerup', 940);
    expect(wrapper.emitted('update:active')?.[1]).toEqual([false]);
  });

  it('measures from where the gesture started, not from the last event', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    drag(handle.element, 'pointermove', 960);
    drag(handle.element, 'pointermove', 980);
    // 20px back from the origin, not 20px past the previous emission.
    expect(wrapper.emitted('update:size')?.at(-1)).toEqual([404]);
  });

  it('never asks for a size outside the bounds', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    drag(handle.element, 'pointermove', 2000);
    expect(wrapper.emitted('update:size')?.at(-1)).toEqual([320]);
    drag(handle.element, 'pointermove', 0);
    expect(wrapper.emitted('update:size')?.at(-1)).toEqual([768]);
  });

  it('ignores movement once the gesture is over', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointermove', 500);
    expect(wrapper.emitted('update:size')).toBeUndefined();
  });

  it('leaves the page selectable again after the drag', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    drag(handle.element, 'pointerup', 1000);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('lets go when the capture is taken away without a cancel', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    // No pointerup, no pointercancel — only the browser reporting the capture
    // gone. Without this the gesture never ends: the page stays unselectable
    // and the caller keeps its transitions suspended forever.
    drag(handle.element, 'lostpointercapture', 1000);
    expect(wrapper.emitted('update:active')?.[1]).toEqual([false]);
    expect(document.body.style.userSelect).toBe('');
  });

  it('lets go when the pane disappears mid-drag', async () => {
    const wrapper = mount(ResizeHandle, { props });
    drag(wrapper.get('[role="separator"]').element, 'pointerdown', 1000);
    wrapper.unmount();
    expect(document.body.style.userSelect).toBe('');
  });

  it('answers the arrow keys in the screen’s direction', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const handle = wrapper.get('[role="separator"]');
    // Left moves the seam left, which on a right-docked pane makes it wider.
    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('update:size')?.[0]).toEqual([400]);
    await handle.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:size')?.[1]).toEqual([368]);
  });

  it('takes Home and End to the bounds and Enter back to the default', async () => {
    const wrapper = mount(ResizeHandle, {
      props: { ...props, size: 500 },
    });
    const handle = wrapper.get('[role="separator"]');
    await handle.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:size')?.[0]).toEqual([320]);
    await handle.trigger('keydown', { key: 'End' });
    expect(wrapper.emitted('update:size')?.[1]).toEqual([768]);
    await handle.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:size')?.[2]).toEqual([384]);
  });

  it('resets on a double-click, the pointer’s way out of a bad width', async () => {
    const wrapper = mount(ResizeHandle, { props: { ...props, size: 700 } });
    await wrapper.get('[role="separator"]').trigger('dblclick');
    expect(wrapper.emitted('update:size')?.[0]).toEqual([384]);
  });

  it('inverts the delta for a pane whose handle sits on its right edge', async () => {
    const wrapper = mount(ResizeHandle, {
      props: { ...props, edge: 'right' as const },
    });
    const handle = wrapper.get('[role="separator"]');
    drag(handle.element, 'pointerdown', 1000);
    drag(handle.element, 'pointermove', 1040);
    expect(wrapper.emitted('update:size')?.[0]).toEqual([424]);
  });
});
