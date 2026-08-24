import { describe, it, expect } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Trash2 } from '@lucide/vue';
import Button from './Button.vue';

describe('Button', () => {
  it('renders slot content and default primary styling', () => {
    const wrapper = mount(Button, { slots: { default: 'Save' } });
    expect(wrapper.text()).toContain('Save');
    expect(wrapper.get('button').classes()).toContain('bg-brand-600');
  });

  it('applies the danger variant classes', () => {
    const wrapper = mount(Button, { props: { variant: 'danger' } });
    expect(wrapper.get('button').classes()).toContain('text-red-600');
  });

  it('is disabled and marked busy while loading', () => {
    const wrapper = mount(Button, { props: { loading: true } });
    const btn = wrapper.get('button');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.attributes('aria-busy')).toBe('true');
  });

  it('forwards aria-label for icon-only usage', () => {
    const wrapper = mount(Button, { props: { ariaLabel: 'Delete' } });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Delete');
  });

  // The media-overlay pair (#117) is the one variant family with no `dark:`
  // counterpart — a photo viewer has no light mode to pair with.
  it('gives the overlay variants a light-on-dark treatment', () => {
    const plain = mount(Button, { props: { variant: 'overlay' } });
    expect(plain.get('button').classes()).toContain('text-white/80');

    const scrim = mount(Button, { props: { variant: 'overlayScrim' } });
    expect(scrim.get('button').classes()).toContain('bg-black/40');
  });

  // The `ai` variant marks an action that calls a model (#212), and wears the
  // registered aurora — the multiuser mode icon's own gradient — rather than
  // one hand-classed at the call site, which is how three recognition buttons
  // would drift apart again. `bg-mode-aurora` is also exactly the kind of class
  // that compiles to nothing if the token is ever dropped from the config,
  // leaving a transparent button rather than an obviously broken one.
  it('wears the registered aurora, not a hand-classed gradient', () => {
    const classes = mount(Button, { props: { variant: 'ai' } })
      .get('button')
      .classes();
    expect(classes).toContain('bg-mode-aurora');
    expect(classes).toContain('text-white');
  });

  it('squares off the icon size and rounds the pill shape', () => {
    const wrapper = mount(Button, { props: { size: 'icon', pill: true } });
    const classes = wrapper.get('button').classes();
    expect(classes).toContain('p-3');
    expect(classes).toContain('rounded-full');
    expect(classes).not.toContain('rounded-xl');
  });

  // A row of per-item actions needs a smaller square than the 44px touch target
  // and a destructive action that does not shout over the row it belongs to.
  // Both used to be hand-classed per view, which is how a text Edit ended up
  // beside a 44px Delete in the same row.
  it('gives icon-sm a tighter square than icon, at a smaller glyph', () => {
    const small = mount(Button, { props: { size: 'icon-sm' } });
    expect(small.get('button').classes()).toContain('p-2');

    const withIcon = mount(Button, {
      props: { size: 'icon-sm', iconLeft: Trash2 },
    });
    expect(withIcon.get('svg').classes()).toContain('w-4');
  });

  it('keeps dangerGhost transparent until hovered, unlike danger', () => {
    const quiet = mount(Button, { props: { variant: 'dangerGhost' } });
    const classes = quiet.get('button').classes();
    expect(classes).toContain('bg-transparent');
    expect(classes).toContain('hover:text-red-600');
    // The loud variant's permanent tint and border are exactly what this drops.
    expect(classes).not.toContain('bg-red-500/10');
    expect(classes).not.toContain('border');
  });

  // #284: the cursor is the one cue that says "this is a control", and it used
  // to arrive from Tailwind's preflight — which knows about `button` and
  // nothing else, leaving the `to`/`href` branches to the user agent.
  it('states its own pointer cursor instead of inheriting one', () => {
    const classes = mount(Button).get('button').classes();
    expect(classes).toContain('cursor-pointer');
    expect(classes).toContain('select-none');
    // The disabled state still overrides it — the variant is emitted after the
    // base utility, so the later rule wins.
    expect(classes).toContain('disabled:cursor-not-allowed');
  });

  it('leaves link with no box to fall back on, unlike ghost', () => {
    const link = mount(Button, { props: { variant: 'link' } }).get('button');
    expect(link.classes()).toContain('text-brand-600');
    expect(link.classes()).toContain('hover:underline');
    // The whole point: a ghost still fills on hover, a link never does.
    expect(link.classes()).not.toContain('hover:bg-slate-100');
    expect(
      mount(Button, { props: { variant: 'ghost' } })
        .get('button')
        .classes(),
    ).toContain('hover:bg-slate-100');
  });
});

