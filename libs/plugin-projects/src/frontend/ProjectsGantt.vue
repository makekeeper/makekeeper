<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { CalendarRange } from '@lucide/vue';
import { EmptyState, Tooltip } from '@makekeeper/frontend-core';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL_KEY,
  PROJECT_STATUS_SOLID,
  useLocaleDate,
  type ProjectStatus,
  type ProjectSummary,
} from './shared';
import { useProjectGroupsStore } from './project-groups-store';
import { useGanttStore } from './gantt-store';
import {
  fitGanttWindow,
  ganttTicks,
  gridStepFor,
  isBarVisible,
  panWindow,
  placeBar,
  resolveGanttBar,
  scaleForWindow,
  todayPct,
  wheelIntent,
  WHEEL_GESTURE_IDLE_MS,
  WHEEL_ZOOM_STEP,
  KEY_ZOOM_STEP,
  windowForScale,
  zoomWindow,
  type GanttBar,
  type GanttPlacement,
  type GanttWindow,
  type WheelIntent,
} from './gantt';

const props = defineProps<{ projects: ProjectSummary[] }>();

const { t, locale } = useI18n();
const formatDate = useLocaleDate();
const groupsStore = useProjectGroupsStore();
const ganttStore = useGanttStore();

// `now` is captured once per mount rather than read per render: a reactive clock
// would make every computed re-run on a timer, and a timeline that re-lays
// itself out mid-hover is worse than one that is a few minutes stale.
const now = new Date();

const bars = computed<GanttBar[]>(() =>
  props.projects.map((project) => resolveGanttBar(project, now)),
);

// The window is state, not a computed: the wheel and the drag write to it. It
// starts from the remembered scale — `all` means "fit whatever is on screen".
//
// A remembered LENGTH can still frame nothing: someone who left the timeline at
// a month opens a workspace whose projects all ran last year and is met by an
// empty canvas. The remembered scale is a preference, not a promise — when it
// shows no bars at all, entry falls back to fitting the data.
const openingWindow = (): GanttWindow => {
  if (ganttStore.scale === 'all') return fitGanttWindow(bars.value, now);
  const scaled = windowForScale(ganttStore.scale, now);
  if (bars.value.length === 0) return scaled;
  return bars.value.some((bar) => isBarVisible(bar, scaled))
    ? scaled
    : fitGanttWindow(bars.value, now);
};

const viewWindow = ref<GanttWindow>(openingWindow());

// Re-fit when the filtered set changes shape, but ONLY while the viewer is on
// the auto scale — once someone has zoomed somewhere deliberately, a changed
// filter must not yank the window out from under them.
watch(
  () => props.projects.map((p) => p.id).join(','),
  () => {
    if (ganttStore.scale === 'all')
      viewWindow.value = fitGanttWindow(bars.value, now);
  },
);

const step = computed(() => gridStepFor(viewWindow.value));
const ticks = computed(() => ganttTicks(viewWindow.value, step.value));
const today = computed(() => todayPct(viewWindow.value, now));

// Tick labels are locale output, so they are formatted here and never stored.
const tickFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      day:
        step.value === 'day' || step.value === 'week' ? 'numeric' : undefined,
      month: step.value === 'day' ? undefined : 'short',
      year: step.value === 'quarter' ? 'numeric' : undefined,
    }),
);

const tickLabel = (date: Date): string => tickFormat.value.format(date);

// ── Rows, grouped ─────────────────────────────────────────────────────────
// The group is the primary axis of the project list since #285, so the timeline
// keeps it. Rows inside a group run by ascending start — the shape people read
// a Gantt for. A project whose group is unknown to the store (still loading, or
// filtered away) lands in a trailing bucket rather than vanishing.
interface GanttRowGroup {
  id: string;
  name: string;
  bars: GanttBar[];
}

const visibleBars = computed<GanttBar[]>(() =>
  bars.value.filter((bar) => isBarVisible(bar, viewWindow.value)),
);

