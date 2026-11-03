import { computed, reactive, type WritableComputedRef } from 'vue';
import {
  useRoute,
  useRouter,
  type LocationQuery,
  type LocationQueryValue,
  type Router,
} from 'vue-router';

export interface RouteQueryOptions {
  // Value used when the key is absent; also the value that REMOVES the key on
  // write, so the URL stays clean (no `?tab=dashboard` for the default tab).
  default?: string;
  // Canonicalize legacy/aliased values on read, e.g. `{ chat: 'ai' }` maps an
  // old `?tab=chat` link onto the current `ai` tab.
  alias?: Record<string, string>;
}

function firstValue(
  raw: LocationQueryValue | LocationQueryValue[] | undefined,
): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value == null ? undefined : value;
}

// `null` = remove the key. Resolved at write time, because "the default" is a
// per-instance option and two instances over one key may disagree on it.
type PendingValue = string | null;

interface PendingQuery {
  // Reactive so a read can answer with a write that has not reached the URL
  // yet — see the read rule on `useRouteQuery`.
  values: Map<string, PendingValue>;
  // Which flush last carried each key. A navigation settling only clears the
  // keys it was the latest carrier of: a newer flush that superseded it (and
  // cancelled it) still owns the rest.
  carriedBy: Map<string, number>;
  // Replaces issued and not yet settled. Kept apart from `carriedBy`, which a
  // re-write empties per key while the navigation carrying it is still out.
  inFlight: number;
  scheduled: boolean;
  lastFlushId: number;
}

// One patch per router, shared by every instance on it: the bug this exists
// for (#331) is two DIFFERENT instances each building a query from the same
// not-yet-replaced `route.query`, so per-instance batching would not fix it.
const pendingByRouter = new WeakMap<Router, PendingQuery>();

function pendingFor(router: Router): PendingQuery {
  const existing = pendingByRouter.get(router);
  if (existing) return existing;
  const created: PendingQuery = {
    values: reactive(new Map<string, PendingValue>()),
    carriedBy: new Map(),
    inFlight: 0,
    scheduled: false,
    lastFlushId: 0,
  };
  pendingByRouter.set(router, created);
  return created;
}

function alreadyApplied(
  query: LocationQuery,
  key: string,
  value: PendingValue,
): boolean {
  return value === null ? !(key in query) : query[key] === value;
}

function flush(router: Router, pending: PendingQuery): void {
  pending.scheduled = false;
  const current = router.currentRoute.value;
  const entries = [...pending.values];
  if (
    pending.inFlight === 0 &&
    entries.every(([key, value]) => alreadyApplied(current.query, key, value))
  ) {
    // Nothing to navigate to — e.g. a value set and set back in one tick.
    // Skipping keeps the history and the router's guards untouched. Not while
    // an earlier flush is still landing: the URL it is about to produce, not
    // the current one, is what this batch has to be compared against.
    pending.values.clear();
    pending.carriedBy.clear();
    return;
  }

  const query = { ...current.query };
  for (const [key, value] of entries) {
    if (value === null) delete query[key];
    else query[key] = value;
  }

  const id = ++pending.lastFlushId;
  for (const [key] of entries) pending.carriedBy.set(key, id);
  pending.inFlight += 1;
  const settle = (): void => {
    pending.inFlight -= 1;
    for (const [key, carrier] of [...pending.carriedBy]) {
      if (carrier !== id) continue;
      pending.carriedBy.delete(key);
      pending.values.delete(key);
    }
  };
  // A duplicated, aborted or superseded navigation resolves with a
  // NavigationFailure rather than rejecting; a guard that throws rejects.
  // Settle on every outcome: a write that failed to land must stop shadowing
  // the real URL.
  void router.replace({ query }).then(settle, settle);
}

// A single writable computed over one `route.query` key — the route-driven
// navigation state CLAUDE.md §5.3 mandates, without each view re-deriving the
// `LocationQueryValue | LocationQueryValue[]` narrowing, the `...route.query`
// preservation, the omit-when-default, and the `.catch()` on redundant
// navigations. Assigning it does a `router.replace` that preserves every other
// query key.
//
// Writes are batched per router and flushed in a microtask: any number of
// assignments in one tick — on one instance or several — become ONE `replace`
// carrying all of them, so `date.value = d; view.value = 'day'` keeps both
// keys and adds no extra history entries (#331). That only holds while every
// writer goes through here: a hand-built `{ ...route.query, k }` replace reads
// the query before this tick's batch has landed and drops what it carries, or
// is dropped by it — so a view never mixes the two (#375).
//
// Reads are read-your-writes: between an assignment and the moment its
// navigation lands, every instance on that key returns the written value (or
// its own default, for a removal); otherwise it returns what the route says.
// A write still lands if its component unmounts before the flush — it was a
// deliberate action, and the patch belongs to the router, not the component.
//
// Known edge: the flush is a microtask, so a `router.push` elsewhere issued in
// the SAME tick as a `set()` starts first and is then superseded (vue-router
// lets the newest navigation win). Leave the page in a later tick, or don't
// write a query key on a page you are leaving.
export function useRouteQuery(
  key: string,
  options: RouteQueryOptions = {},
): WritableComputedRef<string> {
  const route = useRoute();
  const router = useRouter();
  const fallback = options.default ?? '';
  const pending = pendingFor(router);

  return computed<string>({
    get(): string {
      const raw = pending.values.has(key)
        ? (pending.values.get(key) ?? fallback)
        : // `?k=` reads as absent: writing '' removes the key, so an empty
          // value in the URL can only be a hand-typed or legacy link.
          firstValue(route.query[key]) || fallback;
      return options.alias?.[raw] ?? raw;
    },
    set(value: string): void {
      if (!pending.scheduled) {
        pending.scheduled = true;
        queueMicrotask(() => flush(router, pending));
      }
      // The key is unflushed again: an earlier navigation settling must not
      // clear this newer write.
      pending.carriedBy.delete(key);
      pending.values.set(
        key,
        value === fallback || value === '' ? null : value,
      );
    },
  });
}
