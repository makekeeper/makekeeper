import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { apiErrorMessage } from './api';
import { useAgentDataChanged } from './data-events';
import { useSessionStore } from './session-store';
import { useToastStore } from './toast-store';

// The lifecycle every list/detail view re-implements around `apiFetch`/`apiJson`
// — loading → data → error — expressed once as the discriminated union CLAUDE.md
// §5.1 mandates, instead of the `loading` + `data` + implicit-error optional
// soup each view hand-maintains.
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

// Signals that should trigger an automatic refetch. `agent-data` = an AI agent
// turn may have mutated backend data; `scope` = the active multiuser scope
// changed, so the mounted view's data belongs to a different owner.
export type ResourceRefetchTrigger = 'agent-data' | 'scope';

export interface UseResourceOptions<T> {
  // Auto-refetch when any listed signal fires (opt-in per resource).
  refetchOn?: ResourceRefetchTrigger[];
  // Gate the initial fetch; flipping this to `true` fetches, `false` leaves the
  // last state untouched (hidden inputs keep their loaded values, §5.10).
  enabled?: Ref<boolean>;
  // Run on every successful load — e.g. to sync a derived ref the template edits.
  onData?: (data: T) => void;
  // Resolve the fallback error message. Called AT failure time so it is
  // locale-correct; omit to fall back to the ApiError's own localized message.
  errorFallback?: () => string;
  // Also surface failures through the toast host (many views want an inline
  // error AND a toast). Off by default.
  toastOnError?: boolean;
  // Keep the last loaded value visible while a refetch runs, so a reload can be
  // shown as "this is being updated" instead of tearing the screen down and
  // rebuilding it. The blink of an empty screen is what makes a refresh feel
  // like a navigation; `refreshing` below is what a view dims on.
  keepPreviousData?: boolean;
  // Shortest time a loading state may be visible, in ms. A refresh that answers
  // in 40 ms otherwise shows as a flicker — the spinner appears and vanishes
  // before the eye resolves it, and the blur transition never finishes, which
  // reads as a glitch rather than as work. Holding the state briefly makes the
  // update legible; it does NOT delay anything else, only the moment the new
  // value is painted.
  minLoadingMs?: number;
}

export interface Resource<T> {
  // The single source of truth; everything else is derived from it.
  state: Readonly<Ref<ResourceState<T>>>;
  // Convenience projections for templates and incremental migration.
  data: Readonly<Ref<T | undefined>>;
  loading: Readonly<Ref<boolean>>;
  // Loading ON TOP of data that is already on screen (only ever true with
  // `keepPreviousData`). The first load stays `loading`, because there is
  // nothing yet to keep.
  refreshing: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | undefined>>;
  // Force a reload; aborts any in-flight request first (a newer call wins).
  refetch: () => Promise<void>;
  // Write server-confirmed state straight into the resource — for mutations
  // whose response IS the fresh resource value (a PATCH that returns the
  // updated record). Applying it beats a refetch: no second round-trip, and no
  // window where the mutation "succeeded" but a failed re-read flips the
  // resource to `error`. Supersedes any in-flight fetch, exactly like a newer
  // refetch would.
  setData: (data: T) => void;
}

// Deep async-data module: absorbs the AbortController-per-refetch, the
// stale-response ordering, the `finally` discipline, error extraction, and the
// agent-data / scope refetch watches that ~55 views otherwise each re-do (and
// mostly get wrong — `signal` had zero callers, scope switches left stale data).
// Wait out the remainder of the minimum, if one is set and time is left.
function holdLoading(startedAt: number, minimumMs?: number): Promise<void> {
  const remaining = (minimumMs ?? 0) - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseResourceOptions<T> = {},
): Resource<T> {
  const state = shallowRef<ResourceState<T>>({ status: 'loading' });
  // The last successfully loaded value, kept out of `state` so the discriminated
  // union stays honest about what is happening right now.
  const previous = shallowRef<T | undefined>(undefined);

  let controller: AbortController | null = null;
  // Monotonic id: a response is applied only if it belongs to the newest call,
  // so out-of-order completions can never overwrite fresher data.
  let latestRun = 0;

  const refetch = async (): Promise<void> => {
    controller?.abort();
    const runController = new AbortController();
    controller = runController;
    const runId = ++latestRun;
    const startedAt = Date.now();
    state.value = { status: 'loading' };
    try {
      const data = await fetcher(runController.signal);
      if (runId !== latestRun) return; // superseded by a newer call
      await holdLoading(startedAt, options.minLoadingMs);
      // The wait is a place a newer call can overtake this one, so re-check.
      if (runId !== latestRun) return;
      options.onData?.(data);
      previous.value = data;
      state.value = { status: 'ready', data };
    } catch (err) {
      // Swallow the abort/supersede path — that is a cancellation, not a failure.
      if (runController.signal.aborted || runId !== latestRun) return;
      // A failure is held for the same minimum: an error that flashes past is
      // as unreadable as a spinner that does.
      await holdLoading(startedAt, options.minLoadingMs);
      if (runController.signal.aborted || runId !== latestRun) return;
      const message = apiErrorMessage(err, options.errorFallback?.() ?? '');
      // A failed refresh drops the stale value: showing yesterday's numbers
      // under an error is worse than showing the error alone.
      previous.value = undefined;
      state.value = { status: 'error', message };
      if (options.toastOnError && message) useToastStore().error(message);
    }
  };

  const setData = (data: T): void => {
    // Claim the "newest run" slot so an in-flight fetch that resolves later
    // cannot overwrite this fresher, server-confirmed value.
    controller?.abort();
    latestRun += 1;
    options.onData?.(data);
    previous.value = data;
    state.value = { status: 'ready', data };
  };

  for (const trigger of options.refetchOn ?? []) {
    if (trigger === 'agent-data') {
      watch(useAgentDataChanged(), () => void refetch());
    } else {
      const session = useSessionStore();
      watch(
        () => session.activeScopeId,
        () => void refetch(),
      );
    }
  }

  if (options.enabled) {
    watch(options.enabled, (isEnabled, was) => {
      if (isEnabled && !was) void refetch();
    });
  }

  // Abort a pending request when the owning component/effect scope tears down.
  onScopeDispose(() => controller?.abort());

  if (!options.enabled || options.enabled.value) void refetch();

  const data = computed<T | undefined>(() => {
    if (state.value.status === 'ready') return state.value.data;
    return options.keepPreviousData && state.value.status === 'loading'
      ? previous.value
      : undefined;
  });

  return {
    state,
    data,
    loading: computed(() => state.value.status === 'loading'),
    refreshing: computed(
      () => state.value.status === 'loading' && data.value !== undefined,
    ),
    error: computed(() =>
      state.value.status === 'error' ? state.value.message : undefined,
    ),
    refetch,
    setData,
  };
}