const rowGroups = computed<GanttRowGroup[]>(() => {
  const byGroup = new Map<string, GanttBar[]>();
  for (const bar of visibleBars.value) {
    const list = byGroup.get(bar.groupId);
    if (list) list.push(bar);
    else byGroup.set(bar.groupId, [bar]);
  }

  // Follow the store's own order so the timeline's groups read in the same
  // sequence as the sidebar tree, instead of inventing a second ordering.
  const ordered = groupsStore.groups
    .filter((group) => byGroup.has(group.id))
    .map((group) => ({ id: group.id, name: group.name }));
  const known = new Set(ordered.map((group) => group.id));
  for (const id of byGroup.keys()) {
    if (!known.has(id)) ordered.push({ id, name: '' });
  }

  return ordered.map((group) => ({
    ...group,
    bars: (byGroup.get(group.id) ?? [])
      .slice()
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  }));
});

// With one group left there is nothing to separate — the heading would be a
// full-width rule announcing the only thing on screen.
const showGroupHeadings = computed<boolean>(() => rowGroups.value.length > 1);

// ── Bar presentation ──────────────────────────────────────────────────────
const statusFill = (status: ProjectStatus): string =>
  PROJECT_STATUS_SOLID[status];

const statusLabel = (status: ProjectStatus): string =>
  t(PROJECT_STATUS_LABEL_KEY[status]);

// Placement is resolved ONCE per bar per window, not per attribute: the row
// asks for a left, a width and two clip flags, and recomputing the geometry for
// each of them multiplies the work of a pan by four.
const placements = computed<Map<string, GanttPlacement>>(
  () =>
    new Map(bars.value.map((bar) => [bar.id, placeBar(bar, viewWindow.value)])),
);

const barStyle = (bar: GanttBar): Record<string, string> => {
  const place = placements.value.get(bar.id);
  if (!place) return {};
  return {
    left: `${place.leftPct}%`,
    // A bar thinner than a couple of pixels is invisible; give every bar a
    // floor so a one-day project still has something to hover (#244 taught us
    // this the hard way on the activity heatmap).
    width: `max(0.5rem, ${place.widthPct}%)`,
  };
};

const barClipped = (bar: GanttBar): { start: boolean; end: boolean } => {
  const place = placements.value.get(bar.id);
  return {
    start: place?.clippedStart === true,
    end: place?.clippedEnd === true,
  };
};

// The hover line. Parts are joined by the component, never by a locale value —
// a separator baked into a translation is one half the locales will forget.
const barTooltip = (bar: GanttBar): string => {
  const parts: string[] = [
    `${formatDate(bar.start.toISOString()) ?? ''} — ${
      bar.endSource === 'open'
        ? t('projects.gantt.edge.ongoing')
        : (formatDate(bar.end.toISOString()) ?? '')
    }`,
    t('projects.gantt.tasksDone', {
      done: bar.tasksDone,
      total: bar.tasksTotal,
    }),
  ];
  if (bar.startSource === 'inferred' || bar.endSource === 'inferred') {
    parts.push(t('projects.gantt.edge.inferred'));
  }
  return parts.join(' · ');
};

// ── Zoom & pan ────────────────────────────────────────────────────────────
// Two refs, because the gestures and the measurement have different extents:
// the whole timeline listens (a wheel over the BARS must zoom — that is where
// the pointer naturally sits), while the anchor is measured against the axis
// column alone, which is the only element whose left edge is date zero.
const surface = ref<HTMLElement | null>(null);
const canvas = ref<HTMLElement | null>(null);

// How far the pointer must travel before a press counts as a pan. Below it the
// press is a click on the bar underneath — capturing the pointer any earlier
// swallows the navigation the bar exists for.
const DRAG_SLOP_PX = 4;

// After a free-form zoom the window matches no named scale exactly; remember the
// bucket it landed in, so the next visit opens at a comparable length.
//
// Guarded on a real change: a wheel burst is dozens of events, and each one
// would otherwise be a synchronous `localStorage` write in the middle of a
// gesture — the one thing on this path that can stutter it.
const rememberScale = (): void => {
  const next = scaleForWindow(viewWindow.value);
  if (next !== ganttStore.scale) ganttStore.setScale(next);
};

