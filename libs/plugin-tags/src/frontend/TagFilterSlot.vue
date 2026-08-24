<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Select, apiJson } from '@makekeeper/frontend-core';
import { parseObjectRef } from '@makekeeper/plugin-contract';
import type { TagDto } from '../tags-types';

// Contribution rendered into a host list view's filter bar (#60). The host stays
// route-driven: it owns the selected tag id and its own filtering, passing us
// `onSelect` (to update its route query) and `onMatches` (to receive the set of
// matching entity ids to AND into its predicate). We resolve the chosen tag's
// object refs to ids of the host's own entity type. Tags disabled ⇒ this slot is
// absent ⇒ the host never filters — clean degradation.
const props = defineProps<{
  pluginId: string;
  entityType: string;
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
  onMatches: (entityIds: string[] | null) => void;
}>();

const { t: $t } = useI18n();
const tags = ref<TagDto[]>([]);
const selected = ref<string>(props.selectedTagId ?? '');

watch(
  () => props.selectedTagId,
  (id) => {
    selected.value = id ?? '';
  },
);

const options = computed(() => [
  { value: '', label: $t('tags.filter.all') },
  ...tags.value.map((t) => ({ value: t.id, label: t.name })),
]);

function onChange(value: string): void {
  props.onSelect(value === '' ? null : value);
}

async function loadMatches(tagId: string | null): Promise<void> {
  if (!tagId) {
    props.onMatches(null);
    return;
  }
  try {
    const refs = await apiJson<string[]>(`/api/tags/${tagId}/refs`);
    const ids = new Set<string>();
    for (const raw of refs) {
      const parsed = parseObjectRef(raw);
      if (
        parsed?.pluginId === props.pluginId &&
        parsed.entityType === props.entityType
      ) {
        // A cell tag (fragment set) still filters by its owning storage's id.
        ids.add(parsed.entityId);
      }
    }
    props.onMatches([...ids]);
  } catch {
    props.onMatches(null);
  }
}

watch(
  () => props.selectedTagId,
  (id) => void loadMatches(id),
  { immediate: true },
);

// Clear the host's filter when this slot unmounts (tags disabled mid-view).
onUnmounted(() => props.onMatches(null));

onMounted(async () => {
  try {
    tags.value = await apiJson<TagDto[]>('/api/tags');
  } catch {
    tags.value = [];
  }
});
</script>

<template>
  <Select
    :model-value="selected"
    :options="options"
    :placeholder="$t('tags.filter.label')"
    @update:model-value="onChange"
  />
</template>
