<script setup lang="ts">
// The bench — the home dashboard's hero (#90), owned by the projects plugin.
// Layout mirrors the accepted prototype "variant A": focus card + a vertical
// verb strip (plugins contribute into the `dashboard.actions` slot), then the
// aggregate ribbon, then the cross-project task queue. All figures come from
// GET /api/projects/bench; this component only lays them out.
import { computed, type Component } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  FolderGit,
  ListChecks,
  PackageX,
  Truck,
} from '@lucide/vue';
import {
  EmptyState,
  PluginSlot,
  Spinner,
  useUxMode,
} from '@makekeeper/frontend-core';
import ProjectStatusDonutWidget from './ProjectStatusDonutWidget.vue';
import ProjectActivityWidget from './ProjectActivityWidget.vue';
import type { BenchProject, BenchSummary } from '../../bench';
import {
  flattenTasks,
  formatBenchDay,
  useBenchData,
  type BenchQueueTask,
} from './bench-data';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { loading, failed, projects, summary } = useBenchData();

// The bench's own charts are the only analytics simple mode would otherwise
// still show on the home screen (#269) — they are composed here rather than
// registered as widgets, so the lens has to be applied by their host.
const { isFeatureVisible } = useUxMode();
const benchChartsVisible = computed<boolean>(() =>
  isFeatureVisible('projects.benchCharts'),
);

// ── Focus project (route-driven, defaults to closest-to-buildable) ───────────
const focus = computed<BenchProject | null>(() => {
  const pinned = String(route.query.focus ?? '');
  return (
    projects.value.find((p) => p.id === pinned) ?? projects.value[0] ?? null
  );
});

function pickFocus(id: string): void {
  void router.replace({ query: { ...route.query, focus: id } });
}

const SEGMENTS = [
  { key: 'reserved', field: 'reserved', class: 'bg-emerald-500' },
  { key: 'inStock', field: 'inStock', class: 'bg-brand-500' },
  { key: 'onOrder', field: 'onOrder', class: 'bg-amber-400' },
  { key: 'missing', field: 'missing', class: 'bg-red-500' },
] as const;

function segmentWidth(
  project: BenchProject,
  field: keyof BenchProject,
): string {
  return project.total
    ? `${(Number(project[field]) / project.total) * 100}%`
    : '0%';
}

// This project's own shortfalls, worst first (not ordered before merely in transit).
const blockers = computed(() => {
  const lines = focus.value?.lines ?? [];
  return [...lines]
    .filter((l) => l.deficit > 0)
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === 'missing' ? -1 : 1;
      return b.deficit - a.deficit;
    })
    .slice(0, 5);
});

// ── Ribbon (one line of aggregate figures) ───────────────────────────────────
interface RibbonCell {
  key: string;
  icon: Component;
  value: number;
  label: string;
}

const ribbon = computed<RibbonCell[]>(() => {
  const s: BenchSummary = summary.value;
  const cells: RibbonCell[] = [
    {
      key: 'buildable',
      icon: CircleCheck,
      value: s.buildable,
      label: t('projects.bench.ribbon.buildable'),
    },
    {
      key: 'notOrdered',
      icon: CircleAlert,
      value: s.notOrdered,
      label: t('projects.bench.ribbon.notOrdered'),
    },
  ];
  // incoming/unplaced are null while logistics/inventory are disabled — hide the
  // cell rather than show a misleading zero.
  if (s.incoming !== null) {
    cells.push({
      key: 'incoming',
      icon: Truck,
      value: s.incoming,
      label: t('projects.bench.ribbon.incoming'),
    });
  }
  if (s.unplaced !== null) {
    cells.push({
      key: 'unplaced',
      icon: Boxes,
      value: s.unplaced,
      label: t('projects.bench.ribbon.unplaced'),
    });
  }
  return cells;
});

// ── Task queue (route-driven filter) ─────────────────────────────────────────
type QueueFilter = 'ready' | 'waitingOrder' | 'noParts' | 'all';
const TABS: QueueFilter[] = ['ready', 'waitingOrder', 'noParts', 'all'];

const allTasks = computed<BenchQueueTask[]>(() => flattenTasks(projects.value));

const filter = computed<QueueFilter>(() => {
  const value = String(route.query.tasks ?? 'ready');
  return TABS.includes(value as QueueFilter) ? (value as QueueFilter) : 'ready';
});

function setFilter(value: QueueFilter): void {
  void router.replace({ query: { ...route.query, tasks: value } });
}

const queue = computed<BenchQueueTask[]>(() =>
  filter.value === 'all'
    ? allTasks.value
    : allTasks.value.filter((task) => task.state === filter.value),
);

const counts = computed<Record<QueueFilter, number>>(() => ({
  ready: allTasks.value.filter((t) => t.state === 'ready').length,
  waitingOrder: allTasks.value.filter((t) => t.state === 'waitingOrder').length,
  noParts: allTasks.value.filter((t) => t.state === 'noParts').length,
  all: allTasks.value.length,
}));

