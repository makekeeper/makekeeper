import { computed, ref, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiJson,
  buildTreeOptions,
  usePluginsStore,
} from '@makekeeper/frontend-core';
import { formatByteSize } from '@makekeeper/plugin-contract';

// The 5 kanban statuses, in pipeline order. Single source for both the board
// columns and the form/status maps.
export const PROJECT_STATUSES = [
  'IDEA',
  'PLANNING',
  'IN_PROGRESS',
  'TESTING',
  'COMPLETED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Simple-mode view of the pipeline: the 5 statuses collapse into 3 coarse
// buckets. This is a display lens only — the stored status never changes when
// the mode does; only a drag into a bucket column writes the bucket's
// canonical status.
export type ProjectStatusBucket = 'PLANNED' | 'DOING' | 'DONE';

// Bucket board order (mirrors PROJECT_STATUSES' pipeline order).
export const PROJECT_STATUS_BUCKETS: ProjectStatusBucket[] = [
  'PLANNED',
  'DOING',
  'DONE',
];

const STATUS_TO_BUCKET: Record<ProjectStatus, ProjectStatusBucket> = {
  IDEA: 'PLANNED',
  PLANNING: 'PLANNED',
  IN_PROGRESS: 'DOING',
  TESTING: 'DOING',
  COMPLETED: 'DONE',
};

export function statusBucket(status: ProjectStatus): ProjectStatusBucket {
  return STATUS_TO_BUCKET[status];
}

// The status written when a card is dropped into a bucket column. Each
// canonical status round-trips: statusBucket(BUCKET_CANONICAL_STATUS[b]) === b.
export const BUCKET_CANONICAL_STATUS: Record<
  ProjectStatusBucket,
  ProjectStatus
> = {
  PLANNED: 'IDEA',
  DOING: 'IN_PROGRESS',
  DONE: 'COMPLETED',
};

// i18n label key per bucket — shared by the board columns, the status filter
// and the card badges so all simple-mode surfaces agree.
export const BUCKET_LABEL_KEY: Record<ProjectStatusBucket, string> = {
  PLANNED: 'projects.statusBucket.planned',
  DOING: 'projects.statusBucket.doing',
  DONE: 'projects.statusBucket.done',
};

// ── Status presentation, in ONE place ─────────────────────────────────────
//
// These three maps used to be copy-pasted into the grid, the detail view and
// the board, which is exactly how a colour language drifts. The timeline (#294)
// would have been the fourth copy, so they moved here instead.

export const PROJECT_STATUS_LABEL_KEY: Record<ProjectStatus, string> = {
  IDEA: 'projects.status.idea',
  PLANNING: 'projects.status.planning',
  IN_PROGRESS: 'projects.status.inProgress',
  TESTING: 'projects.status.testing',
  COMPLETED: 'projects.status.completed',
};

// The badge treatment: a tinted chip that carries its own text.
export const PROJECT_STATUS_CHIP: Record<ProjectStatus, string> = {
  IDEA: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20',
  PLANNING:
    'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  IN_PROGRESS:
    'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20',
  TESTING:
    'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  COMPLETED:
    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
};

// The solid treatment: a filled accent (column rail, timeline bar).
//
// NOTE for anyone extending this: `IN_PROGRESS` and `TESTING` are
// indistinguishable under deuteranopia (ΔE 0.9). Wherever these fills stand
// next to each other, the status must ALSO be carried by something that is not
// colour — the board has its column headings, the timeline writes the status
// beside the project name. A surface that leans on the fill alone is a bug.
export const PROJECT_STATUS_SOLID: Record<ProjectStatus, string> = {
  IDEA: 'bg-indigo-500',
  PLANNING: 'bg-amber-500',
  IN_PROGRESS: 'bg-brand-500',
  TESTING: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
};

export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUSES.some((status) => status === value);
}

export function isProjectStatusBucket(
  value: string,
): value is ProjectStatusBucket {
  return PROJECT_STATUS_BUCKETS.some((bucket) => bucket === value);
}

// Shape returned by GET /api/projects — shared by the grid list and the board.
export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
  // Last write to the row — the timeline's last-resort right edge for a project
  // that closed before `completedAt` existed (#294).
  updatedAt: string;
  startDate: string | null;
  dueDate: string | null;
  // When the project reached the closed status. Read-only: the backend stamps it
  // from the status transition, and no client may set it (#294).
  completedAt: string | null;
  position: number;
  // The group the project is filed in (#289).
  groupId: string;
  coverUrl: string | null;
  tasksCount: number;
  completedTasksCount: number;
  componentsCount: number;
  budgetPlanned?: number;
  budgetCurrency?: string;
  actualBudget: number;
}

