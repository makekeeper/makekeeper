// Timeline geometry for the project Gantt (#294).
//
// Every branching decision the view makes lives here as a pure function over
// plain data: which dates a bar actually spans, whether each edge was stated by
// the user or inferred by us, how wide the window is, and which grid step that
// window deserves. The Vue component only turns the numbers into elements — it
// owns no rules, so the rules can be tested without mounting anything.
//
// Two conventions hold throughout:
//   * Dates cross this module as `Date`, never as formatted strings. Month names
//     and day numbers are locale output and belong to the component's `Intl`
//     call, not to a layout function (§5.5).
//   * Positions are percentages of the window, so the canvas can be any width —
//     the same numbers serve the desktop canvas and the narrow one.

import { PROJECT_CLOSED_STATUS } from '../bench';
import type { ProjectStatus } from './shared';

const DAY_MS = 24 * 60 * 60 * 1000;

// Where a bar's edge came from. The view renders `inferred` and `open` softer
// than `stated` — a boundary we derived must never read as one the user set.
export type GanttEdgeSource = 'stated' | 'inferred' | 'open';

// The scale a viewer settles on, remembered between sessions (#294). Only the
// LENGTH is remembered, never the position: a stored absolute window goes stale
// and greets the viewer with empty canvas, whereas a length re-centred on today
// always frames something.
export type GanttScale = 'month' | 'quarter' | 'half' | 'year' | 'all';

export const GANTT_SCALES = [
  'month',
  'quarter',
  'half',
  'year',
  'all',
] as const satisfies readonly GanttScale[];

// Days each fixed scale spans. `all` has no length — it means "fit the data".
const SCALE_DAYS = {
  month: 30,
  quarter: 91,
  half: 182,
  year: 365,
} as const satisfies Record<Exclude<GanttScale, 'all'>, number>;

export function isGanttScale(value: string): value is GanttScale {
  return GANTT_SCALES.some((scale) => scale === value);
}

// The grid the axis is ruled with. Chosen from the window length, never stored:
// a step that outlived the window it was picked for is how axes end up with 400
// day ticks in one screen.
export type GanttGridStep = 'day' | 'week' | 'month' | 'quarter';

// What a bar needs from a project. A structural subset of `ProjectSummary`, so
// the list payload satisfies it as-is and the tests can build one by hand.
export interface GanttProjectInput {
  id: string;
  title: string;
  status: ProjectStatus;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  tasksCount: number;
  completedTasksCount: number;
}

export interface GanttBar {
  id: string;
  title: string;
  status: ProjectStatus;
  groupId: string;
  start: Date;
  end: Date;
  startSource: GanttEdgeSource;
  endSource: GanttEdgeSource;
  // Share of the project's tasks that are closed, 0..1. A project with no tasks
  // is 0, not 1 — nothing done is not everything done.
  progress: number;
  // Carried on the bar rather than looked up again from the project list: the
  // tooltip needs both numbers, and a lookup per hover is a scan per bar.
  tasksDone: number;
  tasksTotal: number;
}

export interface GanttWindow {
  from: Date;
  to: Date;
}

