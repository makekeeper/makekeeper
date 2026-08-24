<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import TagChip from './TagChip.vue';
import { useTagSuggestions } from './use-tag-suggestions';
import { TAG_NAME_MAX, type TagDto } from '../tags-types';

// Autocomplete + create-on-type input for attaching a tag. Emits the chosen
// tag's id (existing) or the typed name (new — the backend creates it on
// assign). Built on raw inputs because the shared Select is single-select only.
const props = withDefaults(
  defineProps<{
    // Tag ids already on the object, hidden from suggestions.
    assignedIds?: string[];
  }>(),
  { assignedIds: () => [] },
);

const emit = defineEmits<{
  (e: 'pick', value: string): void;
  (e: 'close'): void;
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);
let attachTimer: ReturnType<typeof setTimeout> | null = null;

const {
  query,
  suggestions,
  highlighted,
  fetchSuggestions,
  moveHighlight,
  resetSuggestions,
} = useTagSuggestions({
  transform: (all) => all.filter((t) => !props.assignedIds.includes(t.id)),
});

const exactMatch = () =>
  suggestions.value.some(
    (t) => t.name.toLowerCase() === query.value.trim().toLowerCase(),
  );

// The "Create «query»" affordance appears only for a non-empty query with no
// exact existing match.
const canCreate = () => query.value.trim().length > 0 && !exactMatch();

function pickSuggestion(tag: TagDto): void {
  emit('pick', tag.id);
  resetSuggestions();
}

function createNew(): void {
  const name = query.value.trim();
  if (!name) return;
  emit('pick', name);
  resetSuggestions();
}

function onEnter(): void {
  const create = canCreate();
  const count = suggestions.value.length + (create ? 1 : 0);
  if (count === 0) return;
  if (create && highlighted.value === suggestions.value.length) {
    createNew();
  } else if (suggestions.value[highlighted.value]) {
    pickSuggestion(suggestions.value[highlighted.value]);
  }
}

function onArrow(delta: number): void {
  moveHighlight(delta, suggestions.value.length + (canCreate() ? 1 : 0));
}

function onClickOutside(e: MouseEvent): void {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) emit('close');
}

onMounted(() => {
  // Attach on the next macrotask: the click that opened this picker is still
  // mid-dispatch, and a microtask checkpoint mounts us before it reaches
  // `document`. Registering synchronously would make that same click count as an
  // outside click (its target — the now-removed "add" button — isn't inside us)
  // and close the picker instantly. Deferring lets the opening click finish first.
  attachTimer = setTimeout(
    () => document.addEventListener('click', onClickOutside),
    0,
  );
  void fetchSuggestions();
  inputEl.value?.focus();
});

onUnmounted(() => {
  if (attachTimer) clearTimeout(attachTimer);
  document.removeEventListener('click', onClickOutside);
});
</script>

<template>
  <div ref="rootEl" class="relative">
    <input
      ref="inputEl"
      v-model="query"
      type="text"
      :maxlength="TAG_NAME_MAX"
      class="glass-input rounded-xl px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-3 focus:ring-brand-500/10"
      :placeholder="$t('tags.picker.placeholder')"
      @keydown.enter.prevent="onEnter"
      @keydown.down.prevent="onArrow(1)"
      @keydown.up.prevent="onArrow(-1)"
      @keydown.esc.prevent="emit('close')"
    />
    <div
      class="absolute z-50 mt-1.5 w-56 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-dark-900/95 backdrop-blur-md p-1 shadow-lg shadow-black/5 dark:shadow-black/20"
      role="listbox"
    >
      <button
        v-for="(tag, idx) in suggestions"
        :key="tag.id"
        type="button"
        role="option"
        :aria-selected="highlighted === idx"
        class="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
        :class="
          highlighted === idx
            ? 'bg-slate-100 dark:bg-white/5'
            : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
        "
        @mouseenter="highlighted = idx"
        @click="pickSuggestion(tag)"
      >
        <TagChip :name="tag.name" :color="tag.color" compact />
      </button>
      <button
        v-if="canCreate()"
        type="button"
        role="option"
        :aria-selected="highlighted === suggestions.length"
        class="w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 dark:text-slate-300 transition-colors"
        :class="
          highlighted === suggestions.length
            ? 'bg-slate-100 dark:bg-white/5'
            : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
        "
        @mouseenter="highlighted = suggestions.length"
        @click="createNew"
      >
        {{ $t('tags.picker.createOption', { name: query.trim() }) }}
      </button>
      <div
        v-if="suggestions.length === 0 && !canCreate()"
        class="px-2 py-2 text-xs text-slate-400 dark:text-slate-500 text-center"
      >
        {{ $t('tags.picker.noResults') }}
      </div>
    </div>
  </div>
</template>
