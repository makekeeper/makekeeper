import { mount, RouterLinkStub } from '@vue/test-utils';
import SectionNav from './SectionNav.vue';
import Tooltip from './Tooltip.vue';

// The picker is navigation, and it is the only thing that can speak for a
// section that is not open — both properties are asserted here because both
// were the point of introducing it (#262).
const items = [
  {
    key: 'connect',
    label: 'Connect',
    to: '/x?section=connect',
    badge: 2,
    badgeLabel: '2 waiting',
  },
  { key: 'tokens', label: 'Tokens', to: '/x?section=tokens', badge: 0 },
];

const render = (activeKey: string) =>
  mount(SectionNav, {
    props: { items, activeKey, ariaLabel: 'Sections' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });

describe('SectionNav', () => {
  it('renders one link per section', () => {
    const links = render('connect').findAllComponents(RouterLinkStub);
    expect(links).toHaveLength(2);
    expect(links[0].props('to')).toBe('/x?section=connect');
  });

  it('marks only the active section as the current page', () => {
    const links = render('tokens').findAllComponents(RouterLinkStub);
    expect(links[0].attributes('aria-current')).toBeUndefined();
    expect(links[1].attributes('aria-current')).toBe('page');
  });

  it('shows a count for a section that wants attention, and no zero', () => {
    const text = render('tokens').text();
    expect(text).toContain('2');
    expect(text).not.toContain('0');
  });

  it('says what the count means, for a reader that cannot see it', () => {
    // A bare number beside a label is announced as "Connect 2"; the meaning
    // travels in a screen-reader-only span next to it.
    const sr = render('tokens').find('.sr-only');
    expect(sr.exists()).toBe(true);
    expect(sr.text()).toBe('2 waiting');
  });

  it('says it on hover too — a bare number is opaque to everyone', () => {
    // The screen-reader span left sighted users guessing: the first question
    // asked about the agent-capabilities picker was what its "1" meant. The
    // chip is wrapped in the shared Tooltip rather than a native `title`,
    // which the strip below `lg` would also have clipped nothing of — but a
    // browser tooltip is not a surface this design system controls.
    const tip = render('tokens').findComponent(Tooltip);
    expect(tip.exists()).toBe(true);
    expect(tip.props('text')).toBe('2 waiting');
  });
});