// Single source of truth for the currency picker across the project form and the
// link-component form (previously two divergent inline lists). Codes + symbols are
// technical identifiers, not translatable prose.
export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'RUB', label: 'RUB (₽)' },
  { value: 'CNY', label: 'CNY (¥)' },
  { value: 'GBP', label: 'GBP (£)' },
];

// Formats a backend ISO date string by the viewer's active locale. Returns null
// for missing/invalid input so callers can render their own "not set" fallback,
// instead of the app baking in a hard-coded `ru-RU` format or a fake date.
export function useLocaleDate(): (
  iso: string | null | undefined,
) => string | null {
  const { locale } = useI18n();
  return (iso) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(locale.value).format(date);
  };
}

export type DueStatus = 'overdue' | 'soon' | 'none';

// Deadline urgency relative to today (date-only): past → overdue, within the
// next 3 days → soon, otherwise none. Completed work is never flagged, so the
// caller passes `isDone` for finished projects/tasks.
export function dueStatus(
  iso: string | null | undefined,
  isDone = false,
): DueStatus {
  if (isDone || !iso) return 'none';
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return 'none';
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const dueDay = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  ).getTime();
  const days = Math.round((dueDay - startOfToday) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'soon';
  return 'none';
}

// Tailwind text colour per urgency — shared so list, detail and task rows agree.
export const DUE_STATUS_CLASS: Record<DueStatus, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-600 dark:text-amber-400',
  none: '',
};

// Human-readable file size (e.g. "1.4 MB"). Delegates to the contract's
// formatter (#112): the chat gate quotes sizes in its rejection messages, and a
// second implementation would eventually round differently from this one.
export const formatFileSize = formatByteSize;

// Centered-square source rect over an image's natural size — mirrors what
// `object-cover` shows in a square thumbnail. Used to draw the small drag
// ghost for Files-tab images (#111).
export interface CoverCropRect {
  sx: number;
  sy: number;
  size: number;
}
export function coverCropSquare(
  naturalWidth: number,
  naturalHeight: number,
): CoverCropRect {
  const size = Math.max(1, Math.min(naturalWidth, naturalHeight));
  return {
    sx: Math.max(0, (naturalWidth - size) / 2),
    sy: Math.max(0, (naturalHeight - size) / 2),
    size,
  };
}

// The inventory category vocabulary (#205), for the two inline "create a
// component" forms this plugin owns. The category is a relation now, so a
// free-text box here posted a field the API strips — the user typed a category
// and it silently vanished.
//
// Read over inventory's HTTP API, never by importing its code (§5.10), and only
// while that plugin is enabled: with it off there are no components to create.
export interface CategoryOption {
  value: string;
  label: string;
  depth?: number;
  parentValue?: string | null;
}

// Only the fields the picker needs. Typed here rather than importing inventory's
// `ItemCategoryDto` — that would be a cross-plugin code import (§5.10); reading
// its HTTP API is the sanctioned seam.
interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

export function useCategoryOptions(): {
  categoryOptions: ComputedRef<CategoryOption[]>;
  loadCategories: () => Promise<void>;
} {
  const { t } = useI18n();
  const plugins = usePluginsStore();
  const categories = ref<CategoryRow[]>([]);

  const loadCategories = async (): Promise<void> => {
    if (!plugins.isEnabled('inventory')) {
      categories.value = [];
      return;
    }
    try {
      categories.value = await apiJson<CategoryRow[]>('/api/item-categories');
    } catch {
      // No vocabulary just means no picker entries — the form still saves.
      categories.value = [];
    }
  };

  // Same tree, same indentation and same built-in filter as inventory's own
  // pickers: this form creates a component, so it had better name a category
  // the way the screen that edits one does.
  const categoryOptions = computed<CategoryOption[]>(() => [
    { value: '', label: t('linkComponent.noCategory'), empty: true },
    ...buildTreeOptions(
      categories.value.map((category) => ({
        value: category.id,
        label: category.name,
        parentValue: category.parentId,
        order: category.order,
      })),
    ),
  ]);

  return { categoryOptions, loadCategories };
}
