<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Spinner,
  EmptyState,
  SparkAreaChart,
  DonutChart,
  apiJson,
  useToastStore,
  type SparkSeries,
  type DonutSegment,
} from '@makekeeper/frontend-core';
import { BarChart3 } from '@lucide/vue';
import type { ActivityDay, ProjectUsage, ProjectJournal } from './types';

const props = defineProps<{ projectId: string }>();

const { t } = useI18n();
const toast = useToastStore();

const activity = ref<ActivityDay[]>([]);
const usage = ref<ProjectUsage | null>(null);
const journal = ref<ProjectJournal | null>(null);
const loading = ref(true);

const shortDay = (iso: string): string => iso.slice(5).replace('-', '/');

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const [a, u, j] = await Promise.all([
      apiJson<ActivityDay[]>(`/api/chat/projects/${props.projectId}/activity`),
      apiJson<ProjectUsage>(`/api/chat/projects/${props.projectId}/usage`),
      apiJson<ProjectJournal>(
        `/api/chat/projects/${props.projectId}/journal?includeRead=true`,
      ),
    ]);
    activity.value = a;
    usage.value = u;
    journal.value = j;
  } catch {
    toast.error(t('projectDetail.ai.charts.error'));
  } finally {
    loading.value = false;
  }
};

const hasActivity = computed<boolean>(() =>
  activity.value.some((d) => d.messages > 0 || d.toolActions > 0),
);

const activitySeries = computed<SparkSeries[]>(() => [
  {
    name: t('projectDetail.ai.charts.messages'),
    colorClass: 'text-brand-500',
    points: activity.value.map((d) => ({
      label: shortDay(d.date),
      value: d.messages,
    })),
  },
  {
    name: t('projectDetail.ai.charts.toolActions'),
    colorClass: 'text-emerald-500',
    points: activity.value.map((d) => ({
      label: shortDay(d.date),
      value: d.toolActions,
    })),
  },
]);

const hasTokens = computed<boolean>(
  () => (usage.value?.totals.tokens ?? 0) > 0,
);

const tokenSeries = computed<SparkSeries[]>(() => [
  {
    name: t('projectDetail.ai.charts.tokens'),
    colorClass: 'text-amber-500',
    points: (usage.value?.days ?? []).map((d) => ({
      label: shortDay(d.date),
      value: d.tokens,
    })),
  },
]);

const permissionSegments = computed<DonutSegment[]>(() => {
  const by = journal.value?.summary.byPermission;
  if (!by) return [];
  return [
    {
      label: t('projectDetail.ai.journal.permission.WRITE'),
      value: by.WRITE,
      colorClass: 'text-amber-500',
    },
    {
      label: t('projectDetail.ai.journal.permission.DESTRUCTIVE'),
      value: by.DESTRUCTIVE,
      colorClass: 'text-red-500',
    },
    {
      label: t('projectDetail.ai.journal.permission.READ'),
      value: by.READ,
      colorClass: 'text-brand-500',
    },
    {
      label: t('projectDetail.ai.journal.permission.unknown'),
      value: by.unknown,
      colorClass: 'text-slate-400',
    },
  ].filter((s) => s.value > 0);
});

onMounted(load);
defineExpose({ reload: load });
</script>

<template>
  <!-- Loading: a single placeholder card until all three series arrive. -->
  <div
    v-if="loading"
    class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 flex justify-center py-10"
  >
    <Spinner />
  </div>

  <template v-else>
    <!-- Assistant messages -->
    <div
      class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 space-y-3"
    >
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('projectDetail.ai.charts.activityTitle') }}
      </h3>
      <SparkAreaChart
        v-if="hasActivity"
        :series="activitySeries"
        :aria-label="t('projectDetail.ai.charts.activityTitle')"
      />
      <EmptyState
        v-else
        :icon="BarChart3"
        :title="t('projectDetail.ai.charts.noData')"
      />
    </div>

    <!-- Tokens per day + totals -->
    <div
      class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 space-y-3"
    >
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('projectDetail.ai.charts.tokensTitle') }}
      </h3>
      <SparkAreaChart
        v-if="hasTokens"
        :series="tokenSeries"
        :aria-label="t('projectDetail.ai.charts.tokensTitle')"
      />
      <EmptyState
        v-else
        :icon="BarChart3"
        :title="t('projectDetail.ai.charts.noData')"
      />
      <div
        v-if="usage"
        class="flex flex-wrap gap-4 text-xxs text-slate-500 dark:text-slate-400 pt-1"
      >
        <span>{{
          t('projectDetail.ai.charts.totalRequests', {
            count: usage.totals.requests,
          })
        }}</span>
        <span>{{
          t('projectDetail.ai.charts.totalTokens', {
            count: usage.totals.tokens,
          })
        }}</span>
        <span>{{
          t('projectDetail.ai.charts.totalErrors', {
            count: usage.totals.errors,
          })
        }}</span>
      </div>
    </div>

    <!-- Tool calls by permission level -->
    <div
      class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 space-y-3"
    >
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('projectDetail.ai.charts.toolsByLevel') }}
      </h3>
      <div v-if="permissionSegments.length" class="max-w-[220px]">
        <DonutChart
          :segments="permissionSegments"
          :center-label="t('projectDetail.ai.charts.toolCalls')"
          :aria-label="t('projectDetail.ai.charts.toolsByLevel')"
        />
      </div>
      <EmptyState
        v-else
        :icon="BarChart3"
        :title="t('projectDetail.ai.charts.noData')"
      />
    </div>
  </template>
</template>
