<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Activity } from '@lucide/vue';
import {
  apiJson,
  ContributionHeatmap,
  EmptyState,
  Spinner,
  type HeatmapDay,
} from '@makekeeper/frontend-core';

// Per-project Activity calendar (ticket #54): the same contribution heatmap as
// the dashboard, filtered to ONE project via the stats series API's dimension
// filter. Shown inside the project detail Dashboard tab, gated behind the
// `projects.activityCalendar` advanced UX feature by the parent.
const props = defineProps<{ projectId: string }>();

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

const load = async (): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    points.value = await apiJson<{ date: string; value: number }[]>(
      `/api/stats/series?metric=projects.activity&days=${DAYS}` +
        `&dimensionKey=projectId&dimensionValue=${encodeURIComponent(props.projectId)}`,
    );
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(load);
watch(() => props.projectId, load);
</script>

<template>
  <section class="glass-card rounded-2xl p-5 space-y-4">
    <h3
      class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
    >
      <Activity class="w-5 h-5 text-brand-500 dark:text-brand-400" />
      {{ t('projects.activityCalendar.title') }}
    </h3>

    <div v-if="loading" class="flex justify-center py-12">
      <Spinner />
    </div>

    <EmptyState
      v-else-if="failed"
      :title="t('projects.activityCalendar.failed')"
      :icon="Activity"
    />

    <template v-else>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ t('projects.activityCalendar.hint', { total }) }}
      </p>
      <ContributionHeatmap
        :data="data"
        :weeks="WEEKS"
        :aria-label="t('projects.activityCalendar.aria', { total })"
      />
    </template>
  </section>
</template>
