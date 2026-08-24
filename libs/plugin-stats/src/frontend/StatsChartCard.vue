<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChartColumn } from '@lucide/vue';
import {
  apiJson,
  ContributionHeatmap,
  EmptyState,
  SparkAreaChart,
  Spinner,
  type HeatmapDay,
  type RegisteredStatsChart,
  type SparkSeries,
} from '@makekeeper/frontend-core';

// Generic renderer for one declared statsChart (ticket #56). Fetches the
// chart's data from the stats API by kind/form and renders it with a shared
// frontend-core primitive — the declaring plugin owns the meaning, the stats
// plugin owns the rendering. Rich bespoke forms (rows / sankey) are shown as a
// pointer to their polished dashboard widget rather than re-implemented here.
const props = defineProps<{ chart: RegisteredStatsChart }>();

interface SeriesPoint {
  date: string;
  value: number;
}
interface GroupedSeries {
  dimensions: Record<string, string>;
  points: SeriesPoint[];
}

// Fixed, CVD-validated hue order — never cycled.
const PALETTE = [
  'text-brand-500',
  'text-emerald-600',
  'text-amber-600',
  'text-sky-600',
  'text-violet-600',
  'text-rose-600',
];

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const series = ref<SparkSeries[]>([]);
const heatmap = ref<HeatmapDay[]>([]);

const days = computed<number>(() => props.chart.defaultRangeDays ?? 30);
const isHeatmap = computed<boolean>(
  () => props.chart.kind === 'series' && props.chart.form === 'heatmapCalendar',
);
const isGraph = computed<boolean>(() => props.chart.kind === 'graph');

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  });

const total = computed<number>(() => {
  if (isHeatmap.value) return heatmap.value.reduce((a, d) => a + d.count, 0);
  return series.value.reduce(
    (a, s) => a + s.points.reduce((b, p) => b + p.value, 0),
    0,
  );
});

const load = async (): Promise<void> => {
  const chart = props.chart;
  // Graph forms render richly on the dashboard, not here — nothing to fetch.
  if (chart.kind === 'graph') {
    loading.value = false;
    return;
  }
  try {
    if (chart.form === 'heatmapCalendar') {
      const metric = chart.series[0]?.metricKey;
      const points = await apiJson<SeriesPoint[]>(
        `/api/stats/series?metric=${metric}&days=365`,
      );
      heatmap.value = points.map((p) => ({ date: p.date, count: p.value }));
    } else if (chart.splitByDimension) {
      // One line per dimension value (e.g. per provider).
      const metric = chart.series[0]?.metricKey;
      const groups = await apiJson<GroupedSeries[]>(
        `/api/stats/series-grouped?metric=${metric}&days=${days.value}`,
      );
      series.value = groups.map((g, i) => ({
        name:
          Object.values(g.dimensions).join(' / ') ||
          t(chart.series[0].labelKey),
        colorClass: PALETTE[i] ?? 'text-slate-500',
        points: g.points.map((p) => ({
          label: dayLabel(p.date),
          value: p.value,
        })),
      }));
    } else {
      // One line per declared metric.
      const fetched = await Promise.all(
        chart.series.map((s) =>
          apiJson<SeriesPoint[]>(
            `/api/stats/series?metric=${s.metricKey}&days=${days.value}`,
          ),
        ),
      );
      series.value = fetched.map((points, i) => ({
        name: t(chart.series[i].labelKey),
        colorClass: PALETTE[i] ?? 'text-slate-500',
        points: points.map((p) => ({
          label: dayLabel(p.date),
          value: p.value,
        })),
      }));
    }
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(load);

const isEmpty = computed<boolean>(() => !isGraph.value && total.value === 0);
</script>

<template>
  <section class="flex flex-col gap-3">
    <h3
      class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
    >
      <ChartColumn class="w-5 h-5 text-brand-500 dark:text-brand-400" />
      {{ t(chart.titleKey) }}
    </h3>

    <div
      v-if="loading"
      class="glass-card rounded-2xl p-6 flex justify-center py-16 flex-1"
    >
      <Spinner />
    </div>

    <div v-else-if="failed" class="glass-card rounded-2xl flex-1">
      <EmptyState :title="t('stats.view.chartFailed')" :icon="ChartColumn" />
    </div>

    <!-- Graph forms (sankey) render richly on the dashboard, not here. -->
    <div v-else-if="isGraph" class="glass-card rounded-2xl flex-1">
      <EmptyState
        :title="t('stats.view.graphOnDashboard')"
        :description="t('stats.view.graphOnDashboardHint')"
        :icon="ChartColumn"
      />
    </div>

    <div v-else-if="isEmpty" class="glass-card rounded-2xl flex-1">
      <EmptyState :title="t('stats.view.chartEmpty')" :icon="ChartColumn" />
    </div>

    <div v-else class="glass-card rounded-2xl p-5 flex-1">
      <ContributionHeatmap
        v-if="isHeatmap"
        :data="heatmap"
        :weeks="52"
        :aria-label="
          t('stats.view.chartAria', { title: t(chart.titleKey), total })
        "
      />
      <SparkAreaChart
        v-else
        :series="series"
        :aria-label="
          t('stats.view.chartAria', { title: t(chart.titleKey), total })
        "
      />
    </div>
  </section>
</template>
