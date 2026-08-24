<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChartColumn } from '@lucide/vue';
import {
  apiJson,
  EmptyState,
  SparkAreaChart,
  Spinner,
  type SparkSeries,
} from '@makekeeper/frontend-core';

// Pilot dashboard panel for the stats architecture (ticket #56): assistant
// messages per day, read from the generic series API (GET /api/stats/series)
// backed by the daily aggregate table — NOT a bespoke per-widget endpoint. The
// existing chat-activity widget still uses its own endpoint; this one proves
// the stats pipeline end-to-end for the `chat.messages` metric.
interface SeriesPoint {
  date: string;
  value: number;
}

const METRIC = 'chat.messages';
const DAYS = 14;

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const points = ref<SeriesPoint[]>([]);

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  });

const total = computed<number>(() =>
  points.value.reduce((acc, p) => acc + p.value, 0),
);

const series = computed<SparkSeries[]>(() => [
  {
    name: t('stats.dashboard.pilot.series'),
    colorClass: 'text-brand-500',
    points: points.value.map((p) => ({
      label: dayLabel(p.date),
      value: p.value,
    })),
  },
]);

onMounted(async () => {
  try {
    points.value = await apiJson<SeriesPoint[]>(
      `/api/stats/series?metric=${METRIC}&days=${DAYS}`,
    );
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

  <div v-else-if="failed" class="glass-card rounded-2xl">
    <EmptyState
      :title="t('stats.dashboard.pilot.loadFailed')"
      :icon="ChartColumn"
    />
  </div>

  <div v-else-if="total === 0" class="glass-card rounded-2xl">
    <EmptyState
      :title="t('stats.dashboard.pilot.empty')"
      :description="t('stats.dashboard.pilot.emptyHint')"
      :icon="ChartColumn"
    />
  </div>

  <div v-else class="glass-card rounded-2xl p-5 space-y-4">
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{ t('stats.dashboard.pilot.hint', { total, days: DAYS }) }}
    </p>
    <SparkAreaChart
      :series="series"
      :aria-label="t('stats.dashboard.pilot.aria', { total, days: DAYS })"
    />
  </div>
</template>