const STATE_STYLE = {
  ready: {
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: CircleCheck,
  },
  waitingOrder: {
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: Clock,
  },
  noParts: {
    chip: 'bg-red-500/10 text-red-600 dark:text-red-400',
    icon: PackageX,
  },
} as const;

function taskNote(task: BenchQueueTask): string {
  if (task.state === 'waitingOrder' && task.waitingFor) {
    return t('projects.bench.queue.waiting', {
      store: task.waitingFor.storeName,
      date: formatBenchDay(task.waitingFor.estimatedDelivery),
    });
  }
  if (task.state === 'noParts') {
    return t('projects.bench.queue.shortOf', {
      names: task.shortOf.slice(0, 2).join(', '),
    });
  }
  return t('projects.bench.queue.ready');
}
</script>

<template>
  <div v-if="loading" class="glass-card rounded-2xl flex justify-center py-16">
    <Spinner />
  </div>

  <div v-else-if="failed" class="glass-card rounded-2xl">
    <EmptyState
      :title="t('projects.bench.loadFailed')"
      :description="''"
      :icon="FolderGit"
    />
  </div>

  <div v-else-if="!projects.length" class="glass-card rounded-2xl">
    <EmptyState
      :title="t('projects.bench.empty')"
      :description="t('projects.bench.emptyHint')"
      :icon="FolderGit"
    />
  </div>

  <div v-else class="space-y-6">
    <!-- Bench: focus card (2/3) + vertical verb strip (1/3). -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <section
        v-if="focus"
        class="lg:col-span-2 glass-card rounded-2xl p-6 flex flex-col gap-5"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p
              class="text-xxs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400"
            >
              {{ t('projects.bench.focus') }}
            </p>
            <h3
              class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white truncate mt-1"
            >
              {{ focus.title }}
            </h3>
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500 dark:text-slate-400"
            >
              <span v-if="focus.dueDate" class="flex items-center gap-1.5">
                <CalendarClock class="w-3.5 h-3.5" />
                {{
                  t('projects.bench.due', {
                    date: formatBenchDay(focus.dueDate),
                  })
                }}
              </span>
              <span>{{
                t('projects.bench.openTasks', { n: focus.openTasks })
              }}</span>
            </div>
          </div>
          <RouterLink
            :to="`/projects/${focus.id}`"
            class="shrink-0 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {{ t('projects.bench.open') }}
            <ArrowRight class="w-3.5 h-3.5" />
          </RouterLink>
        </div>

        <!-- Verdict + readiness bar. -->
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-3">
            <span
              class="text-sm font-semibold flex items-center gap-1.5"
              :class="
                focus.buildable
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              "
            >
              <CircleCheck v-if="focus.buildable" class="w-4 h-4" />
              <Clock v-else-if="focus.unblockAt" class="w-4 h-4" />
              <template v-if="focus.buildable">
                {{ t('projects.bench.canBuild') }}
              </template>
              <template v-else-if="focus.unblockAt">
                {{
                  t('projects.bench.unblocks', {
                    date: formatBenchDay(focus.unblockAt),
                  })
                }}
              </template>
              <template v-else>
                {{ t('projects.bench.notOrdered') }}
              </template>
            </span>
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{
                t('projects.bench.parts', {
                  secured: focus.reserved + focus.inStock,
                  total: focus.total,
                })
              }}
            </span>
          </div>

          <div
            class="h-3 rounded-full overflow-hidden flex bg-slate-200/70 dark:bg-white/5"
          >
            <div
              v-for="segment in SEGMENTS"
              :key="segment.key"
              class="h-full transition-all"
              :class="segment.class"
              :style="{ width: segmentWidth(focus, segment.field) }"
            />
          </div>
          <div
            class="flex flex-wrap gap-x-4 gap-y-1 text-xxs text-slate-500 dark:text-slate-400"
          >
            <span
              v-for="segment in SEGMENTS"
              :key="segment.key"
              class="flex items-center gap-1.5"
            >
              <span class="w-2 h-2 rounded-full" :class="segment.class" />
              {{ t(`projects.bench.seg.${segment.key}`) }}
            </span>
          </div>
        </div>

        <!-- This project's blockers. -->
        <div>
          <p
            class="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2"
          >
            {{ t('projects.bench.blockers') }}
          </p>
          <ul v-if="blockers.length" class="space-y-1.5">
            <li v-for="line in blockers" :key="line.componentId">
              <RouterLink
                :to="`/inventory/${line.componentId}/edit`"
                class="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
                :class="
                  line.state === 'onOrder'
                    ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
                    : 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
                "
              >
                <span
                  class="text-sm text-slate-800 dark:text-slate-200 truncate"
                >
                  {{ line.name }}
                </span>
                <span
                  class="text-xs font-semibold shrink-0 tabular-nums"
                  :class="
                    line.state === 'onOrder'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                  "
                >
                  {{
                    t(
                      line.state === 'onOrder'
                        ? 'projects.bench.onOrderN'
                        : 'projects.bench.shortN',
                      { n: line.deficit },
                    )
                  }}
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-else class="text-sm text-emerald-600 dark:text-emerald-400">
            {{ t('projects.bench.noBlockers') }}
          </p>
        </div>

        <!-- Focus picker. -->
        <div
          v-if="projects.length > 1"
          class="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-white/5"
        >
          <span class="text-xxs text-slate-500 dark:text-slate-400 pt-2 mr-1">
            {{ t('projects.bench.switch') }}
          </span>
          <button
            v-for="project in projects"
            :key="project.id"
            type="button"
            class="mt-2 px-3 py-1.5 rounded-full text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            :class="
              project.id === focus.id
                ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-semibold'
                : 'bg-slate-100/70 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-brand-500/10'
            "
            @click="pickFocus(project.id)"
          >
            {{ project.title }}
            <span class="opacity-60 tabular-nums">{{ project.percent }}%</span>
          </button>
        </div>
      </section>

      <!-- Verb strip: plugin-contributed actions, urgent verbs first. Vertical
           on desktop, wrapping row on mobile. Empty while every owner plugin
           is disabled. -->
      <nav
        class="glass-card rounded-2xl p-3 flex flex-row lg:flex-col flex-wrap gap-2 overflow-x-auto"
      >
        <PluginSlot name="dashboard.actions" />
      </nav>
    </div>

    <!-- Ribbon: one line of aggregate figures. -->
    <div
      v-if="ribbon.length"
      class="glass-card rounded-2xl px-2 py-2 grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-200/60 dark:divide-white/5"
    >
      <div
        v-for="cell in ribbon"
        :key="cell.key"
        class="flex items-center gap-3 px-4 py-2"
      >
        <component
          :is="cell.icon"
          class="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0"
        />
        <div class="min-w-0">
          <p
            class="text-lg font-bold leading-none text-slate-900 dark:text-white"
          >
            {{ cell.value }}
          </p>
          <p
            class="text-xxs text-slate-500 dark:text-slate-400 truncate mt-0.5"
          >
            {{ cell.label }}
          </p>
        </div>
      </div>
    </div>

    <!-- Lower bench: project charts stacked on the left, task queue on the right.
         Grid stretch (the default) makes the queue card as tall as the two
         stacked cards on the left. With the charts hidden (#269) the grid
         collapses to one column so the queue spans the bench instead of
         leaving the left half empty. -->
    <div
      class="grid grid-cols-1 gap-6"
      :class="{ 'lg:grid-cols-2': benchChartsVisible }"
    >
      <!-- Left column: project status over activity. Each widget carries its own
           card + heading (styled like the task-queue card). -->
      <div v-if="benchChartsVisible" class="space-y-6">
        <ProjectStatusDonutWidget />
        <ProjectActivityWidget />
      </div>

      <!-- Right column: task queue. `h-full` so grid-stretch fills the row height. -->
      <section class="glass-card rounded-2xl p-5 space-y-4 h-full">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3
            class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"
          >
            <ListChecks class="w-5 h-5 text-brand-500 dark:text-brand-400" />
            {{ t('projects.bench.queue.title') }}
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ t('projects.bench.queue.summary', { n: summary.buildable }) }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in TABS"
            :key="tab"
            type="button"
            class="px-3 py-1.5 rounded-full text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            :class="
              filter === tab
                ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-semibold'
                : 'bg-slate-100/70 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-brand-500/10'
            "
            @click="setFilter(tab)"
          >
            {{ t(`projects.bench.queue.tab.${tab}`) }}
            <span class="opacity-60 tabular-nums">{{ counts[tab] }}</span>
          </button>
        </div>

        <ul
          v-if="queue.length"
          class="divide-y divide-slate-200/50 dark:divide-white/5"
        >
          <li v-for="task in queue.slice(0, 5)" :key="task.id">
            <RouterLink
              :to="`/projects/${task.projectId}/tasks/${task.id}`"
              class="flex items-center gap-4 py-3 px-2 rounded-xl hover:bg-slate-100/60 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            >
              <span
                class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                :class="STATE_STYLE[task.state].chip"
              >
                <component :is="STATE_STYLE[task.state].icon" class="w-4 h-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span
                  class="block text-sm font-medium text-slate-900 dark:text-white truncate"
                >
                  {{ task.title }}
                </span>
                <span
                  class="block text-xxs text-slate-500 dark:text-slate-400 truncate"
                >
                  {{ task.projectTitle }} · {{ taskNote(task) }}
                </span>
              </span>
              <span
                v-if="task.priority === 'HIGH'"
                class="text-xxs font-semibold text-red-600 dark:text-red-400 shrink-0"
              >
                {{ t('projects.bench.queue.high') }}
              </span>
              <span
                v-if="task.dueDate"
                class="text-xxs text-slate-500 dark:text-slate-400 shrink-0"
              >
                {{ formatBenchDay(task.dueDate) }}
              </span>
            </RouterLink>
          </li>
        </ul>

        <EmptyState
          v-else
          :title="t(`projects.bench.queue.empty.${filter}`)"
          :description="t('projects.bench.queue.emptyHint')"
          :icon="ListChecks"
        />
      </section>
    </div>
  </div>
</template>
