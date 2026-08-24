<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  previewUrl,
  sanitizeHtml,
  useUxMode,
  PluginSlot,
} from '@makekeeper/frontend-core';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import { CheckSquare, Calendar, GripVertical } from '@lucide/vue';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_BUCKETS,
  BUCKET_CANONICAL_STATUS,
  BUCKET_LABEL_KEY,
  PROJECT_STATUS_LABEL_KEY,
  PROJECT_STATUS_SOLID,
  statusBucket,
  type ProjectStatus,
  type ProjectStatusBucket,
  type ProjectSummary,
  useLocaleDate,
  dueStatus,
  DUE_STATUS_CLASS,
} from './shared';

const props = withDefaults(
  defineProps<{ projects: ProjectSummary[]; revision?: number }>(),
  { revision: 0 },
);
const emit = defineEmits<{
  (
    e: 'reorder',
    payload: { status: ProjectStatus; orderedIds: string[]; movedId: string },
  ): void;
  (e: 'open', id: string): void;
}>();

const { t } = useI18n();
const formatDate = useLocaleDate();
const { isFeatureVisible } = useUxMode();

// Canonical ORef of a project, passed to the tag chip slot on each card.
const projectRef = (p: ProjectSummary): string =>
  formatObjectRef({
    pluginId: 'projects',
    entityType: 'project',
    entityId: p.id,
  }) ?? '';

// In simple mode (unless the user re-enabled full statuses) the 5 pipeline
// columns collapse into the 3 coarse buckets. This is a display lens: statuses
// are only written on an actual drop, using the bucket's canonical status.
const fullStatuses = computed<boolean>(() =>
  isFeatureVisible('projects.fullStatuses'),
);

// A column is keyed by either a status (full mode) or a bucket (simple mode).
type ColumnKey = ProjectStatus | ProjectStatusBucket;

const columnKeys = computed<ColumnKey[]>(() =>
  fullStatuses.value ? [...PROJECT_STATUSES] : [...PROJECT_STATUS_BUCKETS],
);

// The status persisted when a card is dropped into the column.
const COLUMN_STATUS: Record<ColumnKey, ProjectStatus> = {
  IDEA: 'IDEA',
  PLANNING: 'PLANNING',
  IN_PROGRESS: 'IN_PROGRESS',
  TESTING: 'TESTING',
  COMPLETED: 'COMPLETED',
  ...BUCKET_CANONICAL_STATUS,
};

const columnLabels: Record<ColumnKey, string> = {
  ...PROJECT_STATUS_LABEL_KEY,
  ...BUCKET_LABEL_KEY,
};

// Bucket accents reuse the accent of the bucket's canonical status so the
// colour language stays identical across both modes.
const columnAccent: Record<ColumnKey, string> = {
  ...PROJECT_STATUS_SOLID,
  PLANNED: PROJECT_STATUS_SOLID.IDEA,
  DOING: PROJECT_STATUS_SOLID.IN_PROGRESS,
  DONE: PROJECT_STATUS_SOLID.COMPLETED,
};

// Local, mutable copy so a drag reorders instantly; re-synced whenever the
// parent refetches after persisting.
const columns = ref<Record<ColumnKey, ProjectSummary[]>>(emptyColumns());
const draggedId = ref<string | null>(null);
const dragOverColumn = ref<ColumnKey | null>(null);

function emptyColumns(): Record<ColumnKey, ProjectSummary[]> {
  return {
    IDEA: [],
    PLANNING: [],
    IN_PROGRESS: [],
    TESTING: [],
    COMPLETED: [],
    PLANNED: [],
    DOING: [],
    DONE: [],
  };
}

const columnOf = (project: ProjectSummary): ColumnKey =>
  fullStatuses.value ? project.status : statusBucket(project.status);

const rebuildColumns = (): void => {
  const next = emptyColumns();
  for (const project of props.projects) {
    next[columnOf(project)].push(project);
  }
  for (const key of columnKeys.value) {
    next[key].sort((a, b) => a.position - b.position);
  }
  columns.value = next;
};

// Rebuild when the projects ARRAY is replaced (initial load, any refetch —
// including the quiet agent-data one, whose fresh rows the columns must adopt
// or keep showing stale objects), when the parent bumps `revision` (error
// revert), or when the column layout flips between full statuses and buckets.
// A successful drop mutates the EXISTING array in place — same identity, no
// rebuild — so the board still doesn't flicker mid-drag.
watch(
  () => [props.projects, props.revision, fullStatuses.value] as const,
  () => rebuildColumns(),
  { immediate: true },
);

const progressPct = (p: ProjectSummary): number =>
  p.tasksCount === 0
    ? 0
    : Math.round((p.completedTasksCount / p.tasksCount) * 100);

const onDragStart = (event: DragEvent, id: string): void => {
  draggedId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }
};

const onDragEnd = (): void => {
  draggedId.value = null;
  dragOverColumn.value = null;
};

