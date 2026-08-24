import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import PhotoGallery, { type GalleryPhoto } from './PhotoGallery.vue';

// The gallery is CONTROLLED — it owns no list, so what is worth pinning is the
// gate on the way in: only images, never more than fit, and the cover said
// exactly once per thumbnail (#214).

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: {
        photos: {
          add: 'Add photos',
          addMore: 'Add more ({remaining} left)',
          full: 'Maximum {max} photos',
          dropHere: 'Drop photos here',
          open: 'Open photo',
          alt: 'Photo',
          cover: 'Cover',
          makeCover: 'Make cover',
          remove: 'Remove photo',
        },
      },
    },
  },
});

const photo = (key: string, isCover = false): GalleryPhoto => ({
  key,
  src: `/api/uploads/${key}`,
  isCover,
});

const render = (photos: GalleryPhoto[], max = 5) =>
  mount(PhotoGallery, {
    props: { photos, max },
    global: { plugins: [i18n] },
  });

const file = (name: string, type: string): File =>
  new File(['x'], name, { type });

// jsdom will not let a FileList be built, so the input's `files` is replaced
// with a list-shaped object — which is all `Array.from` needs.
const fileListOf = (files: File[]): FileList => {
  const list: Record<number, File> & { length: number; item(i: number): File } =
    {
      length: files.length,
      item: (i: number) => files[i],
    };
  files.forEach((f, i) => (list[i] = f));
  return list as unknown as FileList;
};

const pick = async (
  wrapper: ReturnType<typeof render>,
  files: File[],
): Promise<void> => {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    value: fileListOf(files),
    configurable: true,
  });
  await input.trigger('change');
};

describe('PhotoGallery (#214)', () => {
  it('emits only the image files that were picked', async () => {
    const wrapper = render([]);
    await pick(wrapper, [
      file('a.jpg', 'image/jpeg'),
      file('notes.pdf', 'application/pdf'),
      file('b.png', 'image/png'),
    ]);
    const added = wrapper.emitted('add')?.[0]?.[0] as File[];
    expect(added.map((f) => f.name)).toEqual(['a.jpg', 'b.png']);
  });

  // Trimming the overflow beats accepting the drop and then refusing the whole
  // save — the user would lose the pictures that DID fit.
  it('trims a pick to the slots that are left', async () => {
    const wrapper = render([photo('att_1', true), photo('att_2')], 3);
    await pick(wrapper, [
      file('a.jpg', 'image/jpeg'),
      file('b.jpg', 'image/jpeg'),
    ]);
    const added = wrapper.emitted('add')?.[0]?.[0] as File[];
    expect(added.map((f) => f.name)).toEqual(['a.jpg']);
  });

  it('emits nothing when the set is already full', async () => {
    const wrapper = render([photo('att_1', true)], 1);
    await pick(wrapper, [file('a.jpg', 'image/jpeg')]);
    expect(wrapper.emitted('add')).toBeUndefined();
  });

  it('emits nothing when no image was picked', async () => {
    const wrapper = render([]);
    await pick(wrapper, [file('notes.pdf', 'application/pdf')]);
    expect(wrapper.emitted('add')).toBeUndefined();
  });

  it('disables the add control at the cap', () => {
    const wrapper = render([photo('att_1', true)], 1);
    expect(wrapper.find('button[disabled]').exists()).toBe(true);
  });

  // Badge on the cover, action on the others — never both on one thumbnail, or
  // the picture that IS the cover offers to become it.
  it('badges the cover and offers the action only on the rest', () => {
    const wrapper = render([photo('att_1', true), photo('att_2')]);
    const items = wrapper.findAll('li');
    expect(items[0].text()).toContain('Cover');
    expect(items[0].find('button[aria-label="Make cover"]').exists()).toBe(
      false,
    );
    expect(items[1].find('button[aria-label="Make cover"]').exists()).toBe(
      true,
    );
  });

  it('reports which photo was asked for', async () => {
    const wrapper = render([photo('att_1', true), photo('att_2')]);
    await wrapper
      .findAll('li')[1]
      .find('button[aria-label="Remove photo"]')
      .trigger('click');
    expect(wrapper.emitted('remove')?.[0]).toEqual(['att_2']);
    await wrapper
      .findAll('li')[1]
      .find('button[aria-label="Make cover"]')
      .trigger('click');
    expect(wrapper.emitted('makeCover')?.[0]).toEqual(['att_2']);
    await wrapper
      .findAll('li')[0]
      .find('button[aria-label="Open photo"]')
      .trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual(['att_1']);
  });

  // A stored photo shows its `xs` rendition (#113); a pick that has not been
  // saved has no renditions and must render from its own bytes.
  it('renders a pending pick from its data URL', () => {
    const wrapper = render([
      { key: 'pending_1', src: 'data:image/png;base64,AAAA', isCover: true },
    ]);
    expect(wrapper.find('img').attributes('src')).toBe(
      'data:image/png;base64,AAAA',
    );
  });
});