export interface GanttPlacement {
  // Percent of the window, 0..100. Already clamped: a bar running past either
  // edge is cut at the edge rather than overflowing the canvas.
  leftPct: number;
  widthPct: number;
  // True when the bar continues beyond the window on that side, so the view can
  // render a cut rather than a terminus.
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface GanttTick {
  date: Date;
  pct: number;
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Resolves one project into the bar the canvas draws.
//
// Left edge: `startDate` when stated, otherwise `createdAt` — which always
// exists, so a project is never a blank row waiting for data entry.
//
// Right edge depends on whether the project is closed:
//   * closed → `completedAt` (the fact, stated), else `dueDate`, else
//     `updatedAt` — both fallbacks are INFERRED. A deadline is when the work was
//     meant to end, not when it did; rows that closed before #294 have no stored
//     completion, and the view must not draw either guess as a stated boundary.
//   * open   → `dueDate` when it is still ahead, otherwise `now` with an `open`
//     edge. An unset — or already missed — deadline leaves the project running:
//     a bar that stopped in the past would read as finished, which is the one
//     thing an open project is not.
export function resolveGanttBar(
  project: GanttProjectInput,
  now: Date,
): GanttBar {
  const created = parseDate(project.createdAt) ?? now;
  const stated = parseDate(project.startDate);
  const start = stated ?? created;
  const startSource: GanttEdgeSource = stated ? 'stated' : 'inferred';

  const due = parseDate(project.dueDate);
  const isClosed = project.status === PROJECT_CLOSED_STATUS;

  let end: Date;
  let endSource: GanttEdgeSource;
  if (isClosed) {
    const completed = parseDate(project.completedAt);
    if (completed) {
      end = completed;
      endSource = 'stated';
    } else {
      end = due ?? parseDate(project.updatedAt) ?? created;
      endSource = 'inferred';
    }
  } else if (due && due.getTime() >= now.getTime()) {
    end = due;
    endSource = 'stated';
  } else {
    end = now;
    endSource = 'open';
  }

  // Nothing validates `startDate <= dueDate` on the way in, so a backwards pair
  // reaches us intact. A bar of negative width would render inside-out; collapse
  // it onto its start instead and let the dates in the tooltip tell the truth.
  if (end.getTime() < start.getTime()) end = start;

  const progress =
    project.tasksCount === 0
      ? 0
      : project.completedTasksCount / project.tasksCount;

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    groupId: project.groupId,
    start,
    end,
    startSource,
    endSource,
    progress,
    tasksDone: project.completedTasksCount,
    tasksTotal: project.tasksCount,
  };
}

// The window that frames every bar, with a margin so no bar touches the edge.
// An empty set still returns a usable window (a month around today) — an axis
// with no extent cannot be rendered, and "no projects" is the empty state's job
// to explain, not the axis's.
export function fitGanttWindow(
  bars: readonly GanttBar[],
  now: Date,
): GanttWindow {
  if (bars.length === 0) return windowForScale('month', now);

  let min = bars[0].start.getTime();
  let max = bars[0].end.getTime();
  for (const bar of bars) {
    min = Math.min(min, bar.start.getTime());
    max = Math.max(max, bar.end.getTime());
  }
  // An open-ended project runs past today; keep today framed either way.
  max = Math.max(max, now.getTime());

  // 4% of the span on each side, floored at a day so a single-day set still
  // gets breathing room instead of a zero-width window.
  const pad = Math.max(DAY_MS, (max - min) * 0.04);
  return { from: new Date(min - pad), to: new Date(max + pad) };
}

// A window of the remembered length, centred on today. `all` has no length of
// its own — the caller falls back to `fitGanttWindow`.
export function windowForScale(
  scale: Exclude<GanttScale, 'all'>,
  now: Date,
): GanttWindow {
  const half = (SCALE_DAYS[scale] * DAY_MS) / 2;
  return {
    from: new Date(now.getTime() - half),
    to: new Date(now.getTime() + half),
  };
}

export function windowDays(window: GanttWindow): number {
  return (window.to.getTime() - window.from.getTime()) / DAY_MS;
}

// Grid step for a window length. The thresholds are the points where the finer
// step stops fitting readable labels — roughly 45 ticks across the canvas.
export function gridStepFor(window: GanttWindow): GanttGridStep {
  const days = windowDays(window);
  if (days <= 45) return 'day';
  if (days <= 120) return 'week';
  if (days <= 550) return 'month';
  return 'quarter';
}

// Places a bar inside the window, clamped to it. Both flags report a real cut,
// so a bar that merely ends at the edge is not mistaken for one running past it.
export function placeBar(bar: GanttBar, window: GanttWindow): GanttPlacement {
  const from = window.from.getTime();
  const span = window.to.getTime() - from;
  if (span <= 0) {
    return { leftPct: 0, widthPct: 0, clippedStart: false, clippedEnd: false };
  }

  const rawStart = bar.start.getTime();
  const rawEnd = bar.end.getTime();
  const start = Math.max(rawStart, from);
  const end = Math.min(rawEnd, window.to.getTime());

  // Entirely outside the window — the caller drops the row rather than drawing
  // a zero-width sliver pinned to an edge it never reaches.
  if (end < start) {
    return { leftPct: 0, widthPct: 0, clippedStart: false, clippedEnd: false };
  }

  return {
    leftPct: ((start - from) / span) * 100,
    widthPct: ((end - start) / span) * 100,
    clippedStart: rawStart < from,
    clippedEnd: rawEnd > window.to.getTime(),
  };
}

export function isBarVisible(bar: GanttBar, window: GanttWindow): boolean {
  return (
    bar.end.getTime() >= window.from.getTime() &&
    bar.start.getTime() <= window.to.getTime()
  );
}

// Where today sits in the window, or null when today is outside it — the view
// draws no line rather than pinning one to an edge day it does not mark.
export function todayPct(window: GanttWindow, now: Date): number | null {
  const from = window.from.getTime();
  const span = window.to.getTime() - from;
  if (span <= 0) return null;
  const pct = ((now.getTime() - from) / span) * 100;
  return pct < 0 || pct > 100 ? null : pct;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function advance(date: Date, step: GanttGridStep): Date {
  switch (step) {
    case 'day':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    case 'week':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() + 1, 1);
    case 'quarter':
      return new Date(date.getFullYear(), date.getMonth() + 3, 1);
  }
}

// The first tick at or before the window start, so the grid lands on natural
// boundaries (the 1st of a month, a Monday) instead of on the window's edge.
function firstTick(window: GanttWindow, step: GanttGridStep): Date {
  const from = window.from;
  switch (step) {
    case 'day':
      return startOfDay(from);
    case 'week': {
      const day = startOfDay(from);
      // ISO weeks: Monday is the boundary, and JS Sunday (0) is 6 days in.
      const shift = (day.getDay() + 6) % 7;
      return new Date(day.getFullYear(), day.getMonth(), day.getDate() - shift);
    }
    case 'month':
      return new Date(from.getFullYear(), from.getMonth(), 1);
    case 'quarter':
      return new Date(
        from.getFullYear(),
        Math.floor(from.getMonth() / 3) * 3,
        1,
      );
  }
}

// Grid ticks across the window. Ticks before the window start are dropped after
// the boundary snap — the snap exists to align the rhythm, not to draw outside.
export function ganttTicks(
  window: GanttWindow,
  step: GanttGridStep,
): GanttTick[] {
  const from = window.from.getTime();
  const span = window.to.getTime() - from;
  if (span <= 0) return [];

  const ticks: GanttTick[] = [];
  let cursor = firstTick(window, step);
  // A hard ceiling: a corrupt window must not spin the loop forever.
  for (let guard = 0; guard < 1000; guard++) {
    if (cursor.getTime() > window.to.getTime()) break;
    if (cursor.getTime() >= from) {
      ticks.push({
        date: cursor,
        pct: ((cursor.getTime() - from) / span) * 100,
      });
    }
    cursor = advance(cursor, step);
  }
  return ticks;
}

// ── Wheel intent ──────────────────────────────────────────────────────────
//
// One physical gesture arrives as a burst of wheel events, and on a trackpad a
// sideways swipe is never purely sideways: fingers drift, so individual events
// in the middle of the burst come out vertically dominant. Deciding per event
// therefore flips into a zoom part-way through a pan — which is exactly what a
// naive `|deltaX| > |deltaY|` test does.
//
// Two rules keep a gesture whole:
//   * asymmetric thresholds — panning needs only to lead, zooming needs a clear
//     vertical majority, so drift inside a swipe never reads as a zoom;
//   * a lock — once the burst has been classified, every later event in it
//     follows that classification, whatever its own axis says.
//
// `null` means "not yet decided": an ambiguous first event is skipped rather
// than guessed at, and the next one in the burst decides.
export type WheelIntent = 'pan' | 'zoom';

// How far vertical travel must exceed horizontal before a burst is a zoom.
const ZOOM_DOMINANCE = 2;

export function wheelIntent(
  event: { deltaX: number; deltaY: number; ctrlKey: boolean },
  locked: WheelIntent | null,
): WheelIntent | null {
  // A pinch is unambiguous on every device and outranks any lock: it is the
  // one gesture that means zoom and nothing else.
  if (event.ctrlKey) return 'zoom';
  if (locked !== null) return locked;

  const x = Math.abs(event.deltaX);
  const y = Math.abs(event.deltaY);
  if (x === 0 && y === 0) return null;
  if (x > y) return 'pan';
  if (y > x * ZOOM_DOMINANCE) return 'zoom';
  // Diagonal enough to be either — wait for an event that commits.
  return null;
}

// How much one wheel notch scales the window.
//
// The step is multiplicative, so "half as sensitive" is the square root, not
// half the number: two notches at 1.072 land where one notch at the old 1.15
// did. Trackpads fire far more events per gesture than a mouse does, which is
// what made the old step feel violent under a swipe.
export const WHEEL_ZOOM_STEP = 1.072;

// The keyboard's step is deliberately larger and left alone: a key press is a
// discrete, deliberate act, not a stream, and matching it to the wheel would
// mean holding a key down to get anywhere.
export const KEY_ZOOM_STEP = 1.3;

// How long a burst may pause before the next event counts as a NEW gesture.
// Trackpad bursts fire far faster than this; a deliberate second swipe is
// slower than it.
export const WHEEL_GESTURE_IDLE_MS = 160;

// Zooming keeps the pointer's date under the pointer, the way every map does:
// the window shrinks around `anchorPct` rather than around its own centre.
//
// `factor` < 1 zooms in. The window is held between one day and forty years —
// past those the axis is either a single hour or geological.
const MIN_WINDOW_MS = DAY_MS;
const MAX_WINDOW_MS = 40 * 365 * DAY_MS;

export function zoomWindow(
  window: GanttWindow,
  factor: number,
  anchorPct: number,
): GanttWindow {
  const from = window.from.getTime();
  const span = window.to.getTime() - from;
  const anchor = from + span * (anchorPct / 100);
  const next = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, span * factor));
  const ratio = anchorPct / 100;
  return {
    from: new Date(anchor - next * ratio),
    to: new Date(anchor + next * (1 - ratio)),
  };
}

// Panning by a fraction of the window's own width, so a drag moves the same
// visual distance whatever the zoom.
export function panWindow(window: GanttWindow, byPct: number): GanttWindow {
  const span = window.to.getTime() - window.from.getTime();
  const delta = span * (byPct / 100);
  return {
    from: new Date(window.from.getTime() + delta),
    to: new Date(window.to.getTime() + delta),
  };
}

// The scale bucket a window's length falls into — what gets remembered after a
// free-form wheel zoom, which lands on no named scale of its own.
export function scaleForWindow(window: GanttWindow): GanttScale {
  const days = windowDays(window);
  if (days <= 45) return 'month';
  if (days <= 130) return 'quarter';
  if (days <= 260) return 'half';
  if (days <= 500) return 'year';
  return 'all';
}
