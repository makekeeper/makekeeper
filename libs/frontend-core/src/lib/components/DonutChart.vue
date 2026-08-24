<script setup lang="ts">
import { computed } from 'vue';

// One donut chart for categorical breakdowns: SVG stroke segments with a 2px
// surface gap between them, a hero number in the hole, and a legend beside it
// carrying a color dot + label + value for every segment — identity is never
// color-alone. Colors arrive as `text-*` utility classes (light + dark steps);
// the SVG paints with `currentColor`, so the design system's tokens stay the
// single source of truth.
export interface DonutSegment {
  label: string;
  value: number;
  // e.g. 'text-indigo-500' or 'text-purple-700 dark:text-purple-600'.
  colorClass: string;
}

const props = defineProps<{
  segments: DonutSegment[];
  // Hero number caption inside the hole (the number itself is the total).
  centerLabel: string;
  // Accessible one-sentence summary of what the donut shows.
  ariaLabel: string;
}>();

const total = computed<number>(() =>
  props.segments.reduce((acc, s) => acc + s.value, 0),
);

// r chosen so the circumference is exactly 100 → dasharray works in percent.
const RADIUS = 15.9155;
// The 2px surface gap between fills, expressed in circumference units.
const GAP = 2;

interface Arc extends DonutSegment {
  dasharray: string;
  dashoffset: number;
}

const arcs = computed<Arc[]>(() => {
  const shown = props.segments.filter((s) => s.value > 0);
  if (!shown.length || total.value === 0) return [];
  let consumed = 0;
  return shown.map((s) => {
    const len = (s.value / total.value) * 100;
    // A gap is only meaningful between two visible segments.
    const gap = shown.length > 1 ? GAP : 0;
    const arc: Arc = {
      ...s,
      dasharray: `${Math.max(0.5, len - gap)} ${100 - Math.max(0.5, len - gap)}`,
      // Dash offset runs counter-clockwise; shift each segment past the ones
      // already drawn (+ half a gap so gaps straddle the boundaries).
      dashoffset: 25 - consumed - gap / 2,
    };
    consumed += len;
    return arc;
  });
});
</script>

<template>
  <div class="flex items-center gap-5">
    <div class="relative w-28 h-28 shrink-0" role="img" :aria-label="ariaLabel">
      <svg
        viewBox="0 0 42 42"
        class="w-full h-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="21"
          cy="21"
          :r="RADIUS"
          fill="none"
          class="stroke-slate-200/60 dark:stroke-white/5"
          stroke-width="5"
        />
        <circle
          v-for="arc in arcs"
          :key="arc.label"
          cx="21"
          cy="21"
          :r="RADIUS"
          fill="none"
          stroke="currentColor"
          stroke-width="5"
          :stroke-dasharray="arc.dasharray"
          :stroke-dashoffset="arc.dashoffset"
          :class="arc.colorClass"
        />
      </svg>
      <div
        class="absolute inset-0 flex flex-col items-center justify-center"
        aria-hidden="true"
      >
        <span
          class="text-2xl font-bold text-slate-900 dark:text-white leading-none"
        >
          {{ total }}
        </span>
        <span class="text-xxs text-slate-500 dark:text-slate-400 mt-0.5">
          {{ centerLabel }}
        </span>
      </div>
    </div>

    <!-- Right side: the default slot replaces the built-in legend when the
         caller renders its own breakdown (it must still carry the color↔label
         mapping — identity is never color-alone). Not aria-hidden: slot
         content may be interactive (links). -->
    <div class="min-w-0 flex-1">
      <slot>
        <!-- Legend: dot + label + value per segment (direct labels, not hover-only). -->
        <ul class="space-y-1.5">
          <li
            v-for="s in segments"
            :key="s.label"
            class="flex items-center gap-2 text-xs"
          >
            <span
              class="w-2.5 h-2.5 rounded-sm bg-current shrink-0"
              :class="s.colorClass"
            ></span>
            <span class="text-slate-600 dark:text-slate-300 truncate">
              {{ s.label }}
            </span>
            <span class="font-semibold text-slate-900 dark:text-white ml-auto">
              {{ s.value }}
            </span>
          </li>
        </ul>
      </slot>
    </div>
  </div>
</template>