// A wheel event is three different gestures depending on the device, and
// reading only `deltaY` mistakes two of them for the third:
//
//   * a trackpad swiped sideways sends deltaX with deltaY ≈ 0 — the user means
//     "move through time". Read as a zoom it drifts one way at every flick
//     (`deltaY > 0` is false when deltaY is 0), and left unprevented the
//     browser takes the horizontal overscroll as back/forward navigation.
//   * a pinch arrives as ctrl+deltaY — always a zoom.
//   * a mouse wheel sends deltaY alone — a zoom, as agreed for this screen.
//
// Everything is prevented either way: the timeline owns the gesture, and an
// unprevented horizontal wheel navigates away from the page entirely.
// What the burst currently in progress was classified as, and the timer that
// ends it. Held here rather than in the pure module because it is per-canvas
// mutable state, not a rule.
let wheelLock: WheelIntent | null = null;
let wheelIdle: ReturnType<typeof setTimeout> | null = null;

const releaseWheelLock = (): void => {
  wheelLock = null;
  wheelIdle = null;
};

onBeforeUnmount(() => {
  if (wheelIdle !== null) clearTimeout(wheelIdle);
});

const onWheel = (event: WheelEvent): void => {
  // Claimed unconditionally: an unprevented horizontal wheel is taken by the
  // browser as back/forward navigation, which loses the page entirely.
  event.preventDefault();
  const box = canvas.value?.getBoundingClientRect();
  if (!box || box.width === 0) return;

  const intent = wheelIntent(event, wheelLock);

  // Keep the burst alive on EVERY event, including the ambiguous ones — the
  // gesture has not paused just because one frame was diagonal.
  if (wheelIdle !== null) clearTimeout(wheelIdle);
  wheelIdle = setTimeout(releaseWheelLock, WHEEL_GESTURE_IDLE_MS);

  if (intent === null) return;
  wheelLock = intent;

  if (intent === 'pan') {
    // Pan by the swipe's share of the canvas, so the dates track the fingers.
    viewWindow.value = panWindow(
      viewWindow.value,
      (event.deltaX / box.width) * 100,
    );
    return;
  }

  // A pinch can arrive with no vertical travel; there is nothing to scale by.
  if (event.deltaY === 0) return;

  const anchorPct = ((event.clientX - box.left) / box.width) * 100;
  viewWindow.value = zoomWindow(
    viewWindow.value,
    event.deltaY > 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP,
    Math.min(100, Math.max(0, anchorPct)),
  );
  rememberScale();
};

const drag = ref<{
  x: number;
  from: GanttWindow;
  panning: boolean;
} | null>(null);

// True only once a press has travelled far enough to be a pan — the cursor and
// the click-suppression both key off this, not off the press itself.
const isPanning = computed<boolean>(() => drag.value?.panning === true);

const onPointerDown = (event: PointerEvent): void => {
  // Only a plain primary-button press can become a pan; anything else belongs
  // to whatever sits underneath (a context menu, a middle-click).
  if (event.button !== 0) return;
  drag.value = {
    x: event.clientX,
    from: { ...viewWindow.value },
    panning: false,
  };
};

const onPointerMove = (event: PointerEvent): void => {
  const active = drag.value;
  const box = canvas.value?.getBoundingClientRect();
  if (!active || !box || box.width === 0) return;
  const moved = active.x - event.clientX;
  if (!active.panning) {
    if (Math.abs(moved) < DRAG_SLOP_PX) return;
    active.panning = true;
    // Captured only now: from here the gesture is a pan and the pointer must
    // keep reporting even if it leaves the timeline.
    surface.value?.setPointerCapture(event.pointerId);
  }
  viewWindow.value = panWindow(active.from, (moved / box.width) * 100);
};

const onPointerUp = (event: PointerEvent): void => {
  const active = drag.value;
  if (!active) return;
  drag.value = null;
  if (active.panning) {
    surface.value?.releasePointerCapture(event.pointerId);
    rememberScale();
  }
};

// A pan that ends over a bar must not also open that bar's project.
const onClickCapture = (event: MouseEvent): void => {
  if (isPanning.value) {
    event.preventDefault();
    event.stopPropagation();
  }
};

