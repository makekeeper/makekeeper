<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import {
  previewUrl,
  Button,
  Spinner,
  Select,
  EmptyState,
  PageHeader,
  PluginSlot,
  apiFetch,
  sanitizeHtml,
  useAgentDataChanged,
  useToastStore,
  useUxMode,
} from '@makekeeper/frontend-core';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  useLocaleDate,
  dueStatus,
  DUE_STATUS_CLASS,
  PROJECT_STATUSES,
  PROJECT_STATUS_BUCKETS,
  BUCKET_CANONICAL_STATUS,
  BUCKET_LABEL_KEY,
  statusBucket,
  isProjectStatusBucket,
  type ProjectSummary,
  type ProjectStatus,
  PROJECT_STATUS_LABEL_KEY,
  PROJECT_STATUS_CHIP,
} from './shared';
import ProjectsBoard from './ProjectsBoard.vue';
import ProjectsGantt from './ProjectsGantt.vue';
import {
  FolderGit,
  Plus,
  Calendar,
  CheckSquare,
  Cpu,
  CircleDot,
  LayoutGrid,
  SquareKanban,
  GanttChart,
  Search,
  X,
  FolderTree,
} from '@lucide/vue';
import { useProjectGroupsStore } from './project-groups-store';

type Project = ProjectSummary;

const { t } = useI18n();
const toast = useToastStore();
const formatDate = useLocaleDate();
const route = useRoute();
const { isFeatureVisible } = useUxMode();

// Simple-mode lenses: buckets instead of the 5 statuses, and a trimmed filter
// bar. Neither ever mutates data — filtering/labels only.
const fullStatuses = computed<boolean>(() =>
  isFeatureVisible('projects.fullStatuses'),
);
const listFiltersVisible = computed<boolean>(() =>
  isFeatureVisible('projects.listFilters'),
);
// The card budget bar follows the SAME key as the detail view's budget widget
// (#269) — half the budget surface hidden and half showing was the audit's
// form/view asymmetry.
const budgetVisible = computed<boolean>(() =>
  isFeatureVisible('projects.budgetPlanning'),
);
// Project groups (#289): in simple mode a project just lives in General, so the
// whole surface — the filter chip, the manage action, the card's group — is off.
const groupsVisible = computed<boolean>(() =>
  isFeatureVisible('projects.groups'),
);
const groupsStore = useProjectGroupsStore();

// The timeline is an advanced surface (#294): planning by dates is exactly what
// simple mode sets aside, so the button is not rendered there.
const ganttVisible = computed<boolean>(() =>
  isFeatureVisible('projects.gantt'),
);

// View is route-driven (§5.3): ?view=board switches to the kanban, ?view=gantt
// to the timeline; default grid. A `gantt` in the URL while the lens hides it
// falls back to the grid rather than rendering a surface the mode denies.
type ProjectsViewMode = 'grid' | 'board' | 'gantt';

const view = computed<ProjectsViewMode>(() => {
  if (route.query.view === 'board') return 'board';
  if (route.query.view === 'gantt' && ganttVisible.value) return 'gantt';
  return 'grid';
});

const setView = (next: ProjectsViewMode): void => {
  router.replace({
    query: { ...route.query, view: next === 'grid' ? undefined : next },
  });
};

// Grid filters/search/sort are route-driven (§5.3): they live in route.query so
// deep links and back/forward restore them. The board view ignores them.
const queryStr = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const setQuery = (key: string, value: string): void => {
  router.replace({ query: { ...route.query, [key]: value || undefined } });
};

