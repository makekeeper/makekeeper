import { onUnmounted, ref, watch, type Ref } from 'vue';
import { apiJson } from '@makekeeper/frontend-core';
import type { TagDto } from '../tags-types';

const DEBOUNCE_MS = 150;

export interface UseTagSuggestionsOptions {
  // Turn the raw input into the name query (e.g. strip the '#' search sigil).
  normalize?: (raw: string) => string;
  // Post-process the fetched list (e.g. hide already-assigned tags).
  transform?: (tags: TagDto[]) => TagDto[];
  // Runs after every completed fetch (e.g. open the dropdown).
  onFetched?: () => void;
}

// Shared autocomplete engine for the tag inputs (TagPicker, HeaderTagSearch):
// a debounced tag-name query against /api/tags plus the keyboard-highlight
// state. Consumers own their dropdown markup and what picking a row does.
// Must be called during component setup (registers an unmount cleanup).
export function useTagSuggestions(options: UseTagSuggestionsOptions = {}): {
  query: Ref<string>;
  suggestions: Ref<TagDto[]>;
  highlighted: Ref<number>;
  fetchSuggestions: () => Promise<void>;
  moveHighlight: (delta: number, count: number) => void;
  resetSuggestions: () => void;
} {
  const query = ref('');
  const suggestions = ref<TagDto[]>([]);
  const highlighted = ref(0);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  async function fetchSuggestions(): Promise<void> {
    const q = (options.normalize?.(query.value) ?? query.value).trim();
    try {
      const all = await apiJson<TagDto[]>(
        `/api/tags${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      );
      suggestions.value = options.transform ? options.transform(all) : all;
    } catch {
      suggestions.value = [];
    }
    highlighted.value = 0;
    options.onFetched?.();
  }

  watch(query, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void fetchSuggestions(), DEBOUNCE_MS);
  });

  // Wrap-around arrow-key navigation over `count` rows (the consumer's row
  // count may exceed suggestions.length, e.g. a trailing "create" option).
  function moveHighlight(delta: number, count: number): void {
    if (count === 0) return;
    highlighted.value = (highlighted.value + delta + count) % count;
  }

  function resetSuggestions(): void {
    query.value = '';
    suggestions.value = [];
    highlighted.value = 0;
  }

  onUnmounted(() => {
    if (debounce) clearTimeout(debounce);
  });

  return {
    query,
    suggestions,
    highlighted,
    fetchSuggestions,
    moveHighlight,
    resetSuggestions,
  };
}
