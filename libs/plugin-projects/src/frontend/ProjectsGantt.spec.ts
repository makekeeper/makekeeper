import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import ProjectsGantt from './ProjectsGantt.vue';
import type { ProjectSummary } from './shared';
import en from '../i18n/en.json';

// The gestures, wired end to end through the component.
//
// `gantt.spec.ts` proves the geometry; this proves the component actually calls
// it — a wheel that zooms nothing, a drag that pans nothing and a keyboard that
// does neither are all invisible to that suite. What is NOT covered here is
// anything needing real layout (sticky columns, overflow, pixel widths): jsdom
// has no layout engine, so those belong in a browser run.

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p1',
  title: 'Robot arm',
  description: '',
  status: 'IN_PROGRESS',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  startDate: '2026-04-10T00:00:00.000Z',
  dueDate: '2026-08-30T00:00:00.000Z',
  completedAt: null,
  position: 0,
  groupId: 'g1',
  coverUrl: null,
  tasksCount: 4,
  completedTasksCount: 2,
  componentsCount: 0,
  actualBudget: 0,
  ...over,
});

async function mountGantt(
  projects: ProjectSummary[] = [project()],
): Promise<VueWrapper> {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/projects/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return mount(ProjectsGantt, {
    props: { projects },
    global: { plugins: [i18n, router] },
  });
}

// The canvas measures itself before acting on a gesture, and jsdom reports
// every box as zero-sized — which is indistinguishable from "the canvas is not
// on screen", the case the handlers deliberately bail out of. Give it a size.
beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  // The canvas fits its window around TODAY, so every geometry assertion below
  // silently depends on the calendar: written against a live clock, this suite
  // passed in August and failed CI in September without a line changing. Only
  // `Date` is faked — the wheel's idle lock needs real timers, and one test
  // fakes them itself.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 1000,
    height: 40,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 40,
    toJSON: () => ({}),
  });
  // Pointer capture is not implemented in jsdom; the drag only needs it not to throw.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

// Dispatched as real DOM events rather than through `trigger`: test-utils
// builds the event object itself and cannot set `clientX` on it, and the
// pointer position is the whole input to a zoom anchor and a pan delta.
async function fire(
  wrapper: VueWrapper,
  type: string,
  init: MouseEventInit & { deltaY?: number },
): Promise<void> {
  const element = wrapper.find('[role="group"]').element;
  const event =
    type === 'wheel'
      ? new WheelEvent(type, { bubbles: true, cancelable: true, ...init })
      : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await nextTick();
}

const barStyle = (wrapper: VueWrapper): string =>
  wrapper.find('a[aria-label]').attributes('style') ?? '';