const searchQuery = computed<string>({
  get: () => queryStr(route.query.q),
  set: (v) => setQuery('q', v),
});
const statusFilter = computed<string>({
  get: () => queryStr(route.query.status),
  set: (v) => setQuery('status', v),
});
const tagFilter = computed<string>({
  get: () => queryStr(route.query.tag),
  set: (v) => setQuery('tag', v),
});
// The group filter is route state like every other filter, and it is resolved
// SERVER-side: `?group=` narrows to that group and everything below it, which
// only the backend's tree knows about.
const groupFilter = computed<string>({
  get: () => queryStr(route.query.group),
  set: (v) => setQuery('group', v),
});
const sortBy = computed<string>({
  get: () => queryStr(route.query.sort) || 'created',
  set: (v) => setQuery('sort', v === 'created' ? '' : v),
});

const hasActiveFilters = computed(
  () =>
    !!(
      searchQuery.value ||
      statusFilter.value ||
      tagFilter.value ||
      groupFilter.value
    ),
);

const clearFilters = (): void => {
  router.replace({
    query: {
      ...route.query,
      q: undefined,
      status: undefined,
      tag: undefined,
      group: undefined,
    },
  });
};

// Entity ids matching the active tag filter, reported by the tags-plugin slot
// (null = no tag chosen, or tags disabled). ANDed into the grid/board filtering.
const tagMatchIds = ref<Set<string> | null>(null);
const onTagMatches = (ids: string[] | null): void => {
  tagMatchIds.value = ids ? new Set(ids) : null;
};

// Canonical ORef of a project, passed to the tag slots.
const projectRef = (p: Project): string =>
  formatObjectRef({
    pluginId: 'projects',
    entityType: 'project',
    entityId: p.id,
  }) ?? '';

// "All groups" is a real absence of a filter, so it carries `empty: true` —
// the primitive mutes and rules it off from the groups below (§5.4).
const groupFilterOptions = computed(() => [
  { value: '', label: t('projects.groups.allGroups'), empty: true },
  ...groupsStore.options,
]);

// The group picker lives in the filter bar with the other filters. It earns a
// column once there is a second group to pick — General alone is not a choice.
// An active `?group=` always keeps it, whatever the count: a filter arrived at
// from the rail or an ORef must stay clearable.
const groupFilterVisible = computed<boolean>(
  () =>
    groupsVisible.value &&
    (groupsStore.groups.length > 1 || !!groupFilter.value),
);

// The filter bar sizes itself by how many pickers it actually shows, so an
// added column widens the row instead of squeezing the other three.
const filterGridClass = computed<string>(() => {
  const columns =
    1 + (groupFilterVisible.value ? 1 : 0) + (listFiltersVisible.value ? 2 : 0);
  if (columns === 4) return 'sm:grid-cols-2 lg:grid-cols-4 lg:w-[40rem]';
  if (columns === 3) return 'sm:grid-cols-3 lg:w-[30rem]';
  if (columns === 2) return 'sm:grid-cols-2 lg:w-96';
  return 'lg:w-48';
});

const groupNameOf = (p: Project): string =>
  groupsStore.byId.get(p.groupId)?.name ?? '';

const progressOf = (p: Project): number =>
  p.tasksCount === 0 ? 0 : p.completedTasksCount / p.tasksCount;

