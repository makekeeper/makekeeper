import { onScopeDispose, watch, type Ref } from 'vue';
import { setPageContextRefs, setPageContextSummary } from './page-context';

type Source<T> = Ref<T> | (() => T);

function toGetter<T>(source: Source<T>): () => T {
  return typeof source === 'function' ? source : () => source.value;
}

// Publishes the active view's precise selection (canonical ORefs + an optional
// human-readable summary) for the chat agent while the view is mounted, and
// clears it on unmount so it never leaks to the next screen. Owns the
// publish-on-change + null-on-unmount pair that was copied verbatim into five
// views (ProjectDetailView, InventoryFormView, TaskFormView, StoragesView,
// TagsView) — making the leak-to-another-screen failure structurally
// impossible instead of a rule each view must remember.
export function usePageContext(
  refs: Source<string[] | null>,
  summary?: Source<string | null>,
): void {
  watch(toGetter(refs), (value) => setPageContextRefs(value), {
    immediate: true,
  });
  if (summary) {
    watch(toGetter(summary), (value) => setPageContextSummary(value), {
      immediate: true,
    });
  }
  onScopeDispose(() => {
    setPageContextRefs(null);
    setPageContextSummary(null);
  });
}
