<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { MessageSquareOff } from '@lucide/vue';
import {
  apiJson,
  EmptyState,
  SparkAreaChart,
  Spinner,
  type SparkSeries,
} from '@makekeeper/frontend-core';

// Dashboard panel: real assistant activity for the last two weeks — messages
// the user sent and agent tool calls that executed, per day, from
// GET /api/chat/activity. Two series on one scale; the palette (brand-500 +
// emerald-600, same steps in both modes) is CVD-validated.
interface ActivityDay {
  date: string;
  messages: number;
  toolActions: number;
}

const DAYS = 14;

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const days = ref<ActivityDay[]>([]);

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  });

const series = computed<SparkSeries[]>(() => [
  {
    name: t('chat.dashboard.seriesMessages'),
    colorClass: 'text-brand-500',
    points: days.value.map((d) => ({
      label: dayLabel(d.date),
      value: d.messages,
    })),
  },
  {
    name: t('chat.dashboard.seriesActions'),
    colorClass: 'text-emerald-600',
    points: days.value.map((d) => ({
      label: dayLabel(d.date),
      value: d.toolActions,
    })),
  },
]);

const totals = computed<{ messages: number; actions: number }>(() => ({
  messages: days.value.reduce((acc, d) => acc + d.messages, 0),
  actions: days.value.reduce((acc, d) => acc + d.toolActions, 0),
}));

onMounted(async () => {
  try {
    days.value = await apiJson<ActivityDay[]>(
      `/api/chat/activity?days=${DAYS}`,
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

  <div v-else-if="!failed" class="glass-card rounded-2xl p-5 space-y-4">
    <p class="text-xs text-slate-500 dark:text-slate-400">
      {{
        t('chat.dashboard.activityHint', {
          messages: totals.messages,
          actions: totals.actions,
        })
      }}
    </p>
    <SparkAreaChart
      :series="series"
      :aria-label="
        t('chat.dashboard.activityAria', {
          messages: totals.messages,
          actions: totals.actions,
        })
      "
    />
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState
      :title="t('chat.dashboard.loadFailed')"
      :icon="MessageSquareOff"
    />
  </div>
</template>
