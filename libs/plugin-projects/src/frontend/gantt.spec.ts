import { describe, expect, it } from 'vitest';
import {
  fitGanttWindow,
  ganttTicks,
  gridStepFor,
  isBarVisible,
  isGanttScale,
  panWindow,
  placeBar,
  resolveGanttBar,
  scaleForWindow,
  todayPct,
  windowDays,
  wheelIntent,
  WHEEL_ZOOM_STEP,
  KEY_ZOOM_STEP,
  windowForScale,
  zoomWindow,
  type GanttProjectInput,
} from './gantt';

const NOW = new Date('2026-08-18T12:00:00.000Z');

function project(over: Partial<GanttProjectInput> = {}): GanttProjectInput {
  return {
    id: 'proj_1',
    title: 'Корпус v2',
    status: 'IN_PROGRESS',
    groupId: 'grp_1',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    startDate: '2026-04-10T00:00:00.000Z',
    dueDate: '2026-08-30T00:00:00.000Z',
    completedAt: null,
    tasksCount: 12,
    completedTasksCount: 6,
    ...over,
  };
}

describe('resolveGanttBar — edges', () => {
  it('uses both stated dates when they exist', () => {
    const bar = resolveGanttBar(project(), NOW);
    expect(bar.start.toISOString()).toBe('2026-04-10T00:00:00.000Z');
    expect(bar.end.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(bar.startSource).toBe('stated');
    expect(bar.endSource).toBe('stated');
  });

  it('falls back to createdAt for a missing start, and marks it inferred', () => {
    const bar = resolveGanttBar(project({ startDate: null }), NOW);
    expect(bar.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(bar.startSource).toBe('inferred');
  });

  it('runs an open project with no due date to today, as an open edge', () => {
    const bar = resolveGanttBar(project({ dueDate: null }), NOW);
    expect(bar.end).toEqual(NOW);
    expect(bar.endSource).toBe('open');
  });

  it('ends a closed project at completedAt, not at today', () => {
    const bar = resolveGanttBar(
      project({
        status: 'COMPLETED',
        dueDate: null,
        completedAt: '2026-06-14T00:00:00.000Z',
      }),
      NOW,
    );
    expect(bar.end.toISOString()).toBe('2026-06-14T00:00:00.000Z');
    expect(bar.endSource).toBe('stated');
  });

  it('prefers completedAt over a due date that was never met', () => {
    const bar = resolveGanttBar(
      project({
        status: 'COMPLETED',
        dueDate: '2026-05-01T00:00:00.000Z',
        completedAt: '2026-07-20T00:00:00.000Z',
      }),
      NOW,
    );
    expect(bar.end.toISOString()).toBe('2026-07-20T00:00:00.000Z');
  });

  // The pre-#294 row: closed long ago, no stamp, no dates. It must not claim to
  // still be running — that was the whole reason the column exists.
  it('falls back to updatedAt for a closed project with no stamp, marked inferred', () => {
    const bar = resolveGanttBar(
      project({
        status: 'COMPLETED',
        startDate: null,
        dueDate: null,
        completedAt: null,
      }),
      NOW,
    );
    expect(bar.end.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(bar.endSource).toBe('inferred');
    expect(bar.startSource).toBe('inferred');
  });

  // A deadline is when the work was MEANT to end; for a closed project with no
  // stamp it is a guess at when it did, and must read as one.
  it('marks a closed project ended at its due date as inferred', () => {
    const bar = resolveGanttBar(
      project({
        status: 'COMPLETED',
        dueDate: '2026-05-01T00:00:00.000Z',
        completedAt: null,
      }),
      NOW,
    );
    expect(bar.end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(bar.endSource).toBe('inferred');
  });

  // A running project whose deadline has passed is still running. Ending its
  // bar at the missed date would draw it as finished — the one thing it is not.
  it('runs an overdue open project to today, as an open edge', () => {
    const bar = resolveGanttBar(
      project({ dueDate: '2026-05-01T00:00:00.000Z' }),
      NOW,
    );
    expect(bar.end).toEqual(NOW);
    expect(bar.endSource).toBe('open');
  });

  it('never renders inside-out when the due date precedes the start', () => {
    const bar = resolveGanttBar(
      project({
        startDate: '2026-12-01T00:00:00.000Z',
        dueDate: '2026-10-01T00:00:00.000Z',
      }),
      NOW,
    );
    expect(bar.end.getTime()).toBe(bar.start.getTime());
  });

  it('survives an unparseable date instead of producing NaN geometry', () => {
    const bar = resolveGanttBar(project({ startDate: 'not-a-date' }), NOW);
    expect(Number.isNaN(bar.start.getTime())).toBe(false);
    expect(bar.startSource).toBe('inferred');
  });
});

describe('resolveGanttBar — task counts', () => {
  // Carried on the bar so the tooltip never has to scan the project list back.
  it('carries the task counts the tooltip reads', () => {
    const bar = resolveGanttBar(project(), NOW);
    expect(bar.tasksDone).toBe(6);
    expect(bar.tasksTotal).toBe(12);
  });
});

describe('resolveGanttBar — progress', () => {
  it('is the closed share of the tasks', () => {
    expect(resolveGanttBar(project(), NOW).progress).toBe(0.5);
  });

  it('is zero for a project with no tasks at all', () => {
    const bar = resolveGanttBar(
      project({ tasksCount: 0, completedTasksCount: 0 }),
      NOW,
    );
    expect(bar.progress).toBe(0);
  });
});

describe('fitGanttWindow', () => {
  it('frames every bar with a margin on both sides', () => {
    const bars = [
      resolveGanttBar(project(), NOW),
      resolveGanttBar(
        project({
          id: 'proj_2',
          startDate: '2026-05-15T00:00:00.000Z',
          dueDate: '2026-10-31T00:00:00.000Z',
        }),
        NOW,
      ),
    ];
    const window = fitGanttWindow(bars, NOW);
    expect(window.from.getTime()).toBeLessThan(bars[0].start.getTime());
    expect(window.to.getTime()).toBeGreaterThan(bars[1].end.getTime());
  });

  it('keeps today framed even when every project ended long ago', () => {
    const bars = [
      resolveGanttBar(
        project({
          status: 'COMPLETED',
          startDate: '2025-01-01T00:00:00.000Z',
          dueDate: '2025-03-01T00:00:00.000Z',
          completedAt: '2025-02-20T00:00:00.000Z',
        }),
        NOW,
      ),
    ];
    expect(fitGanttWindow(bars, NOW).to.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
  });

  it('returns a usable window for an empty set instead of a zero-width axis', () => {
    const window = fitGanttWindow([], NOW);
    expect(windowDays(window)).toBeGreaterThan(0);
  });
});

describe('windowForScale', () => {
  it('centres the remembered length on today, so it can never go stale', () => {
    const window = windowForScale('quarter', NOW);
    expect(Math.round(windowDays(window))).toBe(91);
    const mid = (window.from.getTime() + window.to.getTime()) / 2;
    expect(mid).toBe(NOW.getTime());
  });
});

describe('gridStepFor', () => {
  it.each([
    ['month', 'day'],
    ['quarter', 'week'],
    ['year', 'month'],
  ] as const)('picks %s → %s', (scale, step) => {
    expect(gridStepFor(windowForScale(scale, NOW))).toBe(step);
  });

  it('drops to quarters once the window passes a year and a half', () => {
    const window = {
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(gridStepFor(window)).toBe('quarter');
  });
});

describe('placeBar', () => {
  const window = {
    from: new Date('2026-04-01T00:00:00.000Z'),
    to: new Date('2026-12-01T00:00:00.000Z'),
  };

  it('positions a fully contained bar as a percentage of the window', () => {
    const bar = resolveGanttBar(project(), NOW);
    const place = placeBar(bar, window);
    expect(place.leftPct).toBeGreaterThan(0);
    expect(place.leftPct + place.widthPct).toBeLessThan(100);
    expect(place.clippedStart).toBe(false);
    expect(place.clippedEnd).toBe(false);
  });

  it('clamps a bar that starts before the window and reports the cut', () => {
    const bar = resolveGanttBar(
      project({
        startDate: '2025-01-01T00:00:00.000Z',
        dueDate: '2026-06-01T00:00:00.000Z',
      }),
      NOW,
    );
    const place = placeBar(bar, window);
    expect(place.leftPct).toBe(0);
    expect(place.clippedStart).toBe(true);
    expect(place.clippedEnd).toBe(false);
  });

  it('never returns geometry outside the canvas', () => {
    const bar = resolveGanttBar(
      project({
        startDate: '2020-01-01T00:00:00.000Z',
        dueDate: '2030-01-01T00:00:00.000Z',
      }),
      NOW,
    );
    const place = placeBar(bar, window);
    expect(place.leftPct).toBe(0);
    expect(place.widthPct).toBe(100);
  });

  it('reports a bar outside the window as invisible rather than placing it', () => {
    const bar = resolveGanttBar(
      project({
        status: 'COMPLETED',
        startDate: '2020-01-01T00:00:00.000Z',
        dueDate: '2020-03-01T00:00:00.000Z',
        completedAt: '2020-02-01T00:00:00.000Z',
      }),
      NOW,
    );
    expect(isBarVisible(bar, window)).toBe(false);
  });
});

describe('todayPct', () => {
  it('locates today inside the window', () => {
    const pct = todayPct(
      {
        from: new Date('2026-08-17T12:00:00.000Z'),
        to: new Date('2026-08-19T12:00:00.000Z'),
      },
      NOW,
    );
    expect(pct).toBeCloseTo(50, 5);
  });

  it('returns null when today is off the window, so no line is drawn', () => {
    const pct = todayPct(
      {
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2020-06-01T00:00:00.000Z'),
      },
      NOW,
    );
    expect(pct).toBeNull();
  });
});

describe('ganttTicks', () => {
  it('lands month ticks on the first of each month', () => {
    const ticks = ganttTicks(
      {
        from: new Date(2026, 3, 15),
        to: new Date(2026, 7, 15),
      },
      'month',
    );
    expect(ticks.length).toBe(4);
    for (const tick of ticks) expect(tick.date.getDate()).toBe(1);
  });

  it('starts week ticks on a Monday', () => {
    const ticks = ganttTicks(
      { from: new Date(2026, 3, 15), to: new Date(2026, 4, 15) },
      'week',
    );
    for (const tick of ticks) expect(tick.date.getDay()).toBe(1);
  });

  it('never emits a tick before the window starts', () => {
    const from = new Date(2026, 3, 15);
    const ticks = ganttTicks({ from, to: new Date(2026, 7, 15) }, 'month');
    for (const tick of ticks) {
      expect(tick.date.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(tick.pct).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns nothing for an inverted window instead of looping', () => {
    expect(
      ganttTicks(
        { from: new Date(2026, 7, 1), to: new Date(2026, 3, 1) },
        'month',
      ),
    ).toEqual([]);
  });
});

describe('zoomWindow', () => {
  it('keeps the date under the pointer fixed while zooming in', () => {
    const window = {
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2027-01-01T00:00:00.000Z'),
    };
    const anchorBefore =
      window.from.getTime() +
      (window.to.getTime() - window.from.getTime()) * 0.25;
    const zoomed = zoomWindow(window, 0.5, 25);
    const anchorAfter =
      zoomed.from.getTime() +
      (zoomed.to.getTime() - zoomed.from.getTime()) * 0.25;
    expect(anchorAfter).toBeCloseTo(anchorBefore, -3);
    expect(windowDays(zoomed)).toBeCloseTo(windowDays(window) / 2, 5);
  });

  it('refuses to zoom past a single day', () => {
    let window = windowForScale('month', NOW);
    for (let i = 0; i < 40; i++) window = zoomWindow(window, 0.5, 50);
    expect(windowDays(window)).toBeGreaterThanOrEqual(1);
  });

  it('refuses to zoom out past forty years', () => {
    let window = windowForScale('month', NOW);
    for (let i = 0; i < 60; i++) window = zoomWindow(window, 2, 50);
    expect(windowDays(window)).toBeLessThanOrEqual(40 * 365 + 1);
  });
});

describe('zoom sensitivity', () => {
  // The step is multiplicative, so halving the FEEL means the square root:
  // two notches must land where one old 1.15 notch did.
  it('takes two wheel notches to cover one of the old steps', () => {
    const start = windowForScale('year', NOW);
    const twice = zoomWindow(
      zoomWindow(start, WHEEL_ZOOM_STEP, 50),
      WHEEL_ZOOM_STEP,
      50,
    );

    expect(windowDays(twice) / windowDays(start)).toBeCloseTo(1.15, 2);
  });

  it('zooms in and out by exactly reciprocal amounts', () => {
    const start = windowForScale('year', NOW);
    const there = zoomWindow(start, WHEEL_ZOOM_STEP, 50);
    const back = zoomWindow(there, 1 / WHEEL_ZOOM_STEP, 50);

    expect(windowDays(back)).toBeCloseTo(windowDays(start), 6);
  });

  // A key press is a deliberate discrete act, so it keeps the larger step.
  it('keeps the keyboard step coarser than the wheel step', () => {
    expect(KEY_ZOOM_STEP).toBeGreaterThan(WHEEL_ZOOM_STEP);
  });
});

describe('panWindow', () => {
  it('shifts by a fraction of the window and keeps its length', () => {
    const window = windowForScale('quarter', NOW);
    const panned = panWindow(window, 50);
    expect(windowDays(panned)).toBeCloseTo(windowDays(window), 5);
    expect(panned.from.getTime()).toBeGreaterThan(window.from.getTime());
  });
});

describe('scaleForWindow', () => {
  it.each(['month', 'quarter', 'half', 'year'] as const)(
    'round-trips the %s scale after a free-form zoom',
    (scale) => {
      expect(scaleForWindow(windowForScale(scale, NOW))).toBe(scale);
    },
  );

  it('calls anything wider than a year and a half "all"', () => {
    expect(
      scaleForWindow({
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toBe('all');
  });
});

describe('wheelIntent', () => {
  const wheel = (deltaX: number, deltaY: number, ctrlKey = false) => ({
    deltaX,
    deltaY,
    ctrlKey,
  });

  it('reads a clean sideways swipe as a pan', () => {
    expect(wheelIntent(wheel(40, 0), null)).toBe('pan');
    expect(wheelIntent(wheel(-40, 3), null)).toBe('pan');
  });

  it('reads a mouse wheel as a zoom', () => {
    expect(wheelIntent(wheel(0, 120), null)).toBe('zoom');
  });

  // The whole point: a swipe that drifts must not become a zoom. A slight
  // vertical lead is drift, not intent.
  it('does not zoom on a barely-vertical event', () => {
    expect(wheelIntent(wheel(10, 12), null)).toBeNull();
    expect(wheelIntent(wheel(10, 19), null)).toBeNull();
  });

  it('zooms only on a clear vertical majority', () => {
    expect(wheelIntent(wheel(10, 21), null)).toBe('zoom');
  });

  it('keeps following the lock even when an event says otherwise', () => {
    expect(wheelIntent(wheel(2, 90), 'pan')).toBe('pan');
    expect(wheelIntent(wheel(90, 2), 'zoom')).toBe('zoom');
  });

  // A pinch is unambiguous on every device and outranks a stale pan lock.
  it('lets a pinch override the lock', () => {
    expect(wheelIntent(wheel(0, 8, true), 'pan')).toBe('zoom');
  });

  it('decides nothing about an event with no travel', () => {
    expect(wheelIntent(wheel(0, 0), null)).toBeNull();
  });

  // A recorded trackpad swipe: leads horizontally, drifts through the middle,
  // trails off. Not one frame of it may be classified as a zoom.
  it('never zooms anywhere inside a realistic sideways swipe', () => {
    const burst = [
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
    ] as const;
    let lock: ReturnType<typeof wheelIntent> = null;
    const seen: (string | null)[] = [];
    for (const [dx, dy] of burst) {
      const intent = wheelIntent(wheel(dx, dy), lock);
      if (intent !== null) lock = intent;
      seen.push(intent);
    }
    expect(seen).not.toContain('zoom');
    expect(lock).toBe('pan');
  });
});

describe('isGanttScale', () => {
  it('accepts the known scales and rejects a stale stored value', () => {
    expect(isGanttScale('quarter')).toBe(true);
    expect(isGanttScale('fortnight')).toBe(false);
  });
});
