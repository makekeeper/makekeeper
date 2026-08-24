<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search } from '@lucide/vue';
import TagChip from './TagChip.vue';
import { useTagSuggestions } from './use-tag-suggestions';
import type { TagDto } from '../tags-types';

// The global tag-search box contributed into the app header (#60). Typing filters
// the tag vocabulary (a leading '#' is the explicit "search by tag" form and is
// stripped); picking a tag navigates to its /tags page. Tag-search only — full
// entity search is a separate feature. When tags is disabled this slot is empty.
const router = useRouter();
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

// Strip a single leading '#' (and surrounding spaces) — the tag-search sigil.
const stripSigil = (raw: string): string => raw.trim().replace(/^#/, '');

const {
  query,
  suggestions: results,
  highlighted,
  moveHighlight,
  resetSuggestions,
} = useTagSuggestions({
  normalize: stripSigil,
  onFetched: () => {
    open.value = true;
  },
});

const normalized = () => stripSigil(query.value).trim();

function go(tag: TagDto): void {
  open.value = false;
  resetSuggestions();
  router.push({ path: '/tags', query: { tag: tag.id } });
}

function onEnter(): void {
  if (results.value[highlighted.value]) go(results.value[highlighted.value]);
}

function onArrow(delta: number): void {
  moveHighlight(delta, results.value.length);
}

function onClickOutside(e: MouseEvent): void {
  if (rootEl.value && !rootEl.value.contains(e.target as Node))
    open.value = false;
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>

<template>
  <!-- No self-hiding breakpoint: since #274 the header's overflow row owns
       when this control leaves the line — below that width it moves into the
       avatar menu as a full-width row instead of vanishing. -->
  <div ref="rootEl" class="relative">
    <div class="relative">
      <Search
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none"
      />
      <input
        v-model="query"
        type="text"
        class="glass-input rounded-xl pl-9 pr-3 py-2 text-sm w-56 focus:outline-none focus:ring-3 focus:ring-brand-500/10"
        :placeholder="$t('tags.header.searchPlaceholder')"
        :aria-label="$t('tags.header.searchPlaceholder')"
        @focus="open = true"
        @keydown.enter.prevent="onEnter"
        @keydown.down.prevent="onArrow(1)"
        @keydown.up.prevent="onArrow(-1)"
        @keydown.esc.prevent="open = false"
      />
    </div>
    <div
      v-if="open && (results.length > 0 || normalized())"
      class="absolute z-50 mt-1.5 w-64 max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-dark-900/95 backdrop-blur-md p-1 shadow-lg shadow-black/5 dark:shadow-black/20"
      role="listbox"
    >
      <button
        v-for="(tag, idx) in results"
        :key="tag.id"
        type="button"
        role="option"
        :aria-selected="highlighted === idx"
        class="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
        :class="
          highlighted === idx
            ? 'bg-slate-100 dark:bg-white/5'
            : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
        "
        @mouseenter="highlighted = idx"
        @click="go(tag)"
      >
        <TagChip :name="tag.name" :color="tag.color" compact />
        <span class="text-xxs text-slate-400 dark:text-slate-500">{{
          $t('tags.page.usageCount', { count: tag.usageCount })
        }}</span>
      </button>
      <div
        v-if="results.length === 0"
        class="px-2 py-2 text-xs text-slate-400 dark:text-slate-500 text-center"
      >
        {{ $t('tags.header.noResults') }}
      </div>
    </div>
  </div>
</template>
