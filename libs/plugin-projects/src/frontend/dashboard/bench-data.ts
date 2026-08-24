import { ref, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import type {
  BenchProject,
  BenchResponse,
  BenchSummary,
  BenchTask,
} from '../../bench';

// Frontend face of GET /api/projects/bench (#90). The widget owns one load; the
// readiness/task-state computation already happened server-side, so this is a
// plain fetch — no client aggregation.
const EMPTY_SUMMARY: BenchSummary = {
  buildable: 0,
  notOrdered: 0,
  incoming: null,
  unplaced: null,
};

export interface BenchData {
  loading: Ref<boolean>;
  failed: Ref<boolean>;
  projects: Ref<BenchProject[]>;
  summary: Ref<BenchSummary>;
  reload: () => Promise<void>;
}

export function useBenchData(): BenchData {
  const loading = ref(true);
  const failed = ref(false);
  const projects = ref<BenchProject[]>([]);
  const summary = ref<BenchSummary>({ ...EMPTY_SUMMARY });

  const reload = async (): Promise<void> => {
    loading.value = true;
    failed.value = false;
    try {
      const res = await apiJson<BenchResponse>('/api/projects/bench');
      projects.value = res.projects;
      summary.value = res.summary;
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
  };

  void reload();
  return { loading, failed, projects, summary, reload };
}

// A task carried alongside the project it belongs to — the queue flattens the
// per-project task lists into one cross-project list.
export interface BenchQueueTask extends BenchTask {
  projectId: string;
  projectTitle: string;
}

export function flattenTasks(projects: BenchProject[]): BenchQueueTask[] {
  const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const tasks: BenchQueueTask[] = [];
  for (const project of projects) {
    for (const task of project.tasks) {
      tasks.push({
        ...task,
        projectId: project.id,
        projectTitle: project.title,
      });
    }
  }
  return tasks.sort((a, b) => {
    const rank =
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (rank !== 0) return rank;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.dueDate ? -1 : b.dueDate ? 1 : 0;
  });
}

export function formatBenchDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
