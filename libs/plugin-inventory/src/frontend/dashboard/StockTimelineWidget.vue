<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Boxes } from '@lucide/vue';
import { apiJson, EmptyState, Spinner } from '@makekeeper/frontend-core';

// Dashboard panel: where the parts ARE, day by day — a stacked area of stock
// states over the last 30 days. Bands bottom-up: free stock in storages,
// reserved for projects, consumed within the window (cumulative), and items
// still in transit on top. A delivery literally flows down the stack: the
// "in transit" band thins on the arrival day and the "stock" band thickens.
// Real data: the stats series API (inventory.stock/reserved/used, backed by a
// daily stock snapshot) + the logistics orders list for the in-transit band
// (orders carry `receivedAt` derived from their PURCHASE movements; a
// disabled logistics plugin just drops that band).
interface TimelineDay {
  date: string;
  stock: number;
  reserved: number;
  used: number;
}

interface OrderSummary {
  status: string;
  itemsCount: number;
  orderDate: string;
  receivedAt: string | null;
}

const DAYS = 30;
const IN_TRANSIT_STATUSES = ['ORDERED', 'SHIPPED'];

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const days = ref<TimelineDay[]>([]);
const orders = ref<OrderSummary[]>([]);

const fmt = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }),
);

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  });

// Items on their way at each day's end: order placed on/before the day and
// either still undelivered or received later. A DELIVERED order with no
// PURCHASE movement has no known arrival day and is skipped.
const inTransitByDay = computed<number[]>(() =>
  days.value.map((day) => {
    const dayEnd = new Date(day.date);
    dayEnd.setHours(23, 59, 59, 999);
    return orders.value.reduce((acc, o) => {
      if (o.status === 'CART') return acc;
      if (new Date(o.orderDate) > dayEnd) return acc;
      if (o.receivedAt) {
        return new Date(o.receivedAt) > dayEnd ? acc + o.itemsCount : acc;
      }
      return IN_TRANSIT_STATUSES.includes(o.status) ? acc + o.itemsCount : acc;
    }, 0);
  }),
);

// Band catalog, bottom-up stack order. Colors are the app's validated
// categorical hues; the legend + tooltip carry every band's name and value.
interface Band {
  key: 'stock' | 'reserved' | 'used' | 'inTransit';
  labelKey: string;
  colorClass: string;
  fillClass: string;
}

const BANDS: Band[] = [
  {
    key: 'stock',
    labelKey: 'inventory.dashboard.timeline.stock',
    colorClass: 'text-brand-500',
    fillClass: 'fill-brand-500/40',
  },
  {
    key: 'reserved',
    labelKey: 'inventory.dashboard.timeline.reserved',
    colorClass: 'text-amber-500 dark:text-amber-600',
    fillClass: 'fill-amber-500/40 dark:fill-amber-600/40',
  },
  {
    key: 'used',
    labelKey: 'inventory.dashboard.timeline.used',
    colorClass: 'text-purple-700 dark:text-purple-600',
    fillClass: 'fill-purple-700/40 dark:fill-purple-600/40',
  },
  {
    key: 'inTransit',
    labelKey: 'inventory.dashboard.timeline.inTransit',
    colorClass: 'text-indigo-500',
    fillClass: 'fill-indigo-500/40',
  },
];

const valueOf = (day: TimelineDay, i: number, key: Band['key']): number =>
  key === 'inTransit' ? (inTransitByDay.value[i] ?? 0) : day[key];

// ── Geometry: stacked cumulative levels in a fixed viewBox ───────────────
const W = 100;
const H = 40;
const PAD_TOP = 3;

interface XY {
  x: number;
  y: number;
}

const curveOf = (pts: XY[]): string => {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    d += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
};

interface RenderedBand extends Band {
  areaPath: string;
  topPath: string;
}

const rendered = computed<RenderedBand[] | null>(() => {
  const n = days.value.length;
  if (n < 2) return null;
  // Cumulative levels per day: levels[b][i] = sum of bands 0..b-1 at day i.
  const levels: number[][] = [days.value.map(() => 0)];
  for (const band of BANDS) {
    const prev = levels[levels.length - 1];
    levels.push(
      days.value.map((day, i) => prev[i] + valueOf(day, i, band.key)),
    );
  }
  const maxTotal = Math.max(1, ...levels[levels.length - 1]);
  const step = W / (n - 1);
  const toXY = (vals: number[]): XY[] =>
    vals.map((v, i) => ({
      x: i * step,
      y: H - (v / maxTotal) * (H - PAD_TOP),
    }));

  return BANDS.map((band, b) => {
    const lower = toXY(levels[b]);
    const upper = toXY(levels[b + 1]);
    const back = curveOf([...lower].reverse());
    const last = lower[lower.length - 1];
    return {
      ...band,
      areaPath: `${curveOf(upper)} L ${last.x} ${last.y} ${back.replace(/^M [\d.-]+ [\d.-]+/, '')} Z`,
      topPath: curveOf(upper),
    };
  });
});

const hoveredIndex = ref<number | null>(null);

const hovered = computed<{
  label: string;
  entries: { labelKey: string; colorClass: string; value: number }[];
  xPct: number;
} | null>(() => {
  const i = hoveredIndex.value;
  if (i === null) return null;
  const day = days.value[i];
  if (!day) return null;
  return {
    label: dayLabel(day.date),
    entries: [...BANDS].reverse().map((b) => ({
      labelKey: b.labelKey,
      colorClass: b.colorClass,
      value: valueOf(day, i, b.key),
    })),
    xPct: (i / Math.max(1, days.value.length - 1)) * 100,
  };
});

