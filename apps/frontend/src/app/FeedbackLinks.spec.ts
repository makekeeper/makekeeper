import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory, RouterLink } from 'vue-router';
import FeedbackLinks from './FeedbackLinks.vue';
import en from '../i18n/locales/en.json';

// The shell half of the product's route back to us (#342). A Vue template is
// the one part of a change here no other gate checks, and this one carries two
// claims worth holding: both rows lead to About, and a collapsed sidebar keeps
// them named.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/:rest(.*)', component: { template: '<div />' } }],
});

const render = (props: { variant: 'sidebar' | 'menu'; collapsed?: boolean }) =>
  mount(FeedbackLinks, {
    props,
    global: { plugins: [i18n, router] },
  });

describe('FeedbackLinks', () => {
  it('sends both rows to the About page rather than off to GitHub', () => {
    const links = render({ variant: 'sidebar' }).findAllComponents(RouterLink);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.props('to')).toMatchObject({ path: '/settings/about' });
    }
  });

  // The two rows land on one page, so each has to say what it came for or the
  // reader arrives and has to find the button they just pressed.
  it('names the action each row asks for', () => {
    const links = render({ variant: 'sidebar' }).findAllComponents(RouterLink);
    expect(links.map((link) => link.props('to').query.action)).toEqual([
      'bug',
      'idea',
    ]);
  });

  it('names the rows in the expanded sidebar', () => {
    const wrapper = render({ variant: 'sidebar' });
    expect(wrapper.text()).toContain('Report a problem');
    expect(wrapper.text()).toContain('Suggest an improvement');
  });

  // Collapsed, the label is gone from the row and the accessible name has to
  // come from somewhere else — an icon with no name is the classic regression
  // of a collapsing sidebar.
  it('keeps an accessible name when the sidebar is collapsed', () => {
    const wrapper = render({ variant: 'sidebar', collapsed: true });
    expect(wrapper.text()).not.toContain('Report a problem');
    const labels = wrapper
      .findAllComponents(RouterLink)
      .map((link) => link.attributes('aria-label'));
    expect(labels).toEqual(['Report a problem', 'Suggest an improvement']);
  });

  it('titles the block in the avatar menu, where it has neighbours', () => {
    const wrapper = render({ variant: 'menu' });
    expect(wrapper.text()).toContain('Feedback');
    expect(wrapper.findAllComponents(RouterLink)).toHaveLength(2);
  });
});
