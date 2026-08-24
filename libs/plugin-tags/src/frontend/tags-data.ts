import { defineStore } from 'pinia';
import { computed, reactive, watch, type ComputedRef, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import type { TagDto, TagsForRefsResult } from '../tags-types';

// Server-side cap on one /api/tags/for-refs batch (TagsForRefsDto
// @ArrayMaxSize) — a bigger render's worth of refs is split into compliant
// chunks, so a 400 on the whole batch can never blank every chip at once.
const FOR_REFS_BATCH_MAX = 200;

// Shared client-side cache of "tags attached to an object ref". Many chip slots
// render at once (one per list row); instead of one request each, they register
// their ref here and the store coalesces a tick's worth of refs into batched
// POST /api/tags/for-refs calls. Results live in a reactive map so every slot
// showing that ref updates together.
export const useTagChipsStore = defineStore('tags-chips', () => {
  const cache = reactive(new Map<string, TagDto[]>());
  let pending = new Set<string>();
  let flushScheduled = false;

  async function fetchChunk(refs: string[]): Promise<void> {
    try {
      const result = await apiJson<TagsForRefsResult>('/api/tags/for-refs', {
        method: 'POST',
        body: { refs },
      });
      for (const ref of refs) cache.set(ref, result[ref] ?? []);
    } catch {
      // On failure, settle unseen refs to empty so slots stop showing a spinner;
      // an explicit invalidate (after a mutation) will retry.
      for (const ref of refs) if (!cache.has(ref)) cache.set(ref, []);
    }
  }

  async function flush(): Promise<void> {
    flushScheduled = false;
    const refs = [...pending];
    pending = new Set();
    const chunks: string[][] = [];
    for (let i = 0; i < refs.length; i += FOR_REFS_BATCH_MAX) {
      chunks.push(refs.slice(i, i + FOR_REFS_BATCH_MAX));
    }
    await Promise.all(chunks.map((chunk) => fetchChunk(chunk)));
  }

  function schedule(ref: string): void {
    pending.add(ref);
    if (flushScheduled) return;
    flushScheduled = true;
    // A 0ms timer batches every slot that mounts in the same render tick.
    setTimeout(() => void flush(), 0);
  }

  // Refetch cached entries — call after anything may have changed a ref's tags.
  // The stale chips STAY on screen until the fresh answer replaces them:
  // deleting first blanked every visible card's chip row for a beat, and since
  // this fires on each agent turn, a chat session made the whole projects grid
  // blink once per action.
  function invalidateRefs(refs: string[]): void {
    for (const ref of refs) {
      if (ref) schedule(ref);
    }
  }

  // Refetch every cached ref — call after a tag's own fields change (rename,
  // recolour, delete), which affects its chips wherever shown, not one object.
  function invalidateAll(): void {
    invalidateRefs([...cache.keys()]);
  }

  function tagsFor(ref: string): TagDto[] {
    return cache.get(ref) ?? [];
  }

  function isLoaded(ref: string): boolean {
    return cache.has(ref);
  }

  // `cache` is returned so Pinia tracks it as store state (devtools, SSR).
  return { cache, schedule, invalidateRefs, invalidateAll, tagsFor, isLoaded };
});

// Reactively expose the tags attached to one object ref, fetching (batched) on
// mount and whenever the ref changes. `loaded` distinguishes "no tags yet
// fetched" from "fetched, and the object has none".
export function useTagsForRef(entityRef: Ref<string>): {
  tags: ComputedRef<TagDto[]>;
  loaded: ComputedRef<boolean>;
} {
  const store = useTagChipsStore();
  watch(
    entityRef,
    (ref) => {
      if (ref && !store.isLoaded(ref)) store.schedule(ref);
    },
    { immediate: true },
  );
  return {
    tags: computed(() => store.tagsFor(entityRef.value)),
    loaded: computed(() => store.isLoaded(entityRef.value)),
  };
}