describe('the timeline canvas', () => {
  // Read from the bar and not from the axis: the axis labels only move when a
  // notch happens to cross a tick boundary, and the window is fitted around
  // TODAY — so the same one-notch zoom changed the labels when this was written
  // and stopped changing them weeks later, failing CI on a calendar date rather
  // than on a code change. The bar's geometry follows the window continuously.
  it('zooms on the wheel and remembers the scale it landed on', async () => {
    const wrapper = await mountGantt();
    const before = barStyle(wrapper);

    await fire(wrapper, 'wheel', { deltaY: -600, clientX: 500 });

    expect(barStyle(wrapper)).not.toBe(before);
    expect(localStorage.getItem('projects.gantt.scale')).not.toBeNull();
  });

  it('zooms out as well as in', async () => {
    const wrapper = await mountGantt();
    await fire(wrapper, 'wheel', { deltaY: -600, clientX: 500 });
    const zoomedIn = localStorage.getItem('projects.gantt.scale');
    for (let i = 0; i < 10; i++) {
      await fire(wrapper, 'wheel', { deltaY: 600, clientX: 500 });
    }

    expect(localStorage.getItem('projects.gantt.scale')).not.toBe(zoomedIn);
  });

  // A trackpad swiped sideways sends deltaX with deltaY ≈ 0. Read as a zoom it
  // drifts one way at every flick, which is what it did before this test.
  it('pans on a horizontal trackpad swipe instead of zooming', async () => {
    const wrapper = await mountGantt();
    const beforeBar = barStyle(wrapper);

    await fire(wrapper, 'wheel', { deltaX: 200, deltaY: 0, clientX: 500 });

    expect(barStyle(wrapper)).not.toBe(beforeBar);
    // A pan is not a zoom, so it must not rewrite the remembered scale.
    expect(localStorage.getItem('projects.gantt.scale')).toBeNull();
  });

  it('swipes the two directions opposite ways', async () => {
    const left = await mountGantt();
    await fire(left, 'wheel', { deltaX: -200, deltaY: 0, clientX: 500 });
    const right = await mountGantt();
    await fire(right, 'wheel', { deltaX: 200, deltaY: 0, clientX: 500 });

    expect(barStyle(left)).not.toBe(barStyle(right));
  });

  // An unprevented horizontal wheel is taken by the browser as back/forward.
  it('claims every wheel gesture so the browser cannot navigate away', async () => {
    const wrapper = await mountGantt();
    const element = wrapper.find('[role="group"]').element;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 200,
      deltaY: 0,
    });
    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a wheel event that carries no travel at all', async () => {
    const wrapper = await mountGantt();
    const before = barStyle(wrapper);

    await fire(wrapper, 'wheel', { deltaX: 0, deltaY: 0, clientX: 500 });

    expect(barStyle(wrapper)).toBe(before);
  });

  // Below the slop threshold the press is a click on the bar, not a pan.
  it('does not pan on a press that barely moves', async () => {
    const wrapper = await mountGantt();
    const before = barStyle(wrapper);

    await fire(wrapper, 'pointerdown', { button: 0, clientX: 500 });
    await fire(wrapper, 'pointermove', { clientX: 498 });
    await fire(wrapper, 'pointerup', { clientX: 498 });

    expect(barStyle(wrapper)).toBe(before);
  });

  // The bug the lock exists for: mid-swipe drift used to flip the gesture into
  // a zoom, so a sideways swipe silently rescaled the axis as it moved.
  it('never zooms during a realistic sideways swipe', async () => {
    const wrapper = await mountGantt();
    const burst: [number, number][] = [
      [12, 0],
      [28, 1],
      [41, -3],
      [38, 9],
      [30, 22],
      [24, 27],
      [18, 20],
      [11, 9],
      [6, 2],
      [2, 0],
    ];

    for (const [deltaX, deltaY] of burst) {
      await fire(wrapper, 'wheel', { deltaX, deltaY, clientX: 500 });
    }

    // A zoom would have written the remembered scale; a pan never does.
    expect(localStorage.getItem('projects.gantt.scale')).toBeNull();
  });

  // After the burst ends, the next gesture is free to be a zoom again.
  it('releases the lock once the gesture has paused', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountGantt();
      await fire(wrapper, 'wheel', { deltaX: 40, deltaY: 0, clientX: 500 });
      expect(localStorage.getItem('projects.gantt.scale')).toBeNull();

      // Still inside the burst: a vertical event follows the pan lock.
      await fire(wrapper, 'wheel', { deltaX: 0, deltaY: 120, clientX: 500 });
      expect(localStorage.getItem('projects.gantt.scale')).toBeNull();

      vi.advanceTimersByTime(400);
      await fire(wrapper, 'wheel', { deltaX: 0, deltaY: 120, clientX: 500 });
      expect(localStorage.getItem('projects.gantt.scale')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A pause is measured from the LAST event, ambiguous frames included.
  it('does not break the lock on a diagonal frame mid-swipe', async () => {
    const wrapper = await mountGantt();
    await fire(wrapper, 'wheel', { deltaX: 40, deltaY: 0, clientX: 500 });
    await fire(wrapper, 'wheel', { deltaX: 10, deltaY: 12, clientX: 500 });
    await fire(wrapper, 'wheel', { deltaX: 4, deltaY: 60, clientX: 500 });

    expect(localStorage.getItem('projects.gantt.scale')).toBeNull();
  });

  it('pans on a primary-button drag', async () => {
    const wrapper = await mountGantt();
    const before = barStyle(wrapper);

    await fire(wrapper, 'pointerdown', { button: 0, clientX: 500 });
    await fire(wrapper, 'pointermove', { clientX: 200 });
    await fire(wrapper, 'pointerup', { clientX: 200 });

    expect(barStyle(wrapper)).not.toBe(before);
  });

  // A right-click belongs to whatever sits under the pointer, not to the canvas.
  it('ignores a non-primary button', async () => {
    const wrapper = await mountGantt();
    const before = barStyle(wrapper);

    await fire(wrapper, 'pointerdown', { button: 2, clientX: 500 });
    await fire(wrapper, 'pointermove', { clientX: 200 });

    expect(barStyle(wrapper)).toBe(before);
  });

  it('pans and zooms from the keyboard, so a wheel is not required', async () => {
    const wrapper = await mountGantt();
    const canvas = wrapper.find('[role="group"]');

    // Zoom first: a pan pushes the bar against the window's edge, where it is
    // clamped and a zoom has nothing left to move it by.
    const start = barStyle(wrapper);
    await canvas.trigger('keydown', { key: '-' });
    expect(barStyle(wrapper)).not.toBe(start);

    const zoomed = barStyle(wrapper);
    await canvas.trigger('keydown', { key: 'ArrowRight' });
    expect(barStyle(wrapper)).not.toBe(zoomed);
  });

  it('leaves keys it does not handle to the page', async () => {
    const wrapper = await mountGantt();
    const canvas = wrapper.find('[role="group"]');
    const before = barStyle(wrapper);

    await canvas.trigger('keydown', { key: 'a' });

    expect(barStyle(wrapper)).toBe(before);
  });
});

