import { apiJson } from '@makekeeper/frontend-core';

// The slice of GET /api/projects the dashboard widgets consume.
export interface DashboardProjectSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  tasksCount: number;
  completedTasksCount: number;
  dueDate: string | null;
  // ISO timestamp of the last mutation — the dashboard's last-activity order.
  updatedAt: string;
}

// Both projects widgets mount together on the dashboard; deduplicate their
// concurrent fetches into one request. The slot clears when the request
// settles, so a later remount fetches fresh data.
let inflight: Promise<DashboardProjectSummary[]> | null = null;

export function fetchDashboardProjects(): Promise<DashboardProjectSummary[]> {
  if (!inflight) {
    inflight = apiJson<DashboardProjectSummary[]>('/api/projects').finally(
      () => {
        inflight = null;
      },
    );
  }
  return inflight;
}
