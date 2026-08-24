import { defineStore } from 'pinia';
import { computed, reactive, watch, type ComputedRef, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';

// Server-side cap on one /api/tags/sources/status batch (TagSourceStatusDto
// @ArrayMaxSize).
const STATUS_BATCH_MAX = 200;

// "Is this field a tag source?", cached and batched by object ref — the same
// shape and the same reason as `useTagChipsStore`: a category screen renders one
// badge per property row, and one request each is one request too many.
export const useTagSourcesStore = defineStore('tags-sources', () => {
  const cache = reactive(new Map<string, boolean>());
  let pending = new Set<string>();
  let flushScheduled = false;

  async function fetchChunk(refs: string[]): Promise<void> {
    try {
      const result = await apiJson<Record<string, boolean>>(
        '/api/tags/sources/status',
        { method: 'POST', body: { refs } },
      );
      for (const ref of refs) cache.set(ref, result[ref] === true);
    } catch {
      // Settle to "not a source" so nothing waits forever; an explicit
      // invalidate after a write retries.
      for (const ref of refs) if (!cache.has(ref)) cache.set(ref, false);
    }
  }

  async function flush(): Promise<void> {
    flushScheduled = false;
    const refs = [...pending];
    pending = new Set();
    const chunks: string[][] = [];
    for (let i = 0; i < refs.length; i += STATUS_BATCH_MAX) {
      chunks.push(refs.slice(i, i + STATUS_BATCH_MAX));
    }
    await Promise.all(chunks.map((chunk) => fetchChunk(chunk)));
  }

  function schedule(ref: string): void {
    pending.add(ref);
    if (flushScheduled) return;
    flushScheduled = true;
    // A 0ms timer batches every badge that mounts in the same render tick.
    setTimeout(() => void flush(), 0);
  }

  function invalidateRefs(refs: string[]): void {
    for (const ref of refs) {
      cache.delete(ref);
      if (ref) schedule(ref);
    }
  }

  function isSource(ref: string): boolean {
    return cache.get(ref) === true;
  }

  function isLoaded(ref: string): boolean {
    return cache.has(ref);
  }

  // Write the marking and keep the cache honest. Used by the editable
  // contribution once the host's field actually exists.
  async function setSource(ref: string, next: boolean): Promise<void> {
    await apiJson('/api/tags/sources', {
      method: 'POST',
      body: { ref, isSource: next },
    });
    cache.set(ref, next);
  }

  return {
    cache,
    schedule,
    invalidateRefs,
    isSource,
    isLoaded,
    setSource,
  };
});

// Reactively expose whether one field is a tag source. `loaded` separates "not
// asked yet" from "asked, and it is not one" — a badge must not flicker on.
export function useTagSourceFor(fieldRef: Ref<string | null>): {
  isSource: ComputedRef<boolean>;
  loaded: ComputedRef<boolean>;
} {
  const store = useTagSourcesStore();
  watch(
    fieldRef,
    (ref) => {
      if (ref && !store.isLoaded(ref)) store.schedule(ref);
    },
    { immediate: true },
  );
  return {
    isSource: computed(() =>
      fieldRef.value ? store.isSource(fieldRef.value) : false,
    ),
    loaded: computed(() =>
      fieldRef.value ? store.isLoaded(fieldRef.value) : true,
    ),
  };
}
