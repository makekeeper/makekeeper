<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Activity, FolderGit } from '@lucide/vue';
import {
  apiJson,
  ContributionHeatmap,
  EmptyState,
  Spinner,
  type HeatmapDay,
} from '@makekeeper/frontend-core';

// Dashboard panel: a GitHub-style contribution calendar of real project activity
// (actions per day) across all the caller's projects for the last 12 months,
// read from the stats series API (GET /api/stats/series?metric=projects.activity)
// backed by the daily aggregate table (ticket #54, on the #56 stats pipeline).
const WEEKS = 52;
const DAYS = 365;

const { t } = useI18n();
const loading = ref(true);
const failed = ref(false);
const points = ref<{ date: string; value: number }[]>([]);

const data = computed<HeatmapDay[]>(() =>
  points.value.map((p) => ({ date: p.date, count: p.value })),
);
const total = computed<number>(() =>
  points.value.reduce((acc, p) => acc + p.value, 0),
);

onMounted(async () => {
  try {
    points.value = await apiJson<{ date: string; value: number }[]>(
      `/api/stats/series?metric=projects.activity&days=${DAYS}`,
    );
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <!-- Single glass-card with the heading inside, matching the bench task-queue
       card (#90). -->
  <section class="glass-card rounded-2xl p-5 space-y-4">
    <!-- Heading row: title left, the activity summary right (like the task-queue
         card's "N fully stocked" line). -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3
        class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"
      >
        <Activity class="w-5 h-5 text-brand-500 dark:text-brand-400" />
        {{ t('projects.dashboard.activity') }}
      </h3>
      <p
        v-if="!loading && !failed"
        class="text-xs text-slate-500 dark:text-slate-400"
      >
        {{ t('projects.dashboard.activityHint', { total }) }}
      </p>
    </div>

    <div v-if="loading" class="flex justify-center py-10">
      <Spinner />
    </div>

    <EmptyState
      v-else-if="failed"
      :title="t('projects.dashboard.activityFailed')"
      :icon="FolderGit"
    />

    <ContributionHeatmap
      v-else
      :data="data"
      :weeks="WEEKS"
      :aria-label="t('projects.dashboard.activityAria', { total })"
    />
  </section>
</template>