describe('the timeline rows', () => {
  // Bars are positioned in percentages with a minimum width, and the open-ended
  // dots hang outside their bar; near the right edge that spilled past the
  // canvas and gave the PAGE a horizontal scrollbar.
  it('clips every canvas cell so no bar can widen the page', async () => {
    const wrapper = await mountGantt([
      project({ dueDate: null }),
      project({ id: 'p2', groupId: 'g2' }),
    ]);
    const cells = wrapper.findAll('.relative.flex-1');

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.classes()).toContain('overflow-hidden');
    }
  });

  it('writes the status beside the name, not only as a colour', async () => {
    const wrapper = await mountGantt([project({ status: 'TESTING' })]);
    expect(wrapper.text()).toContain(en.projects.status.testing);
  });

  // It used to be drawn per row, which left a gap at every group heading (a
  // heading's canvas has no height of its own) and could not join across the
  // row borders either.
  it('draws today as one unbroken line, not one segment per row', async () => {
    const wrapper = await mountGantt([
      project(),
      project({ id: 'p2' }),
      project({ id: 'p3', groupId: 'g2' }),
    ]);
    const lines = wrapper.findAll('[class*="bg-red-500"]');

    expect(lines.length).toBe(1);
    // Full height of the timeline, not of a row.
    expect(lines[0].classes().join(' ')).toContain('top-0');
  });

  it('links each bar to its project', async () => {
    const wrapper = await mountGantt();
    expect(wrapper.find('a[aria-label]').attributes('href')).toBe(
      '/projects/p1',
    );
  });

  // With one group there is nothing to separate; with two there is.
  it('shows group headings only when more than one group is on screen', async () => {
    const single = await mountGantt([project()]);
    expect(single.text()).not.toContain('1');

    const many = await mountGantt([
      project(),
      project({ id: 'p2', groupId: 'g2' }),
    ]);
    expect(many.findAll('a[aria-label]').length).toBe(2);
  });
});