const current = computed<TimelineDay | undefined>(
  () => days.value[days.value.length - 1],
);

onMounted(async () => {
  try {
    // Stock/reserved are point-in-time levels from the daily snapshot; used is
    // per-day consumption (cumulated here to keep the band's within-window
    // meaning). All three come from the stats series API (ticket #56 §4.4),
    // aligned by date.
    const [stock, reserved, used] = await Promise.all([
      apiJson<{ date: string; value: number }[]>(
        `/api/stats/series?metric=inventory.stock&days=${DAYS}`,
      ),
      apiJson<{ date: string; value: number }[]>(
        `/api/stats/series?metric=inventory.reserved&days=${DAYS}`,
      ),
      apiJson<{ date: string; value: number }[]>(
        `/api/stats/series?metric=inventory.used&days=${DAYS}`,
      ),
    ]);
    let usedCum = 0;
    days.value = stock.map((s, i) => {
      usedCum += used[i]?.value ?? 0;
      return {
        date: s.date,
        stock: s.value,
        reserved: reserved[i]?.value ?? 0,
        used: usedCum,
      };
    });
  } catch {
    failed.value = true;
  }
  // The in-transit band comes from the logistics plugin; a disabled plugin
  // (404) just means no band — never a failed widget.
  try {
    orders.value = await apiJson<OrderSummary[]>('/api/logistics/orders');
  } catch {
    orders.value = [];
  }
  loading.value = false;
});
</script>

<template>
  <div
    v-if="loading"
    class="glass-card rounded-2xl p-6 flex justify-center py-16"
  >
    <Spinner />
  </div>

  <div
    v-else-if="rendered && current"
    class="glass-card rounded-2xl p-5 space-y-4"
  >
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{
        t('inventory.dashboard.timeline.hint', {
          stock: fmt.format(current.stock),
          inTransit: fmt.format(inTransitByDay[inTransitByDay.length - 1] ?? 0),
          days: DAYS,
        })
      }}
    </p>

    <div
      role="img"
      :aria-label="
        t('inventory.dashboard.timeline.aria', {
          stock: fmt.format(current.stock),
          days: DAYS,
        })
      "
    >
      <div class="relative h-32">
        <svg
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="none"
          class="absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          <g v-for="band in rendered" :key="band.key" :class="band.colorClass">
            <path :d="band.areaPath" :class="band.fillClass" />
            <path
              :d="band.topPath"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
        </svg>

        <!-- Hover layer: one hit column per day + a vertical guide. -->
        <div class="absolute inset-0 flex" aria-hidden="true">
          <div
            v-for="(d, i) in days"
            :key="d.date"
            class="flex-1"
            @mouseenter="hoveredIndex = i"
            @mouseleave="hoveredIndex = null"
          ></div>
        </div>

        <template v-if="hovered">
          <div
            class="absolute inset-y-0 w-px bg-slate-400/50 dark:bg-white/20 pointer-events-none"
            :style="{ left: `${hovered.xPct}%` }"
          ></div>
          <div
            class="absolute top-0 -translate-x-1/2 -translate-y-full -mt-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-dark-800 border border-slate-200 dark:border-white/10 shadow-lg text-xxs whitespace-nowrap z-10 pointer-events-none space-y-0.5"
            :style="{ left: `${Math.min(85, Math.max(15, hovered.xPct))}%` }"
          >
            <div class="text-slate-500 dark:text-slate-400">
              {{ hovered.label }}
            </div>
            <div
              v-for="e in hovered.entries"
              :key="e.labelKey"
              class="flex items-center gap-1.5"
            >
              <span
                class="w-2 h-2 rounded-sm bg-current shrink-0"
                :class="e.colorClass"
              ></span>
              <span class="text-slate-500 dark:text-slate-400">{{
                t(e.labelKey)
              }}</span>
              <span class="font-semibold text-slate-900 dark:text-white">{{
                fmt.format(e.value)
              }}</span>
            </div>
          </div>
        </template>

        <div
          class="absolute inset-x-0 bottom-0 border-b border-slate-200/70 dark:border-white/10"
          aria-hidden="true"
        ></div>
      </div>

      <!-- Axis ends + band legend. -->
      <div
        class="flex justify-between items-center mt-1.5 text-xxs text-slate-400 dark:text-slate-500"
        aria-hidden="true"
      >
        <span>{{ days[0] ? dayLabel(days[0].date) : '' }}</span>
        <div class="flex items-center gap-3">
          <span
            v-for="band in BANDS"
            :key="`legend-${band.key}`"
            class="flex items-center gap-1.5"
          >
            <span
              class="w-2 h-2 rounded-sm bg-current"
              :class="band.colorClass"
            ></span>
            {{ t(band.labelKey) }}
          </span>
        </div>
        <span>{{
          days[days.length - 1] ? dayLabel(days[days.length - 1].date) : ''
        }}</span>
      </div>
    </div>
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState
      :title="
        failed
          ? t('inventory.dashboard.loadFailed')
          : t('inventory.dashboard.timeline.empty')
      "
      :description="failed ? '' : t('inventory.dashboard.timeline.emptyHint')"
      :icon="Boxes"
    />
  </div>
</template>