// Keyboard parity for the two pointer gestures — a canvas that can only be
// operated with a wheel is unusable without one.
const onKeydown = (event: KeyboardEvent): void => {
  const keys = ['ArrowLeft', 'ArrowRight', '+', '=', '-', '_'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft')
    viewWindow.value = panWindow(viewWindow.value, -20);
  else if (event.key === 'ArrowRight')
    viewWindow.value = panWindow(viewWindow.value, 20);
  else if (event.key === '-' || event.key === '_')
    viewWindow.value = zoomWindow(viewWindow.value, KEY_ZOOM_STEP, 50);
  else viewWindow.value = zoomWindow(viewWindow.value, 1 / KEY_ZOOM_STEP, 50);
  rememberScale();
};
</script>

<template>
  <div>
    <div
      class="rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-dark-900/40 overflow-hidden"
    >
      <!-- The canvas scrolls inside its own box; the page never moves sideways. -->
      <div class="overflow-x-auto">
        <!-- The gestures live on the WHOLE timeline, not on the axis strip:
             the pointer naturally rests over the bars, and a wheel there has to
             zoom rather than do nothing. -->
        <div
          ref="surface"
          class="relative min-w-[46rem] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
          :class="isPanning ? 'cursor-grabbing' : 'cursor-grab'"
          tabindex="0"
          role="group"
          :aria-label="$t('projects.gantt.canvasLabel')"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @keydown="onKeydown"
          @click.capture="onClickCapture"
        >
          <!-- Axis -->
          <div class="flex border-b border-slate-200 dark:border-white/10">
            <div
              class="w-56 shrink-0 sticky left-0 z-10 bg-white dark:bg-dark-900 border-r border-slate-200 dark:border-white/10 px-3 py-2"
            >
              <p class="text-xxs text-slate-400 dark:text-slate-500">
                {{ $t('projects.gantt.step.label') }} —
                {{ $t(`projects.gantt.step.${step}`) }}
              </p>
            </div>
            <!-- Measured, not listened to: its left edge is date zero. -->
            <!-- Clipped: a bar or a tick label near the right edge must not
                 widen the row and hand the page a scrollbar of its own. -->
            <div ref="canvas" class="relative flex-1 overflow-hidden">
              <div class="h-9">
                <span
                  v-for="tick in ticks"
                  :key="tick.date.toISOString()"
                  class="absolute top-0 h-full pl-1.5 pt-2 text-xxs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-l border-slate-200/70 dark:border-white/5"
                  :style="{ left: `${tick.pct}%` }"
                  >{{ tickLabel(tick.date) }}</span
                >
              </div>
            </div>
          </div>

          <!-- Today, drawn ONCE for the whole timeline. Per-row segments left a
               gap at every group heading (whose canvas is only absolutely
               positioned children, so it has no height to draw into) and could
               never join across the row borders anyway. Mirrors the row layout
               — title-column spacer, then canvas — so it lands on the same x as
               the bars. Behind them in paint order, and never on the pointer. -->
          <div
            v-if="today !== null"
            class="absolute inset-0 z-0 flex pointer-events-none"
            aria-hidden="true"
          >
            <div class="w-56 shrink-0"></div>
            <div class="relative flex-1 overflow-hidden">
              <span
                class="absolute top-0 bottom-0 w-px bg-red-500/50"
                :style="{ left: `${today}%` }"
              ></span>
            </div>
          </div>

          <!-- Rows -->
          <template v-for="group in rowGroups" :key="group.id">
            <div
              v-if="showGroupHeadings"
              class="flex bg-slate-50 dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/5"
            >
              <div
                class="w-56 shrink-0 sticky left-0 z-10 bg-slate-50 dark:bg-dark-900 border-r border-slate-200 dark:border-white/10 px-3 py-1.5"
              >
                <p
                  class="text-xxs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate"
                >
                  {{ group.name || $t('projects.gantt.otherGroup') }}
                  <span
                    class="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500"
                  >
                    {{ group.bars.length }}
                  </span>
                </p>
              </div>
              <div class="relative flex-1 overflow-hidden"></div>
            </div>

            <div
              v-for="bar in group.bars"
              :key="bar.id"
              class="group flex border-b border-slate-100 last:border-b-0 dark:border-white/5 hover:bg-brand-500/[0.04]"
            >
              <!-- The sticky cell paints its own hover: its background has to
                   stay opaque (the bars scroll underneath it), so it cannot
                   inherit the row's translucent tint and would otherwise be the
                   one part of the row that never lights up. -->
              <div
                class="w-56 shrink-0 sticky left-0 z-10 bg-white dark:bg-dark-900 group-hover:bg-brand-50 dark:group-hover:bg-dark-800 transition-colors border-r border-slate-200 dark:border-white/10 px-3 py-2"
              >
                <RouterLink
                  :to="`/projects/${bar.id}`"
                  class="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 hover:text-brand-600 dark:hover:text-brand-400"
                >
                  {{ bar.title }}
                </RouterLink>
                <!-- The status is WRITTEN here, not only coloured: two of the
                     five fills are indistinguishable under deuteranopia, and on
                     a timeline the bars sit edge to edge with no column heading
                     to name them. -->
                <p
                  class="mt-0.5 flex items-center gap-1.5 text-xxs text-slate-500 dark:text-slate-400 truncate"
                >
                  <span
                    class="h-1.5 w-1.5 rounded-sm shrink-0"
                    :class="statusFill(bar.status)"
                  ></span>
                  {{ statusLabel(bar.status) }}
                </p>
              </div>

              <div class="relative flex-1 h-12 overflow-hidden">
                <Tooltip :text="barTooltip(bar)" display="contents">
                  <RouterLink
                    :to="`/projects/${bar.id}`"
                    class="absolute top-1/2 -translate-y-1/2 h-4 rounded-md bg-slate-200/80 dark:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    :class="[
                      bar.startSource === 'inferred' ? 'gantt-soft-start' : '',
                      bar.endSource === 'inferred' ? 'gantt-soft-end' : '',
                      barClipped(bar).start ? 'rounded-l-none' : '',
                      barClipped(bar).end ? 'rounded-r-none' : '',
                    ]"
                    :style="barStyle(bar)"
                    :aria-label="`${bar.title} — ${statusLabel(bar.status)}`"
                  >
                    <span
                      class="block h-full rounded-md"
                      :class="statusFill(bar.status)"
                      :style="{ width: `${Math.round(bar.progress * 100)}%` }"
                    ></span>
                    <!-- An open deadline continues rather than stopping: the
                         bar runs to today and trails off. -->
                    <span
                      v-if="bar.endSource === 'open'"
                      class="absolute top-1/2 -translate-y-1/2 -right-4 flex gap-1 items-center"
                      aria-hidden="true"
                    >
                      <span
                        v-for="dot in 3"
                        :key="dot"
                        class="block h-1 w-1 rounded-full"
                        :class="statusFill(bar.status)"
                        :style="{ opacity: 0.7 - dot * 0.18 }"
                      ></span>
                    </span>
                  </RouterLink>
                </Tooltip>
              </div>
            </div>
          </template>

          <!-- Everything filtered out of the window, rather than out of the list. -->
          <EmptyState
            v-if="rowGroups.length === 0"
            :icon="CalendarRange"
            :title="$t('projects.gantt.emptyWindowTitle')"
            :description="$t('projects.gantt.emptyWindow')"
          />
        </div>
      </div>
    </div>

    <!-- Legend + gesture hint -->
    <div
      class="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 text-xxs text-slate-500 dark:text-slate-400"
    >
      <div class="flex flex-wrap gap-3">
        <span
          v-for="status in PROJECT_STATUSES"
          :key="status"
          class="inline-flex items-center gap-1.5"
        >
          <span
            class="h-1.5 w-1.5 rounded-sm"
            :class="statusFill(status)"
          ></span>
          {{ statusLabel(status) }}
        </span>
      </div>
      <p class="text-slate-400 dark:text-slate-500">
        {{ $t('projects.gantt.hint') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* A derived edge fades out instead of ending flat, so a boundary we inferred
   never reads as one the user stated. Not a Tailwind utility because the repo
   registers no mask tokens — and a one-off `mask-image` class would compile to
   nothing (§5.4). */
.gantt-soft-start {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 20px);
  mask-image: linear-gradient(to right, transparent, #000 20px);
}

.gantt-soft-end {
  -webkit-mask-image: linear-gradient(to left, transparent, #000 20px);
  mask-image: linear-gradient(to left, transparent, #000 20px);
}

.gantt-soft-start.gantt-soft-end {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent,
    #000 20px,
    #000 calc(100% - 20px),
    transparent
  );
  mask-image: linear-gradient(
    to right,
    transparent,
    #000 20px,
    #000 calc(100% - 20px),
    transparent
  );
}
</style>
