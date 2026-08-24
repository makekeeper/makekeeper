import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import ProjectFilesListing from './ProjectFilesListing.vue';
import type { ProjectFile, ProjectFilesView } from './project-files';
import en from '../i18n/en.json';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const PHOTO: ProjectFile = {
  id: 'att_photo',
  url: '/api/uploads/att_photo',
  mimeType: 'image/jpeg',
  filename: 'IMG_1234.jpg',
  isImage: true,
  isCover: true,
  sizeBytes: 2_097_152,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const MODEL: ProjectFile = {
  id: 'att_model',
  url: '/api/uploads/att_model',
  mimeType: 'model/stl',
  filename: 'bracket.stl',
  isImage: false,
  isCover: false,
  sizeBytes: 524_288,
  createdAt: '2026-07-02T10:00:00.000Z',
};

const render = (view: ProjectFilesView, files = [PHOTO, MODEL]) =>
  mount(ProjectFilesListing, {
    props: {
      files,
      view,
      highlightedFileId: null,
    },
    global: { plugins: [i18n] },
  });

describe('ProjectFilesListing (#116)', () => {
  // The reason the list exists: a build log full of models and datasheets is
  // identified by name, size and date, which the grid hides behind a hover.
  it('shows the identifying columns only in the list', () => {
    expect(render('list').text()).toContain('bracket.stl');
    expect(render('list').text()).toContain('model/stl');
    // The component formats the day itself, in the active locale.
    expect(render('list').text()).toContain(
      new Intl.DateTimeFormat('en').format(new Date(MODEL.createdAt)),
    );

    expect(render('grid').text()).not.toContain('model/stl');
  });

  // `xs` (192 px) was sized for exactly this row and is generated eagerly on
  // upload, so the list costs no backend work.
  it('uses the row-sized rendition in the list and the tile-sized one in the grid', () => {
    expect(render('list').find('img').attributes('src')).toBe(
      '/api/uploads/att_photo?variant=xs',
    );
    expect(render('grid').find('img').attributes('src')).toBe(
      '/api/uploads/att_photo?variant=sm',
    );
  });

  it('keeps every action available in both views', () => {
    for (const view of ['grid', 'list'] as const) {
      const wrapper = render(view);
      const labels = wrapper
        .findAll('button, a')
        .map((el) => el.attributes('aria-label') ?? '');

      expect(labels).toContain('Download');
      expect(labels).toContain('Delete file');
      expect(labels.some((label) => label.includes('cover'))).toBe(true);
    }
  });

  it('emits the gestures rather than acting on them', async () => {
    const wrapper = render('list');

    await wrapper
      .findAll('button, a')
      .find((el) => el.attributes('aria-label') === 'Download')
      ?.trigger('click');
    expect(wrapper.emitted('download')?.[0]).toEqual([PHOTO]);

    await wrapper
      .findAll('button')
      .find((el) => el.attributes('aria-label') === 'Delete file')
      ?.trigger('click');
    expect(wrapper.emitted('remove')?.[0]).toEqual(['att_photo']);
  });

  it('opens the viewer from a list thumbnail too', async () => {
    const wrapper = render('list');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual([PHOTO]);
  });

  // Drag-out to the desktop and onto the chat composer (#109/#112) must survive
  // the second rendering — it is the affordance most easily lost in a rewrite.
  it('keeps rows draggable in the list', async () => {
    const wrapper = render('list');
    const draggables = wrapper.findAll('[draggable="true"]');
    expect(draggables).toHaveLength(2);

    await draggables[0].trigger('dragstart');
    expect(wrapper.emitted('dragstart')).toBeTruthy();
  });

  // A header strip of styled spans looks like columns but is announced as
  // nothing; real headers travel with their cells to a screen reader.
  it('announces the list columns as table headers', () => {
    const headers = render('list')
      .findAll('th[scope="col"]')
      .map((el) => el.text());
    expect(headers).toEqual([
      'Preview',
      'Name',
      'Type',
      'Size',
      'Added',
      'Actions',
    ]);
    expect(render('list').findAll('tbody tr')).toHaveLength(2);
  });

  // Only images can be a cover; offering it on an STL would be a dead control.
  it('offers the cover pin for images only', () => {
    const labels = render('list', [MODEL])
      .findAll('button')
      .map((el) => el.attributes('aria-label') ?? '');
    expect(labels.some((label) => label.includes('cover'))).toBe(false);
  });
});
