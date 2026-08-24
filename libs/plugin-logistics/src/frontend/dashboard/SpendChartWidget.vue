<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Wallet } from '@lucide/vue';
import {
  EmptyState,
  SparkAreaChart,
  Spinner,
  type SparkSeries,
} from '@makekeeper/frontend-core';
import {
  fetchAllOrders,
  type DashboardOrderSummary,
} from './logistics-dashboard-data';

// Dashboard panel: purchase spend per week for the last 12 weeks, computed
// client-side from the orders list (real data, no extra endpoint). CART
// drafts don't count — nothing was spent yet. Order costs come in mixed
// currencies; the chart keeps them honest by charting only the dominant
// currency (most orders) and naming it in the hint.
const WEEKS = 12;

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const orders = ref<DashboardOrderSummary[]>([]);

// Monday of the week `date` falls in (local time).
const mondayOf = (date: Date): Date => {
  const d = new Date(date);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  d.setHours(0, 0, 0, 0);
  return d;
};

const spent = computed<DashboardOrderSummary[]>(() =>
  orders.value.filter((o) => o.status !== 'CART' && o.totalCost > 0),
);

// The currency most orders were placed in.
const dominantCurrency = computed<string | null>(() => {
  const counts = new Map<string, number>();
  for (const o of spent.value) {
    counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
});

// Orders currently on their way — their items count per placement week forms
// the second series.
const IN_TRANSIT_STATUSES = ['ORDERED', 'SHIPPED'];

interface WeekBucket {
  label: string;
  spend: number;
  inTransitItems: number;
}

const weeklyTotals = computed<WeekBucket[]>(() => {
  const currency = dominantCurrency.value;
  if (!currency) return [];
  const start = mondayOf(new Date());
  start.setDate(start.getDate() - (WEEKS - 1) * 7);

  const buckets: (WeekBucket & { from: number; to: number })[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const from = new Date(start);
    from.setDate(start.getDate() + w * 7);
    const to = new Date(from);
    to.setDate(from.getDate() + 7);
    buckets.push({
      label: from.toLocaleDateString(locale.value, {
        day: 'numeric',
        month: 'short',
      }),
      spend: 0,
      inTransitItems: 0,
      from: from.getTime(),
      to: to.getTime(),
    });
  }
  for (const o of orders.value) {
    const ts = new Date(o.orderDate).getTime();
    const bucket = buckets.find((b) => ts >= b.from && ts < b.to);
    if (!bucket) continue;
    if (o.status !== 'CART' && o.totalCost > 0 && o.currency === currency) {
      bucket.spend += o.totalCost;
    }
    if (IN_TRANSIT_STATUSES.includes(o.status)) {
      bucket.inTransitItems += o.itemsCount;
    }
  }
  return buckets.map((b) => ({
    label: b.label,
    spend: Math.round(b.spend * 100) / 100,
    inTransitItems: b.inTransitItems,
  }));
});

// Money and item counts don't share a scale — normalize each series to its
// own max (per-measure multipliers); tooltips carry the raw values.
const series = computed<SparkSeries[]>(() => {
  const maxSpend = Math.max(1, ...weeklyTotals.value.map((b) => b.spend));
  const maxItems = Math.max(
    1,
    ...weeklyTotals.value.map((b) => b.inTransitItems),
  );
  return [
    {
      name: t('logistics.dashboard.spend'),
      colorClass: 'text-brand-500',
      points: weeklyTotals.value.map((b) => ({
        label: b.label,
        value: Math.round((b.spend / maxSpend) * 100),
        display: `${b.spend} ${dominantCurrency.value ?? ''}`,
      })),
    },
    {
      name: t('logistics.dashboard.seriesInTransit'),
      colorClass: 'text-emerald-600',
      points: weeklyTotals.value.map((b) => ({
        label: b.label,
        value: Math.round((b.inTransitItems / maxItems) * 100),
        display: String(b.inTransitItems),
      })),
    },
  ];
});

const total = computed<number>(
  () =>
    Math.round(weeklyTotals.value.reduce((acc, b) => acc + b.spend, 0) * 100) /
    100,
);

onMounted(async () => {
  try {
    orders.value = await fetchAllOrders();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
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
    v-else-if="weeklyTotals.length"
    class="glass-card rounded-2xl p-5 space-y-4"
  >
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{
        t('logistics.dashboard.spendHint', {
          total,
          currency: dominantCurrency ?? '',
        })
      }}
    </p>
    <SparkAreaChart
      :series="series"
      :aria-label="
        t('logistics.dashboard.spendAria', {
          total,
          currency: dominantCurrency ?? '',
        })
      "
    />
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState
      :title="
        failed
          ? t('logistics.dashboard.loadFailed')
          : t('logistics.dashboard.noSpend')
      "
      :description="failed ? '' : t('logistics.dashboard.noSpendHint')"
      :icon="Wallet"
    />
  </div>
</template>
