import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Badge from './Badge.vue';

describe('Badge', () => {
  it('maps the destructive tone to the danger palette', () => {
    const wrapper = mount(Badge, {
      props: { tone: 'destructive' },
      slots: { default: 'DESTRUCTIVE' },
    });
    expect(wrapper.text()).toBe('DESTRUCTIVE');
    expect(wrapper.get('span').classes()).toContain('text-red-700');
  });

  it('drops uppercase when disabled', () => {
    const wrapper = mount(Badge, { props: { uppercase: false } });
    expect(wrapper.get('span').classes()).not.toContain('uppercase');
  });
});

// The `label` shape exists because a chip carrying a person's own text — a
// category name — is a different job from a status pill, and was being answered
// with hand-classed spans in two plugins.
describe('the label variant', () => {
  it('is a softer, larger, natural-case chip', () => {
    const classes = mount(Badge, {
      props: { variant: 'label' },
      slots: { default: 'Кнопки и переключатели' },
    })
      .get('span')
      .classes();
    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('text-xs');
    expect(classes).toContain('font-medium');
    expect(classes).not.toContain('rounded-full');
  });

  it('never shouts the data, even when asked to', () => {
    const classes = mount(Badge, {
      props: { variant: 'label', uppercase: true },
    })
      .get('span')
      .classes();
    expect(classes).not.toContain('uppercase');
  });

  it('stays one box when its text wraps', () => {
    // A hand-rolled INLINE pill splits its background and border into one
    // fragment per line — the torn plate a long category name produced. A flex
    // box cannot do that, and max-w-full is what makes it wrap rather than
    // overflow its column.
    const classes = mount(Badge, { props: { variant: 'label' } })
      .get('span')
      .classes();
    expect(classes).toContain('inline-flex');
    expect(classes).toContain('max-w-full');
  });

  it('leaves the status pill exactly as it was', () => {
    const classes = mount(Badge, { slots: { default: 'READ' } })
      .get('span')
      .classes();
    expect(classes).toContain('rounded-full');
    expect(classes).toContain('text-xxs');
    expect(classes).toContain('uppercase');
  });
});

// A tone the component does not know must still look like a badge (#186).
//
// Callers wrote their own tone unions and passed the COLOURS behind the tones
// — `emerald`, `amber`, `red` — which matched no entry, so the badge rendered
// with no colour classes at all and nothing failed anywhere.
describe('unknown tone', () => {
  it('falls back to neutral instead of rendering bare', () => {
    const w = mount(Badge, {
      props: { tone: 'emerald' as never },
      slots: { default: 'Active' },
    });
    expect(w.classes().join(' ')).toContain('bg-slate-100');
  });

  it('still colours a tone it knows', () => {
    const w = mount(Badge, {
      props: { tone: 'success' },
      slots: { default: 'Active' },
    });
    expect(w.classes().join(' ')).toContain('bg-emerald-100');
  });
});
