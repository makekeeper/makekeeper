<script setup lang="ts">
import { computed, ref, useId } from 'vue';

// A smooth area sparkline for one or more time series sharing the same x
// categories and scale: 2px lines over soft gradient fills, per-point hover
// (a dot per series + one tooltip listing every series' value) via invisible
// hit columns wider than the marks, first/last category labels under the
// axis, and a legend whenever there are >= 2 series (identity is never
// color-alone). Each series carries its color as a `text-*` utility class
// (light + dark steps validated together) painted through currentColor.
export interface SparkPoint {
  label: string;
  value: number;
  // Tooltip text for the value; falls back to the raw number. Lets a caller
  // plot normalized values (per-series scales) while the tooltip stays honest.
  display?: string;
}

export interface SparkSeries {
  name: string;
  // e.g. 'text-brand-500' or 'text-emerald-600'.
  colorClass: string;
  points: SparkPoint[];
}

const props = defineProps<{
  // All series must share the same category labels (same length & order).
  series: SparkSeries[];
  // Accessible one-sentence summary of what the chart shows.
  ariaLabel: string;
}>();

// Fixed internal coordinate space; the SVG stretches to the container.
const W = 100;
const H = 40;
const PAD_Y = 4;

const categories = computed<string[]>(
  () => props.series[0]?.points.map((p) => p.label) ?? [],
);

// One shared scale across every series (never a second axis).
const maxValue = computed<number>(() =>
  Math.max(1, ...props.series.flatMap((s) => s.points.map((p) => p.value))),
);

interface XY {
  x: number;
  y: number;
}

const toXY = (points: SparkPoint[]): XY[] => {
  const n = points.length;
  if (n === 0) return [];
  const step = n > 1 ? W / (n - 1) : 0;
  return points.map((p, i) => ({
    x: n > 1 ? i * step : W / 2,
    y: H - PAD_Y - (p.value / maxValue.value) * (H - PAD_Y * 2),
  }));
};

// Smooth monotone-ish curve: cubic segments with horizontal control handles —
// no overshoot below the baseline on spiky data.
const curveOf = (pts: XY[]): string => {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    d += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
};

interface RenderedSeries extends SparkSeries {
  xy: XY[];
  linePath: string;
  areaPath: string;
}

const rendered = computed<RenderedSeries[]>(() =>
  props.series.map((s) => {
    const xy = toXY(s.points);
    const linePath = curveOf(xy);
    return {
      ...s,
      xy,
      linePath,
      areaPath: xy.length > 1 ? `${linePath} L ${W} ${H} L 0 ${H} Z` : '',
    };
  }),
);

const hoveredIndex = ref<number | null>(null);

interface HoveredValue {
  name: string;
  colorClass: string;
  value: number;
  display: string;
  x: number;
  y: number;
}

const hoveredValues = computed<HoveredValue[]>(() => {
  const i = hoveredIndex.value;
  if (i === null) return [];
  return rendered.value.flatMap((s) =>
    s.points[i] && s.xy[i]
      ? [
          {
            name: s.name,
            colorClass: s.colorClass,
            value: s.points[i].value,
            display: s.points[i].display ?? String(s.points[i].value),
            x: s.xy[i].x,
            y: s.xy[i].y,
          },
        ]
      : [],
  );
});

const hoveredLabel = computed<string>(() => {
  const i = hoveredIndex.value;
  return i === null ? '' : (categories.value[i] ?? '');
});

// Anchor the tooltip to the topmost hovered dot.
const tooltipAnchor = computed<XY | null>(() => {
  const vals = hoveredValues.value;
  if (!vals.length) return null;
  const top = vals.reduce((a, b) => (b.y < a.y ? b : a));
  return { x: top.x, y: top.y };
});

// Percent positions for the HTML hover layer (the SVG space is 0..W / 0..H).
const pct = (v: number, span: number): string => `${(v / span) * 100}%`;

// SVG ids are document-global; a per-instance id keeps one chart's gradients
// from being resolved by another's paths.
const fillId = `spark-area-fill-${useId()}`;
</script>

<template>
  <div role="img" :aria-label="ariaLabel">
    <div class="relative h-28">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        class="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            v-for="(s, si) in rendered"
            :id="`${fillId}-${si}`"
            :key="`g-${s.name}`"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0"
              stop-color="currentColor"
              stop-opacity="0.2"
              :class="s.colorClass"
            />
            <stop
              offset="1"
              stop-color="currentColor"
              stop-opacity="0"
              :class="s.colorClass"
            />
          </linearGradient>
        </defs>
        <g v-for="(s, si) in rendered" :key="s.name" :class="s.colorClass">
          <path
            v-if="s.areaPath"
            :d="s.areaPath"
            :fill="`url(#${fillId}-${si})`"
          />
          <path
            v-if="s.linePath"
            :d="s.linePath"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>
      </svg>

      <!-- Hover layer: one hit column per category, wider than the marks. -->
      <div class="absolute inset-0 flex" aria-hidden="true">
        <div
          v-for="(label, i) in categories"
          :key="`${label}-${i}`"
          class="flex-1"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        ></div>
      </div>

      <!-- Hovered points: a dot with a surface ring per series + one tooltip. -->
      <template v-if="hoveredValues.length">
        <span
          v-for="v in hoveredValues"
          :key="`dot-${v.name}`"
          class="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-white dark:ring-dark-900 pointer-events-none"
          :class="v.colorClass"
          :style="{ left: pct(v.x, W), top: pct(v.y, H) }"
        ></span>
        <div
          v-if="tooltipAnchor"
          class="absolute -translate-x-1/2 -translate-y-full -mt-2.5 px-2 py-1 rounded-lg bg-white dark:bg-dark-800 border border-slate-200 dark:border-white/10 shadow-lg text-xxs whitespace-nowrap z-10 pointer-events-none"
          :style="{
            left: pct(tooltipAnchor.x, W),
            top: pct(tooltipAnchor.y, H),
          }"
        >
          <div class="text-slate-500 dark:text-slate-400">
            {{ hoveredLabel }}
          </div>
          <div
            v-for="v in hoveredValues"
            :key="`tip-${v.name}`"
            class="flex items-center gap-1.5"
          >
            <span
              class="w-2 h-2 rounded-full bg-current shrink-0"
              :class="v.colorClass"
            ></span>
            <span class="text-slate-500 dark:text-slate-400">{{ v.name }}</span>
            <span class="font-semibold text-slate-900 dark:text-white">{{
              v.display
            }}</span>
          </div>
        </div>
      </template>

      <div
        class="absolute inset-x-0 bottom-0 border-b border-slate-200/70 dark:border-white/10"
        aria-hidden="true"
      ></div>
    </div>

    <!-- First / last category labels + legend (legend only for >= 2 series). -->
    <div
      class="flex justify-between items-center mt-1.5 text-xxs text-slate-400 dark:text-slate-500"
      aria-hidden="true"
    >
      <span>{{ categories[0] }}</span>
      <div v-if="series.length > 1" class="flex items-center gap-3">
        <span
          v-for="s in series"
          :key="`legend-${s.name}`"
          class="flex items-center gap-1.5"
        >
          <span
            class="w-2 h-2 rounded-full bg-current"
            :class="s.colorClass"
          ></span>
          {{ s.name }}
        </span>
      </div>
      <span>{{ categories[categories.length - 1] }}</span>
    </div>
  </div>
</template>