// Filtered + sorted list for the grid. Newest-first by default; the board keeps
// its own position order.
const filteredProjects = computed<Project[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = projects.value.filter((p) => {
    if (q && !`${p.title} ${p.description}`.toLowerCase().includes(q))
      return false;
    if (!matchesStatusFilter(p)) return false;
    if (tagMatchIds.value && !tagMatchIds.value.has(p.id)) return false;
    return true;
  });
  list = [...list];
  if (sortBy.value === 'due') {
    list.sort((a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    );
  } else if (sortBy.value === 'progress') {
    list.sort((a, b) => progressOf(b) - progressOf(a));
  } else {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return list;
});

// The status filter accepts either grain: a bucket value matches by
// statusBucket, a raw status matches exactly — so a deep link with the other
// mode's value still filters correctly instead of matching nothing.
const matchesStatusFilter = (p: Project): boolean => {
  const filter = statusFilter.value;
  if (!filter) return true;
  if (isProjectStatusBucket(filter)) return statusBucket(p.status) === filter;
  return p.status === filter;
};

const statusFilterOptions = computed(() =>
  fullStatuses.value
    ? [
        { value: '', label: t('projects.filters.allStatuses'), empty: true },
        { value: 'IDEA', label: t('projects.status.idea') },
        { value: 'PLANNING', label: t('projects.status.planning') },
        { value: 'IN_PROGRESS', label: t('projects.status.inProgress') },
        { value: 'TESTING', label: t('projects.status.testing') },
        { value: 'COMPLETED', label: t('projects.status.completed') },
      ]
    : [
        { value: '', label: t('projects.filters.allStatuses'), empty: true },
        ...PROJECT_STATUS_BUCKETS.map((bucket) => ({
          value: bucket,
          label: t(BUCKET_LABEL_KEY[bucket]),
        })),
      ],
);
const sortOptions = computed(() => [
  { value: 'created', label: t('projects.sort.created') },
  { value: 'due', label: t('projects.sort.due') },
  { value: 'progress', label: t('projects.sort.progress') },
]);

// Bumped only when the board must fully re-sync from the server (error revert).
// A normal successful drop does NOT refetch, so the board never flickers.
const boardRevision = ref(0);

const handleReorder = async (payload: {
  status: ProjectStatus;
  orderedIds: string[];
  movedId: string;
}): Promise<void> => {
  // Mirror the move onto the parent list in place so the stat tiles stay
  // accurate — no array replacement, so the board doesn't rebuild/flicker.
  // Only the dragged card changes status (movedId contract, #53) — in bucket
  // mode a column groups several statuses and untouched cards keep theirs.
  payload.orderedIds.forEach((id, index) => {
    const project = projects.value.find((p) => p.id === id);
    if (project) {
      if (id === payload.movedId) project.status = payload.status;
      project.position = index;
    }
  });
  try {
    const response = await apiFetch('/api/projects/board/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      toast.error(t('projects.toasts.saveFailed'));
      await fetchProjects();
      boardRevision.value++;
    }
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
    await fetchProjects();
    boardRevision.value++;
  }
};

const statusLabels = computed(() =>
  Object.fromEntries(
    PROJECT_STATUSES.map((status) => [
      status,
      t(PROJECT_STATUS_LABEL_KEY[status]),
    ]),
  ),
);

const statusColors = PROJECT_STATUS_CHIP;

// Card badge, mode-aware: full statuses show the raw status; buckets show the
// bucket label with the colour of the bucket's canonical status.
const cardStatusLabel = (p: Project): string =>
  fullStatuses.value
    ? statusLabels.value[p.status]
    : t(BUCKET_LABEL_KEY[statusBucket(p.status)]);
const cardStatusClass = (p: Project): string =>
  statusColors[
    fullStatuses.value
      ? p.status
      : BUCKET_CANONICAL_STATUS[statusBucket(p.status)]
  ];

const projects = ref<Project[]>([]);
const loading = ref(true);
const router = useRouter();

const fetchProjects = async () => {
  try {
    // The spinner replaces the whole list, so it is for the FIRST answer only;
    // refetches (filter change, agent turn) keep the previous cards on screen
    // until the fresh ones land — the repo's keepPreviousData idiom.
    loading.value = projects.value.length === 0;
    const query = groupFilter.value
      ? `?group=${encodeURIComponent(groupFilter.value)}`
      : '';
    const response = await apiFetch(`/api/projects${query}`);
    if (response.ok) {
      projects.value = await response.json();
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  } finally {
    loading.value = false;
  }
};

// An AI turn may have created, renamed, re-filed or deleted projects — refetch
// quietly, cards in place (the flicker this class of refresh once caused came
// from dropping state first, not from refreshing).
watch(useAgentDataChanged(), () => {
  void fetchProjects();
});

onMounted(() => {
  fetchProjects();
  if (groupsVisible.value) void groupsStore.ensureLoaded();
});

// The group filter is answered by the server, so changing it refetches rather
// than narrowing the list in place.
watch(groupFilter, () => {
  void fetchProjects();
});
</script>

<template>
  <div class="flex flex-col h-full min-h-0 space-y-6">
    <!-- Action Bar -->
    <PageHeader
      class="shrink-0"
      :title="$t('projects.title')"
      :subtitle="$t('projects.manageDesc')"
      :icon="FolderGit"
    >
      <template #actions>
        <!-- View toggle -->
        <div
          class="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100 dark:bg-white/5"
          role="group"
        >
          <button
            type="button"
            :aria-label="$t('projects.view.grid')"
            :title="$t('projects.view.grid')"
            class="p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            :class="
              view === 'grid'
                ? 'bg-white dark:bg-white/10 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            "
            @click="setView('grid')"
          >
            <LayoutGrid class="w-4 h-4" />
          </button>
          <button
            type="button"
            :aria-label="$t('projects.view.board')"
            :title="$t('projects.view.board')"
            class="p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            :class="
              view === 'board'
                ? 'bg-white dark:bg-white/10 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            "
            @click="setView('board')"
          >
            <SquareKanban class="w-4 h-4" />
          </button>
          <button
            v-if="ganttVisible"
            type="button"
            :aria-label="$t('projects.view.gantt')"
            :title="$t('projects.view.gantt')"
            class="p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            :class="
              view === 'gantt'
                ? 'bg-white dark:bg-white/10 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            "
            @click="setView('gantt')"
          >
            <GanttChart class="w-4 h-4" />
          </button>
        </div>
        <!-- Navigation to an address, so it renders as a link (#284), not as
             a button pretending to act here. -->
        <Button
          v-if="groupsVisible"
          variant="link"
          :icon-left="FolderTree"
          :to="{ path: '/settings', query: { section: 'projects' } }"
        >
          {{ $t('projects.groups.manage') }}
        </Button>
        <Button :icon-left="Plus" @click="router.push('/projects/new')">
          {{ $t('projects.newProjectBtn') }}
        </Button>
      </template>
    </PageHeader>

    <!-- Stats Summary Grid -->
    <div class="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="glass-card rounded-2xl p-4 flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center"
        >
          <FolderGit class="w-6 h-6" />
        </div>
        <div>
          <span
            class="text-xs text-slate-500 dark:text-slate-400 block font-medium"
            >{{ $t('projects.totalProjects') }}</span
          >
          <span class="text-xl font-bold text-slate-900 dark:text-white">{{
            projects.length
          }}</span>
        </div>
      </div>
      <div class="glass-card rounded-2xl p-4 flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center"
        >
          <CircleDot class="w-6 h-6" />
        </div>
        <div>
          <span
            class="text-xs text-slate-500 dark:text-slate-400 block font-medium"
            >{{ $t('projects.inProgress') }}</span
          >
          <span class="text-xl font-bold text-slate-900 dark:text-white">
            {{
              projects.filter(
                (p) => p.status === 'IN_PROGRESS' || p.status === 'PLANNING',
              ).length
            }}
          </span>
        </div>
      </div>
      <div class="glass-card rounded-2xl p-4 flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"
        >
          <CheckSquare class="w-6 h-6" />
        </div>
        <div>
          <span
            class="text-xs text-slate-500 dark:text-slate-400 block font-medium"
            >{{ $t('projects.completed') }}</span
          >
          <span class="text-xl font-bold text-slate-900 dark:text-white">
            {{ projects.filter((p) => p.status === 'COMPLETED').length }}
          </span>
        </div>
      </div>
    </div>

    <!-- Loading Indicator -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <Spinner />
    </div>

    <!-- Projects Board (kanban) -->
    <ProjectsBoard
      v-else-if="view === 'board'"
      class="flex-1 min-h-0"
      :projects="projects"
      :revision="boardRevision"
      @reorder="handleReorder"
      @open="(id) => router.push('/projects/' + id)"
    />

    <!-- Grid view: filters + empty states + cards -->
    <template v-else>
      <!-- Filter bar -->
      <!-- The group filter is resolved server-side, so an empty group empties
           `projects` entirely. The bar has to survive that or the filter it
           applied becomes unclearable. -->
      <div
        v-if="projects.length > 0 || hasActiveFilters"
        class="shrink-0 flex flex-col lg:flex-row gap-3"
      >
        <div class="relative flex-1">
          <Search
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none"
          />
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="$t('projects.filters.searchPlaceholder')"
            :aria-label="$t('projects.filters.searchPlaceholder')"
            class="w-full glass-input rounded-xl pl-9 pr-4 py-2.5 text-sm"
          />
        </div>
        <div class="grid grid-cols-1 gap-3" :class="filterGridClass">
          <Select
            v-if="groupFilterVisible"
            v-model="groupFilter"
            :options="groupFilterOptions"
            :aria-label="$t('projects.groups.field')"
          />
          <Select v-model="statusFilter" :options="statusFilterOptions" />
          <template v-if="listFiltersVisible">
            <PluginSlot
              name="projects.list.filters"
              :ctx="{
                pluginId: 'projects',
                entityType: 'project',
                selectedTagId: tagFilter || null,
                onSelect: (id) => (tagFilter = id ?? ''),
                onMatches: onTagMatches,
              }"
            />
            <Select v-model="sortBy" :options="sortOptions" />
          </template>
        </div>
      </div>

      <!-- Empty: no projects at all -->
      <EmptyState
        v-if="projects.length === 0 && !hasActiveFilters"
        :icon="FolderGit"
        :title="$t('projects.empty.title')"
        :description="$t('projects.empty.description')"
      >
        <template #action>
          <Button :icon-left="Plus" @click="router.push('/projects/new')">
            {{ $t('projects.newProjectBtn') }}
          </Button>
        </template>
      </EmptyState>

      <!-- Empty: filters matched nothing -->
      <EmptyState
        v-else-if="filteredProjects.length === 0"
        :icon="Search"
        :title="$t('projects.noResults.title')"
        :description="$t('projects.noResults.description')"
      >
        <template #action>
          <Button variant="secondary" :icon-left="X" @click="clearFilters">
            {{ $t('projects.noResults.clear') }}
          </Button>
        </template>
      </EmptyState>

      <!-- Timeline (#294): the same filtered set as the grid, laid out on a
           shared time axis instead of as cards. -->
      <div v-else-if="view === 'gantt'" class="flex-1 min-h-0 overflow-y-auto">
        <ProjectsGantt :projects="filteredProjects" />
      </div>

      <!-- Projects Grid -->
      <div
        v-else
        class="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min"
      >
        <div
          v-for="project in filteredProjects"
          :key="project.id"
          class="glass-card rounded-2xl p-5 flex flex-col justify-between hover:border-brand-500/35 hover:shadow-xl hover:shadow-brand-500/5 transition-all duration-300 group cursor-pointer"
          @click="router.push('/projects/' + project.id)"
        >
          <!-- Cover -->
          <div
            v-if="project.coverUrl"
            class="-mx-5 -mt-5 mb-4 h-32 overflow-hidden rounded-t-2xl"
          >
            <img
              :src="previewUrl(project.coverUrl, 'sm')"
              alt=""
              loading="lazy"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="space-y-4">
            <!-- Card Header (Status Badge + the group the project is in) -->
            <div class="flex justify-between items-center gap-2">
              <span
                class="px-2.5 py-1 text-xxs font-medium rounded-lg border"
                :class="cardStatusClass(project)"
              >
                {{ cardStatusLabel(project) }}
              </span>
              <span
                v-if="groupsVisible && groupNameOf(project)"
                class="flex items-center gap-1 min-w-0 text-xxs text-slate-500 dark:text-slate-400"
              >
                <FolderTree class="w-3 h-3 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ groupNameOf(project) }}</span>
              </span>
            </div>

            <!-- Title & Description -->
            <div class="space-y-1.5">
              <h3
                class="text-base font-semibold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors"
              >
                {{ project.title }}
              </h3>
              <div
                class="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed prose prose-sm dark:prose-invert"
                v-html="sanitizeHtml(project.description)"
              ></div>
            </div>

            <!-- Tags (contributed by the tags plugin when enabled) -->
            <PluginSlot
              name="projects.card.badges"
              :ctx="{ entityRef: projectRef(project), compact: true }"
            />
          </div>

          <!-- Metrics & Progress Footer -->
          <div
            class="mt-6 space-y-4 pt-4 border-t border-slate-200/50 dark:border-white/5"
          >
            <!-- Tasks Progress Bar -->
            <div class="space-y-1.5">
              <div
                class="flex justify-between text-xxs text-slate-500 dark:text-slate-400"
              >
                <span class="flex items-center gap-1 font-medium">
                  <CheckSquare
                    class="w-3.5 h-3.5 text-brand-500 dark:text-brand-400"
                  />
                  {{
                    $t('projects.tasksProgress', {
                      completed: project.completedTasksCount,
                      total: project.tasksCount,
                    })
                  }}
                </span>
                <span class="font-semibold"
                  >{{
                    Math.round(
                      (project.completedTasksCount / project.tasksCount) * 100,
                    ) || 0
                  }}%</span
                >
              </div>
              <div
                class="w-full h-1.5 bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden"
              >
                <div
                  class="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500"
                  :style="{
                    width: `${(project.completedTasksCount / project.tasksCount) * 100 || 0}%`,
                  }"
                ></div>
              </div>
            </div>

            <!-- Budget Progress Bar -->
            <div
              v-if="budgetVisible && project.budgetPlanned"
              class="space-y-1.5"
            >
              <div
                class="flex justify-between text-xxs text-slate-500 dark:text-slate-400"
              >
                <span class="flex items-center gap-1 font-medium">
                  <span class="font-bold text-slate-400 dark:text-slate-400"
                    >{{ $t('projectDetail.budgetTitle') }}:</span
                  >
                  {{ project.actualBudget }} / {{ project.budgetPlanned }}
                  {{ project.budgetCurrency }}
                </span>
                <span
                  class="font-semibold"
                  :class="[
                    project.actualBudget > project.budgetPlanned
                      ? 'text-rose-500'
                      : 'text-slate-500',
                  ]"
                >
                  {{
                    Math.round(
                      (project.actualBudget / project.budgetPlanned) * 100,
                    )
                  }}%
                </span>
              </div>
              <div
                class="w-full h-1.5 bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden"
              >
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="[
                    project.actualBudget > project.budgetPlanned
                      ? 'bg-rose-500'
                      : 'bg-brand-500',
                  ]"
                  :style="{
                    width: `${Math.min(100, (project.actualBudget / project.budgetPlanned) * 100)}%`,
                  }"
                ></div>
              </div>
            </div>

            <!-- Bottom Meta Metrics -->
            <div
              class="flex justify-between items-center text-xxs text-slate-500 dark:text-slate-400 font-medium"
            >
              <span class="flex items-center gap-1">
                <Cpu class="w-3.5 h-3.5 text-brand-500 dark:text-brand-400" />
                {{
                  $t('projects.componentsCount', {
                    count: project.componentsCount,
                  })
                }}
              </span>
              <span
                class="flex items-center gap-1"
                :class="
                  DUE_STATUS_CLASS[
                    dueStatus(project.dueDate, project.status === 'COMPLETED')
                  ]
                "
              >
                <Calendar class="w-3.5 h-3.5" />
                {{
                  project.dueDate
                    ? $t('projects.dueDate', {
                        date: formatDate(project.dueDate),
                      })
                    : $t('projects.noDueDate')
                }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
