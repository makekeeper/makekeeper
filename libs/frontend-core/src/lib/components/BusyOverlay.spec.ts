import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import BusyOverlay from './BusyOverlay.vue';

// The nested Spinner names itself through `$t`.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { loading: 'Loading' } } },
});

// The lock exists to stop the person from starting a SECOND thing while the
// first one is still running (#206: two photographs in flight, no way to tell
// which answer belongs to which part). So the two properties worth pinning are
// that it covers the viewport at all, and that it is gone when nothing is
// pending — an overlay that lingers blocks the whole screen for good.

const overlay = (show: boolean) =>
  mount(BusyOverlay, {
    props: { show, label: 'Recognizing' },
    global: { plugins: [i18n], stubs: { teleport: true } },
  });

describe('BusyOverlay', () => {
  it('covers the viewport while its operation runs', () => {
    const classes = overlay(true).get('[role="alertdialog"]').classes();
    expect(classes).toContain('fixed');
    expect(classes).toContain('inset-0');
    expect(classes).toContain('z-overlay');
  });

  it('renders nothing at all when idle', () => {
    expect(overlay(false).find('[role="alertdialog"]').exists()).toBe(false);
  });

  it('announces itself as busy, with the caller’s words', () => {
    const box = overlay(true).get('[role="alertdialog"]');
    expect(box.attributes('aria-busy')).toBe('true');
    expect(box.attributes('aria-modal')).toBe('true');
    // The label is the accessible name AND the visible line: a spinner with no
    // words is a screen that has simply stopped responding.
    expect(box.attributes('aria-label')).toBe('Recognizing');
    expect(box.text()).toContain('Recognizing');
  });
});

// A picture of what is being worked on belongs ABOVE the scrim: mobile intake
// freezes the frame it sent, and a frame you cannot make out answers nothing.
describe('the preview', () => {
  it('shows the image it was given, named by the label', () => {
    const img = mount(BusyOverlay, {
      props: { show: true, label: 'Recognizing', preview: 'data:image/png;,x' },
      global: { plugins: [i18n], stubs: { teleport: true } },
    }).get('img');
    expect(img.attributes('src')).toBe('data:image/png;,x');
    expect(img.attributes('alt')).toBe('Recognizing');
  });

  it('renders no image when there is nothing to show', () => {
    expect(overlay(true).find('img').exists()).toBe(false);
  });
});
