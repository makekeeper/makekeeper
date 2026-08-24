<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

// GitHub-style contribution calendar: one column per week (Monday-first), one
// cell per day, intensity on a single-hue sequential ramp (brand, light→dark;
// dark mode uses its own steps from the same ramp — not an automatic flip).
// Identity is never color-alone: every cell has a hover tooltip with the exact
// date + count, and the container carries an aria-label summary.
export interface HeatmapDay {
  // ISO date, `yyyy-mm-dd`.
  date: string;
  count: number;
}

const props = withDefaults(
  defineProps<{
    data: HeatmapDay[];
    // Accessible one-sentence summary of what the calendar shows.
    ariaLabel: string;
    // How many trailing weeks to render, ending with the current week.
    weeks?: number;
  }>(),
  {
    weeks: 26,
  },
);

const { t, locale } = useI18n();

// Sequential ramp: level 0 is the empty surface, 1–4 grow through the brand
// hue. Dark mode's steps are selected (dark→bright as intensity grows).
const LEVEL_CLASSES = [
  'bg-slate-200/60 dark:bg-white/5',
  'bg-brand-200 dark:bg-brand-900',
  'bg-brand-400 dark:bg-brand-700',
  'bg-brand-600 dark:bg-brand-500',
  'bg-brand-800 dark:bg-brand-300',
] as const;

const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Monday of the week `date` falls in (local time).
const mondayOf = (date: Date): Date => {
  const d = new Date(date);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  d.setHours(0, 0, 0, 0);
  return d;
};

interface HeatmapCell {
  key: string;
  label: string;
  count: number;
  levelClass: string;
  // Days after "today" render as invisible fillers to square the last column.
  future: boolean;
}

interface HeatmapWeek {
  key: string;
  // Localized short month name when this week starts a new month, else ''.
  monthLabel: string;
  cells: HeatmapCell[];
}

const countsByDate = computed<Map<string, number>>(
  () => new Map(props.data.map((d) => [d.date, d.count])),
);

const maxCount = computed<number>(() =>
  Math.max(1, ...props.data.map((d) => d.count)),
);

const levelOf = (count: number): number =>
  count <= 0 ? 0 : Math.min(4, Math.ceil((count / maxCount.value) * 4));

const grid = computed<HeatmapWeek[]>(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = mondayOf(today);
  start.setDate(start.getDate() - (props.weeks - 1) * 7);

  const weeksOut: HeatmapWeek[] = [];
  let prevMonth = -1;
  for (let w = 0; w < props.weeks; w++) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + w * 7);
    const month = weekStart.getMonth();
    const monthLabel =
      month !== prevMonth
        ? weekStart.toLocaleDateString(locale.value, { month: 'short' })
        : '';
    prevMonth = month;

    const cells: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      const iso = isoDate(day);
      const count = countsByDate.value.get(iso) ?? 0;
      cells.push({
        key: iso,
        label: day.toLocaleDateString(locale.value, {
          day: 'numeric',
          month: 'short',
        }),
        count,
        levelClass: LEVEL_CLASSES[levelOf(count)],
        future: day.getTime() > today.getTime(),
      });
    }
    weeksOut.push({ key: isoDate(weekStart), monthLabel, cells });
  }
  return weeksOut;
});

// One fixed-position tooltip for the whole grid: cells live inside a scroll
// container whose overflow would clip a per-cell absolute tooltip.
interface HoveredCell {
  x: number;
  y: number;
  label: string;
  count: number;
}
const hovered = ref<HoveredCell | null>(null);

const onCellEnter = (cell: HeatmapCell, evt: MouseEvent): void => {
  if (cell.future) return;
  const el = evt.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  const rect = el.getBoundingClientRect();
  hovered.value = {
    x: rect.left + rect.width / 2,
    y: rect.top,
    label: cell.label,
    count: cell.count,
  };
};

const onCellLeave = (): void => {
  hovered.value = null;
};

// The weekday label column is absolutely positioned so it can never stretch
// the row past the grid's own height, but below ~7px per cell the three
// labels start colliding with each other and stop earning their 32px of
// width (#244) — so measure the wrapper and drop them entirely.
// Cell width is always computed as-if the labels were shown, so toggling
// them cannot feed back into the measurement and oscillate.
const WEEKDAY_COL_PX = 32; // w-7 label column + gap-1 (= the month row's ml-8)
const CELL_GAP_PX = 2; // gap-0.5 between week columns
const MIN_LABELED_CELL_PX = 7;