// Drop the dragged card into the `targetKey` column, before `beforeId` (or at
// the end), then tell the parent the column's full new order to persist. In
// bucket mode the column persists under the bucket's canonical status.
const drop = (targetKey: ColumnKey, beforeId?: string): void => {
  const id = draggedId.value;
  dragOverColumn.value = null;
  if (!id) return;

  let moved: ProjectSummary | undefined;
  for (const key of columnKeys.value) {
    const index = columns.value[key].findIndex((p) => p.id === id);
    if (index !== -1) {
      moved = columns.value[key].splice(index, 1)[0];
      break;
    }
  }
  if (!moved) return;

  // Only the dragged card ever changes status (movedId contract, #53): in
  // bucket mode a pure reorder inside the same bucket keeps the card's own
  // status (e.g. TESTING stays TESTING inside "Doing"); a cross-bucket move
  // writes the bucket's canonical status. Untouched cards never change.
  const changesBucket =
    !fullStatuses.value && statusBucket(moved.status) !== targetKey;
  const newStatus =
    fullStatuses.value || changesBucket
      ? COLUMN_STATUS[targetKey]
      : moved.status;
  moved.status = newStatus;
  const target = columns.value[targetKey];
  const insertAt = beforeId
    ? target.findIndex((p) => p.id === beforeId)
    : target.length;
  target.splice(insertAt === -1 ? target.length : insertAt, 0, moved);

  draggedId.value = null;
  emit('reorder', {
    status: newStatus,
    orderedIds: target.map((p) => p.id),
    movedId: id,
  });
};
</script>

<template>
  <div class="flex gap-4 overflow-x-auto pb-3">
    <div
      v-for="columnKey in columnKeys"
      :key="columnKey"
      class="shrink-0 w-72 flex flex-col rounded-2xl bg-slate-100/50 dark:bg-white/[0.02] border transition-colors"
      :class="
        dragOverColumn === columnKey
          ? 'border-brand-500/50'
          : 'border-slate-200/60 dark:border-white/5'
      "
      @dragover.prevent="dragOverColumn = columnKey"
      @dragleave="dragOverColumn = null"
      @drop="drop(columnKey)"
    >
      <!-- Column header -->
      <div
        class="flex items-center justify-between px-3 py-2.5 border-b border-slate-200/60 dark:border-white/5"
      >
        <span
          class="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="columnAccent[columnKey]"
          ></span>
          {{ t(columnLabels[columnKey]) }}
        </span>
        <span
          class="text-xxs font-semibold text-slate-400 dark:text-slate-500 tabular-nums"
        >
          {{ columns[columnKey].length }}
        </span>
      </div>

      <!-- Cards -->
      <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        <div
          v-for="project in columns[columnKey]"
          :key="project.id"
          draggable="true"
          class="group rounded-xl glass-card border border-slate-200/60 dark:border-white/5 p-3 cursor-grab active:cursor-grabbing hover:border-brand-500/35 transition-all"
          :class="draggedId === project.id ? 'opacity-40' : ''"
          @dragstart="onDragStart($event, project.id)"
          @dragend="onDragEnd"
          @dragover.prevent.stop="dragOverColumn = columnKey"
          @drop.stop="drop(columnKey, project.id)"
          @click="emit('open', project.id)"
        >
          <div
            v-if="project.coverUrl"
            class="-mx-3 -mt-3 mb-2 h-24 overflow-hidden rounded-t-xl"
          >
            <img
              :src="previewUrl(project.coverUrl, 'sm')"
              alt=""
              loading="lazy"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="flex items-start gap-2">
            <GripVertical
              class="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5"
            />
            <div class="min-w-0 flex-1 space-y-2">
              <h4
                class="text-sm font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors"
              >
                {{ project.title }}
              </h4>
              <div
                v-if="project.description"
                class="text-xxs text-slate-500 dark:text-slate-400 line-clamp-2 prose prose-xs dark:prose-invert"
                v-html="sanitizeHtml(project.description)"
              ></div>

              <PluginSlot
                name="projects.card.badges"
                :ctx="{ entityRef: projectRef(project), compact: true }"
              />

              <!-- Task progress -->
              <div v-if="project.tasksCount > 0" class="space-y-1">
                <div
                  class="flex items-center justify-between text-xxs text-slate-500 dark:text-slate-400"
                >
                  <span class="flex items-center gap-1">
                    <CheckSquare
                      class="w-3 h-3 text-brand-500 dark:text-brand-400"
                    />
                    {{ project.completedTasksCount }}/{{ project.tasksCount }}
                  </span>
                  <span class="font-semibold">{{ progressPct(project) }}%</span>
                </div>
                <div
                  class="w-full h-1 bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden"
                >
                  <div
                    class="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full"
                    :style="{ width: `${progressPct(project)}%` }"
                  ></div>
                </div>
              </div>

              <div
                v-if="project.dueDate"
                class="flex items-center gap-1 text-xxs font-medium"
                :class="
                  DUE_STATUS_CLASS[
                    dueStatus(project.dueDate, project.status === 'COMPLETED')
                  ] || 'text-slate-500 dark:text-slate-400'
                "
              >
                <Calendar class="w-3 h-3" />
                {{ formatDate(project.dueDate) }}
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="columns[columnKey].length === 0"
          class="text-center text-xxs text-slate-400 dark:text-slate-600 py-6 select-none"
        >
          {{ t('projects.board.emptyColumn') }}
        </p>
      </div>
    </div>
  </div>
</template>
