// The "bench" dashboard contract (#90) — the readiness/task-queue shape the
// projects backend computes and the projects dashboard widget renders. Kept
// framework-agnostic (no Nest, no Vue) so both sides of the plugin share ONE
// definition, exactly like `manifest.ts`.
//
// The bench answers "can I sit down and build today": for every active project
// it joins the project's bill of materials against free stock (owned here) and
// incoming orders (resolved from logistics via the capability registry).

// Projects that belong on the bench: past the idea stage, not yet done.
export const BENCH_ACTIVE_STATUSES = [
  'PLANNING',
  'IN_PROGRESS',
  'TESTING',
] as const;

// The pipeline's terminal status. Entering it is the public
// `projects.project.closed` fact (#189/#192) — the backend needs the literal
// without importing the frontend's kanban vocabulary.
export const PROJECT_CLOSED_STATUS = 'COMPLETED';

// Orders still in flight — an expected delivery, not a draft cart or a closed
// order. Mirrors the logistics plugin's own incoming set.
export const BENCH_INCOMING_ORDER_STATUSES = ['ORDERED', 'SHIPPED'] as const;

// `Order.status` is a raw string column; this narrows it to an in-flight status
// so the readiness join can test membership without a cast (`.some` compares
// each literal against the string, no widening `as` needed).
export function isIncomingOrderStatus(
  status: string,
): status is (typeof BENCH_INCOMING_ORDER_STATUSES)[number] {
  return BENCH_INCOMING_ORDER_STATUSES.some((s) => s === status);
}

// One bill-of-materials line's supply state, worst-last:
// reserved (already earmarked) → inStock (free stock covers it) →
// onOrder (a delivery covers the shortfall) → missing (nobody ordered it).
export type BenchLineState = 'reserved' | 'inStock' | 'onOrder' | 'missing';

export interface BenchReadinessLine {
  componentId: string;
  name: string;
  needed: number;
  reserved: number;
  free: number;
  deficit: number;
  state: BenchLineState;
}

// A task's startability, from the maker's hands' point of view.
export type BenchTaskState = 'ready' | 'waitingOrder' | 'noParts';

export interface BenchTaskWait {
  storeName: string;
  estimatedDelivery: string | null;
}

export interface BenchTask {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  state: BenchTaskState;
  // Set only for `waitingOrder`.
  waitingFor: BenchTaskWait | null;
  // Component names short for `noParts`.
  shortOf: string[];
}

export interface BenchWaitingOrder {
  id: string;
  storeName: string;
  estimatedDelivery: string | null;
}

export interface BenchProject {
  id: string;
  title: string;
  status: string;
  // ISO or null — the frontend formats by the viewer's locale.
  dueDate: string | null;
  lines: BenchReadinessLine[];
  // Counts by line state — the four segments of the readiness bar.
  reserved: number;
  inStock: number;
  onOrder: number;
  missing: number;
  total: number;
  // 0-100: share of the bill of materials already secured (reserved + inStock).
  percent: number;
  buildable: boolean;
  // Earliest delivery among the orders this project's open tasks wait on.
  unblockAt: string | null;
  waitingOn: BenchWaitingOrder[];
  openTasks: number;
  tasks: BenchTask[];
}

// The one-line aggregate ribbon under the bench. `buildable`/`notOrdered` are
// derived from the projects here; `incoming`/`unplaced` come from the logistics
// and inventory capabilities and are null while that plugin is disabled (so the
// ribbon can hide the cell rather than show a wrong zero).
export interface BenchSummary {
  buildable: number;
  notOrdered: number;
  incoming: number | null;
  unplaced: number | null;
}

export interface BenchResponse {
  // Active projects, sorted by readiness percent descending (closest to
  // buildable first) — the frontend's default focus is `projects[0]`.
  projects: BenchProject[];
  summary: BenchSummary;
}
