<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChartColumn } from '@lucide/vue';
import {
  EmptyState,
  PageHeader,
  getPluginStatsCharts,
  usePluginsStore,
  useUxMode,
  type RegisteredStatsChart,
} from '@makekeeper/frontend-core';
import StatsChartCard from './StatsChartCard.vue';

// The /stats view surfaces every chart plugins declare via `statsCharts`
// (ticket #56), rendered generically — the declaring plugin owns the meaning,
// the stats plugin owns the rendering. A chart's simple/advanced split is
// declared in its manifest; advanced charts are hidden in simple mode unless
// the user re-enabled them (per-chart override, same as a uxFeature).
const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { isFeatureVisible } = useUxMode();

const charts = computed<RegisteredStatsChart[]>(() =>
  getPluginStatsCharts().filter(
    (c) =>
      pluginsStore.isEnabled(c.pluginId) &&
      (c.advanced !== true || isFeatureVisible(c.key)),
  ),
);
</script>

<template>
  <!-- The app shell's <main> already pads pages (p-6 md:p-8); like every other
       view, the root is a bare full-width stack. -->
  <div class="space-y-6">
    <PageHeader :icon="ChartColumn" :title="t('stats.view.title')" />

    <div v-if="charts.length" class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <StatsChartCard v-for="chart in charts" :key="chart.key" :chart="chart" />
    </div>

    <div v-else class="glass-card rounded-2xl">
      <EmptyState
        :title="t('stats.view.empty')"
        :description="t('stats.view.emptyHint')"
        :icon="ChartColumn"
      />
    </div>
  </div>
</template>
