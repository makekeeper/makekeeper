<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Gauge } from '@lucide/vue';

// Project key figures at a glance (#54 companion). Prop-driven from the project
// the parent already loaded — no fetch.
const props = defineProps<{
  project: {
    tasksCount: number;
    completedTasksCount: number;
    components: { reservedQty: number }[];
    budgetPlanned?: number;
    actualBudget: number;
  } | null;
}>();

const { t } = useI18n();

const reserved = computed<number>(() =>
  (props.project?.components ?? []).reduce((a, c) => a + c.reservedQty, 0),
);
const budgetLabel = computed<string>(() => {
  const p = props.project;
  if (!p?.budgetPlanned || p.budgetPlanned <= 0)
    return t('projectDetail.kpi.noBudget');
  return t('projectDetail.kpi.budgetSpent', {
    percent: Math.round((p.actualBudget / p.budgetPlanned) * 100),
  });
});

interface Tile {
  label: string;
  value: string;
}
const tiles = computed<Tile[]>(() => [
  {
    label: t('projectDetail.kpi.tasks'),
    value: `${props.project?.completedTasksCount ?? 0} / ${props.project?.tasksCount ?? 0}`,
  },
  {
    label: t('projectDetail.kpi.reserved'),
    value: t('projectDetail.kpi.reservedUnit', { n: reserved.value }),
  },
  { label: t('projectDetail.kpi.budget'), value: budgetLabel.value },
  {
    label: t('projectDetail.kpi.components'),
    value: String(props.project?.components.length ?? 0),
  },
]);
</script>

<template>
  <section class="glass-card rounded-2xl p-5 flex flex-col gap-3">
    <h3
      class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
    >
      <Gauge class="w-5 h-5 text-brand-500 dark:text-brand-400" />
      {{ t('projectDetail.kpi.title') }}
    </h3>

    <div class="grid grid-cols-2 gap-3">
      <div
        v-for="(tile, i) in tiles"
        :key="i"
        class="rounded-xl bg-slate-100/60 dark:bg-white/5 p-3"
      >
        <p
          class="text-lg font-semibold text-slate-900 dark:text-white truncate"
        >
          {{ tile.value }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ tile.label }}
        </p>
      </div>
    </div>
  </section>
</template>