const wrapperEl = ref<HTMLElement | null>(null);
const wrapperWidth = ref(Infinity);
const showWeekdays = computed<boolean>(
  () =>
    (wrapperWidth.value - WEEKDAY_COL_PX - (props.weeks - 1) * CELL_GAP_PX) /
      props.weeks >=
    MIN_LABELED_CELL_PX,
);

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !wrapperEl.value) return;
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width !== undefined) wrapperWidth.value = width;
  });
  resizeObserver.observe(wrapperEl.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

// Mon / Wed / Fri row labels, localized from a fixed reference Monday.
const weekdayLabels = computed<string[]>(() => {
  const monday = mondayOf(new Date());
  return [0, 2, 4].map((offset) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    return d.toLocaleDateString(locale.value, { weekday: 'short' });
  });
});
</script>

<template>
  <div role="img" :aria-label="ariaLabel">
    <!-- The grid is fluid: week columns share the container width equally and
         cells stay square via aspect-square, so the calendar fills the card
         whatever the panel size. Cells never shrink below w-1 (with 52 weeks a
         higher floor overflows a half-width dashboard card, #244); only on very
         narrow screens does the wrapper scroll instead. -->
    <div ref="wrapperEl" class="overflow-x-auto pb-1">
      <div class="flex flex-col gap-1 min-w-full">
        <!-- Month labels: one slot per week column, named on month change.
             Labels overflow their slot into the neighbours by design, so the
             row clips them at its edge — otherwise a right-edge label's nowrap
             text widens the scroll area and forces a scrollbar (#244). -->
        <div
          class="flex gap-0.5 overflow-hidden"
          :class="showWeekdays ? 'ml-8' : ''"
          aria-hidden="true"
        >
          <span
            v-for="week in grid"
            :key="`m-${week.key}`"
            class="flex-1 min-w-1 text-xxs text-slate-400 dark:text-slate-500 overflow-visible whitespace-nowrap"
          >
            {{ week.monthLabel }}
          </span>
        </div>

        <div class="relative">
          <!-- Mon / Wed / Fri row labels. Absolutely positioned so their text
               rows never set the row height — the grid alone does, and the
               label rows compress with it (minmax(0,1fr)), staying centered on
               their cell rows at any size. Dropped entirely once cells are too
               small for the labels to be useful (see showWeekdays, #244). -->
          <div
            v-if="showWeekdays"
            class="absolute left-0 inset-y-0 w-7 grid grid-rows-7 gap-0.5 text-xxs text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          >
            <span></span>
            <span class="leading-none self-center">{{ weekdayLabels[0] }}</span>
            <span></span>
            <span class="leading-none self-center">{{ weekdayLabels[1] }}</span>
            <span></span>
            <span class="leading-none self-center">{{ weekdayLabels[2] }}</span>
            <span></span>
          </div>

          <div
            class="flex gap-0.5"
            :class="showWeekdays ? 'ml-8' : ''"
            aria-hidden="true"
          >
            <div
              v-for="week in grid"
              :key="week.key"
              class="flex flex-col gap-0.5 flex-1 min-w-1"
            >
              <div
                v-for="cell in week.cells"
                :key="cell.key"
                class="w-full aspect-square rounded-sm"
                :class="cell.future ? 'invisible' : cell.levelClass"
                @mouseenter="onCellEnter(cell, $event)"
                @mouseleave="onCellLeave"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Single fixed-position tooltip (escapes the scroll container's clip). -->
    <Teleport to="body">
      <div
        v-if="hovered"
        class="fixed -translate-x-1/2 -translate-y-full px-2 py-1 rounded-lg bg-white dark:bg-dark-800 border border-slate-200 dark:border-white/10 shadow-lg text-xxs whitespace-nowrap z-50 pointer-events-none"
        :style="{ left: `${hovered.x}px`, top: `${hovered.y - 6}px` }"
      >
        <span class="text-slate-500 dark:text-slate-400">{{
          hovered.label
        }}</span>
        <span class="font-semibold text-slate-900 dark:text-white ml-1.5">{{
          hovered.count
        }}</span>
      </div>
    </Teleport>

    <!-- Intensity legend. -->
    <div
      class="flex items-center justify-end gap-1 mt-2 text-xxs text-slate-400 dark:text-slate-500"
      aria-hidden="true"
    >
      <span>{{ t('common.less') }}</span>
      <span
        v-for="(cls, i) in LEVEL_CLASSES"
        :key="i"
        class="w-2.5 h-2.5 rounded-sm"
        :class="cls"
      ></span>
      <span>{{ t('common.more') }}</span>
    </div>
  </div>
</template>
