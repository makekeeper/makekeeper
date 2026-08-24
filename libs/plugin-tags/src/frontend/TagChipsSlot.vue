<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus } from '@lucide/vue';
import {
  apiJson,
  useAgentDataChanged,
  useToastStore,
} from '@makekeeper/frontend-core';
import TagChip from './TagChip.vue';
import TagPicker from './TagPicker.vue';
import { useTagChipsStore, useTagsForRef } from './tags-data';

// Contribution rendered into a host's tag slot (#60). Shows the tags attached to
// one object (by its canonical ORef, passed as `entityRef` in the slot ctx) and,
// when `editable`, an add control + per-chip remove. The host never imports this
// component — it renders <PluginSlot> and this appears only while tags is enabled.
const props = withDefaults(
  defineProps<{
    entityRef: string;
    editable?: boolean;
    compact?: boolean;
  }>(),
  { editable: false, compact: false },
);

const toast = useToastStore();
const { t: $t } = useI18n();
const tagChips = useTagChipsStore();
const entityRef = toRef(props, 'entityRef');
const { tags } = useTagsForRef(entityRef);
const assignedIds = computed(() => tags.value.map((t) => t.id));
const pickerOpen = ref(false);

// Refresh after an AI agent turn may have changed this object's tags.
watch(useAgentDataChanged(), () => tagChips.invalidateRefs([props.entityRef]));

async function assign(value: string): Promise<void> {
  pickerOpen.value = false;
  try {
    await apiJson('/api/tags/assign', {
      method: 'POST',
      body: { tag: value, ref: props.entityRef },
    });
    tagChips.invalidateRefs([props.entityRef]);
    toast.success($t('tags.toasts.assigned'));
  } catch {
    toast.error($t('tags.picker.assignError'));
  }
}

async function remove(tagId: string): Promise<void> {
  try {
    await apiJson('/api/tags/unassign', {
      method: 'POST',
      body: { tagId, ref: props.entityRef },
    });
    tagChips.invalidateRefs([props.entityRef]);
  } catch {
    toast.error($t('tags.picker.unassignError'));
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <TagChip
      v-for="tag in tags"
      :key="tag.id"
      :name="tag.name"
      :color="tag.color"
      :compact="compact"
      :removable="editable"
      @remove="remove(tag.id)"
    />
    <div v-if="editable" class="relative">
      <button
        v-if="!pickerOpen"
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 dark:border-white/15 px-2 py-0.5 text-xxs font-semibold text-slate-500 dark:text-slate-400 hover:border-brand-400 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 transition-colors"
        :aria-label="$t('tags.chip.add')"
        @click="pickerOpen = true"
      >
        <Plus class="w-3 h-3" />
        {{ $t('tags.chip.add') }}
      </button>
      <TagPicker
        v-else
        :assigned-ids="assignedIds"
        @pick="assign"
        @close="pickerOpen = false"
      />
    </div>
  </div>
</template>
