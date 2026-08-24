<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChartPie } from '@lucide/vue';
import {
  DonutChart,
  EmptyState,
  Spinner,
  type DonutSegment,
} from '@makekeeper/frontend-core';
import {
  fetchDashboardProjects,
  type DashboardProjectSummary,
} from './projects-dashboard-data';

// Dashboard panel: how the projects split across lifecycle statuses — real
// data from GET /api/projects. Colors follow the app's status hues (the same
// families the projects list uses); the exact steps are a CVD-validated
// categorical palette — light and dark picked separately. Color follows the
// status, never its rank: a missing status just drops out, survivors keep
// their hue.
const STATUS_ORDER = [
  'IDEA',
  'PLANNING',
  'IN_PROGRESS',
  'TESTING',
  'COMPLETED',
] as const;

type ProjectStatus = (typeof STATUS_ORDER)[number];

const STATUS_META: Record<
  ProjectStatus,
  { labelKey: string; colorClass: string }
> = {
  IDEA: {
    labelKey: 'projects.status.idea',
    colorClass: 'text-indigo-500',
  },
  PLANNING: {
    labelKey: 'projects.status.planning',
    colorClass: 'text-amber-500 dark:text-amber-600',
  },
  IN_PROGRESS: {
    labelKey: 'projects.status.inProgress',
    colorClass: 'text-brand-500',
  },
  TESTING: {
    labelKey: 'projects.status.testing',
    colorClass: 'text-purple-700 dark:text-purple-600',
  },
  COMPLETED: {
    labelKey: 'projects.status.completed',
    colorClass: 'text-emerald-500 dark:text-emerald-600',
  },
};

const isKnownStatus = (status: string): status is ProjectStatus =>
  (STATUS_ORDER as readonly string[]).includes(status);

// How many recent projects fit beside the donut.
const MAX_RECENT = 6;

const { t } = useI18n();
const loading = ref(true);
const failed = ref(false);
const projects = ref<DashboardProjectSummary[]>([]);

const segments = computed<DonutSegment[]>(() => {
  const counts = new Map<ProjectStatus, number>();
  for (const p of projects.value) {
    if (!isKnownStatus(p.status)) continue;
    counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  }
  return STATUS_ORDER.flatMap((status) => {
    const value = counts.get(status) ?? 0;
    return value > 0
      ? [
          {
            label: t(STATUS_META[status].labelKey),
            value,
            colorClass: STATUS_META[status].colorClass,
          },
        ]
      : [];
  });
});

// Beside the donut: projects by last activity, newest first, the status dot
// carrying the segment's color (so the color↔status mapping stays visible)
// and the name linking to the project.
interface RecentRow {
  id: string;
  title: string;
  status: ProjectStatus;
}

const recent = computed<RecentRow[]>(() =>
  [...projects.value]
    .filter((p): p is DashboardProjectSummary & { status: ProjectStatus } =>
      isKnownStatus(p.status),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_RECENT)
    .map((p) => ({ id: p.id, title: p.title, status: p.status })),
);

onMounted(async () => {
  try {
    projects.value = await fetchDashboardProjects();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <!-- Single glass-card with the heading inside, matching the bench task-queue
       card (#90); the body switches state without nesting further cards. -->
  <section class="glass-card rounded-2xl p-5 space-y-4">
    <h3
      class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"
    >
      <ChartPie class="w-5 h-5 text-brand-500 dark:text-brand-400" />
      {{ t('projects.dashboard.statuses') }}
    </h3>

    <div v-if="loading" class="flex justify-center py-10">
      <Spinner />
    </div>

    <div v-else-if="segments.length" class="flex items-center">
      <DonutChart
        :segments="segments"
        :center-label="t('projects.dashboard.statusesCenter')"
        :aria-label="t('projects.dashboard.statusesAria')"
        class="w-full"
      >
        <ul class="space-y-1.5">
          <li
            v-for="row in recent"
            :key="row.id"
            class="flex items-center gap-2 text-xs min-w-0"
          >
            <span
              class="w-2.5 h-2.5 rounded-sm bg-current shrink-0"
              :class="STATUS_META[row.status].colorClass"
              :title="t(STATUS_META[row.status].labelKey)"
            ></span>
            <RouterLink
              :to="`/projects/${row.id}`"
              class="text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 truncate transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-md"
            >
              {{ row.title }}
            </RouterLink>
          </li>
        </ul>
      </DonutChart>
    </div>

    <EmptyState
      v-else
      :title="
        failed
          ? t('projects.dashboard.loadFailed')
          : t('projects.dashboard.noActiveProjects')
      "
      :description="failed ? '' : t('projects.dashboard.createProjectHint')"
      :icon="ChartPie"
    />
  </section>
</template>
