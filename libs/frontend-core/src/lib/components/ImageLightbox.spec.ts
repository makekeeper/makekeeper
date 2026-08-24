import { describe, it, expect, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import ImageLightbox, { type LightboxImage } from './ImageLightbox.vue';

// The strings moved into the core `common.*` bundle with the component (#213):
// a shared primitive cannot depend on one plugin's locale file. Declared inline
// here, as every other frontend-core component spec does.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: {
        close: 'Close',
        download: 'Download',
        lightbox: {
          title: 'Photo',
          unnamed: 'File',
          alt: 'Photo',
          previous: 'Previous photo',
          next: 'Next photo',
        },
      },
    },
  },
});

const IMAGES: LightboxImage[] = [
  { id: 'att_1', url: '/api/uploads/att_1', filename: 'first.jpg' },
  { id: 'att_2', url: '/api/uploads/att_2', filename: 'second.jpg' },
  { id: 'att_3', url: '/api/uploads/att_3', filename: null },
];

// `attach` is only for the focus assertions: with `teleport` stubbed the tree
// stays detached, and `focus()` on a detached element never becomes
// `document.activeElement`.
const render = (
  openId: string | null,
  images = IMAGES,
  attach = false,
): ReturnType<typeof mount> =>
  mount(ImageLightbox, {
    props: { images, openId },
    attachTo: attach ? document.body : undefined,
    global: { plugins: [i18n], stubs: { teleport: true } },
  });

const press = (key: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));

describe('ImageLightbox (#117)', () => {
  it('shows nothing until an image is opened', () => {
    expect(render(null).find('[role="dialog"]').exists()).toBe(false);
  });

  // The point of the whole ticket: a tile is 200 px, the viewer shows the
  // 2048 px rendition — and never the multi-megabyte original, which is what
  // Download serves.
  it('shows the large rendition, not the original', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    const src = wrapper.find('img').attributes('src');
    expect(src).toBe('/api/uploads/att_1?variant=lg');
  });

  it('names the picture and its place in the set', async () => {
    const wrapper = render('att_2');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('second.jpg');
    expect(wrapper.text()).toContain('2 / 3');
  });

  it('walks the set with the arrow keys, wrapping at both ends', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();

    press('ArrowRight');
    expect(wrapper.emitted('update:openId')?.[0]).toEqual(['att_2']);

    // Wrapping: a dead arrow key at the end reads as a broken one.
    press('ArrowLeft');
    expect(wrapper.emitted('update:openId')?.[1]).toEqual(['att_3']);
  });

  it('closes on Escape', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();

    press('Escape');
    expect(wrapper.emitted('update:openId')?.[0]).toEqual([null]);
  });

  it('closes on a click outside the picture', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();

    await wrapper.find('[role="dialog"]').trigger('click');
    expect(wrapper.emitted('update:openId')?.[0]).toEqual([null]);
  });

  // A tap that wobbles is not a swipe; a real swipe moves to the neighbour.
  it('advances on a swipe but ignores a jitter', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    const dialog = wrapper.find('[role="dialog"]').element;
    // `clientX` is read-only on a constructed MouseEvent, so it goes in the
    // init dict rather than through test-utils' property assignment.
    const swipe = (type: string, clientX: number) =>
      dialog.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));

    swipe('pointerdown', 300);
    swipe('pointerup', 292);
    expect(wrapper.emitted('update:openId')).toBeUndefined();

    swipe('pointerdown', 300);
    swipe('pointerup', 120);
    expect(wrapper.emitted('update:openId')?.[0]).toEqual(['att_2']);
  });

  // A mouse swipe across the backdrop ends in a real `click`, which the
  // backdrop otherwise reads as "dismiss" — advancing and closing at once.
  it('does not close when a swipe ends on the backdrop', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    const dialog = wrapper.find('[role="dialog"]');
    const fire = (type: string, clientX: number) =>
      dialog.element.dispatchEvent(
        new MouseEvent(type, { clientX, bubbles: true }),
      );

    fire('pointerdown', 300);
    fire('pointerup', 120);
    await dialog.trigger('click');

    // The swipe, and only the swipe.
    expect(wrapper.emitted('update:openId')).toEqual([['att_2']]);

    // The suppression is spent, not sticky: the next plain click still closes.
    await dialog.trigger('click');
    expect(wrapper.emitted('update:openId')?.[1]).toEqual([null]);
  });

  // A cancelled gesture leaves no origin behind: a stale start point would turn
  // the next tap into a swipe of whatever distance separated the two.
  it('forgets a cancelled gesture', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    const dialog = wrapper.find('[role="dialog"]').element;
    const fire = (type: string, clientX: number) =>
      dialog.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));

    fire('pointerdown', 300);
    dialog.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    fire('pointerup', 40);

    expect(wrapper.emitted('update:openId')).toBeUndefined();
  });

  // `aria-modal` claims the page behind is inert; Tab must not walk out onto it.
  it('keeps Tab inside the dialog', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    const wrapper = render('att_1', IMAGES, true);
    await wrapper.vm.$nextTick();
    const buttons = wrapper
      .findAll('button')
      .map((b) => b.element as HTMLElement);
    const last = buttons[buttons.length - 1];
    last.focus();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    outside.remove();
  });

  // Arrowing must not flash empty frames while the next rendition loads.
  it('preloads its neighbours', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();

    const sources = wrapper.findAll('img').map((img) => img.attributes('src'));
    expect(sources).toContain('/api/uploads/att_2?variant=lg');
    expect(sources).toContain('/api/uploads/att_3?variant=lg');
  });

  it('hides the navigation entirely for a single image', async () => {
    const wrapper = render('att_1', [IMAGES[0]]);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('1 / 1');
    expect(wrapper.findAll('img')).toHaveLength(1);
  });

  // Download stays the original's job — the viewer only asks for it.
  it('asks the page to download the open image', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();

    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Download')
      ?.trigger('click');

    expect(wrapper.emitted('download')?.[0]).toEqual([IMAGES[0]]);
  });

  it('returns focus to where it came from when it closes', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ openId: null });
    await wrapper.vm.$nextTick();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('stops listening for keys once unmounted', async () => {
    const wrapper = render('att_1');
    await wrapper.vm.$nextTick();
    wrapper.unmount();

    const spy = vi.fn();
    document.addEventListener('keydown', spy);
    press('ArrowRight');
    document.removeEventListener('keydown', spy);

    expect(spy).toHaveBeenCalled();
    expect(wrapper.emitted('update:openId')).toBeUndefined();
  });
});
