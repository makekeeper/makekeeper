import { computed, type WritableComputedRef } from 'vue';
import { useRoute, useRouter, type LocationQueryValue } from 'vue-router';

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

// A single writable computed over one `route.query` key — the route-driven
// navigation state CLAUDE.md §5.3 mandates, without each view re-deriving the
// `LocationQueryValue | LocationQueryValue[]` narrowing, the `...route.query`
// preservation, the omit-when-default, and the `.catch()` on redundant
// navigations (only StoragesView remembered that one; the others throw
// NavigationDuplicated). Reading it is reactive; assigning it does a
// `router.replace` that preserves every other query key.
export function useRouteQuery(
  key: string,
  options: RouteQueryOptions = {},
): WritableComputedRef<string> {
  const route = useRoute();
  const router = useRouter();
  const fallback = options.default ?? '';

  return computed<string>({
    get(): string {
      const raw = firstValue(route.query[key]) ?? fallback;
      return options.alias?.[raw] ?? raw;
    },
    set(value: string): void {
      const query = { ...route.query };
      if (value === fallback || value === '') delete query[key];
      else query[key] = value;
      // Navigating to the URL you're already on rejects with
      // NavigationDuplicated — expected, so swallow it.
      void router.replace({ query }).catch(() => undefined);
    },
  });
}