// A control that NAVIGATES must be a link — middle-clickable, openable in a new
// tab, announced as a link — without being hand-classed to imitate this button.
describe('Button as a link', () => {
  it('renders a RouterLink when given a destination', async () => {
    const wrapper = mount(Button, {
      props: { to: '/m/inventory/drafts' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(true);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('falls back to a real disabled button, since a disabled link does not exist', () => {
    const wrapper = mount(Button, {
      props: { to: '/somewhere', disabled: true },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });

  // An address outside the SPA (the Swagger docs, #282) is an anchor: the
  // router cannot match it, and it leaves the app, so it opens in a new tab
  // with the opener detached.
  it('renders a safe external anchor for href', () => {
    const anchor = mount(Button, {
      props: { href: 'https://mk.example.com/api/docs' },
    }).get('a');
    expect(anchor.attributes('href')).toBe('https://mk.example.com/api/docs');
    expect(anchor.attributes('target')).toBe('_blank');
    expect(anchor.attributes('rel')).toBe('noopener noreferrer');
    // Still the button's own clothes — no hand-classed imitation.
    expect(anchor.classes()).toContain('bg-brand-600');
  });

  // The branches the preflight never covered (#284): a link wearing the
  // button's clothes has to carry the button's cursor with it.
  it('carries the pointer cursor into both link branches', () => {
    const routerLink = mount(Button, {
      props: { to: '/settings/external' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    }).findComponent(RouterLinkStub);
    expect(routerLink.classes()).toContain('cursor-pointer');

    const anchor = mount(Button, {
      props: { href: 'https://mk.example.com/api/docs' },
    }).get('a');
    expect(anchor.classes()).toContain('cursor-pointer');
  });

  it('keeps a disabled external link a real disabled button', () => {
    const wrapper = mount(Button, {
      props: { href: 'https://mk.example.com/api/docs', disabled: true },
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  // The branch #284 is actually about, in its refused state: a disabled `to`
  // must land on a real disabled button — which is the only element the
  // `disabled:` variant can reach, so it is also what makes the cursor turn
  // back into "not allowed" rather than staying a pointer.
  it('keeps a disabled router link a real disabled button', () => {
    const wrapper = mount(Button, {
      props: { to: '/settings/external', disabled: true },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('to')).toBeUndefined();
    expect(button.classes()).toContain('disabled:cursor-not-allowed');
  });

  // The stub above proves a RouterLink is asked for; only a REAL router proves
  // it survived the asking. It did not (#284): the other branches' attributes
  // were bound to `undefined`, and an `href` of `undefined` does not vanish —
  // it falls through onto the RouterLink and erases the href the router had
  // just computed. Clicking still navigated, so nothing failed loudly; the
  // anchor merely stopped being a link — no middle-click, no "open in new tab",
  // no status bar, and the I-beam cursor of ordinary prose.
  it('keeps the href the router computes, with a real router', async () => {
    const blank = defineComponent({ render: () => h('div') });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: blank },
        { path: '/settings/external', name: 'external', component: blank },
      ],
    });
    await router.push('/');
    await router.isReady();

    const anchor = mount(Button, {
      props: { to: '/settings/external' },
      slots: { default: 'Open External plugins' },
      global: { plugins: [router] },
    }).get('a');
    expect(anchor.attributes('href')).toBe('/settings/external');
    // An in-app destination is a navigation, not a departure.
    expect(anchor.attributes('target')).toBeUndefined();

    await anchor.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('external');
  });
});
