<script setup lang="ts">
import { toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { Tag } from '@lucide/vue';
import { useTagSourceFor } from './tag-sources-data';

// Read-only counterpart of TagSourceField: shows, in a host's list of fields,
// which ones turn their value into a tag. Editing happens in the host's form,
// where Save/Cancel means something; a list row has neither, and a control that
// writes the instant you brush it is not what a list wants.
//
// Batched through the shared store, so a category with twenty properties still
// asks once.
const props = defineProps<{
  fieldRef: string | null;
  valueKind: string;
}>();

const { t: $t } = useI18n();
const { isSource } = useTagSourceFor(toRef(props, 'fieldRef'));
</script>

<template>
  <Tag
    v-if="isSource"
    class="w-3.5 h-3.5 shrink-0 text-brand-500 dark:text-brand-400"
    :aria-label="$t('tags.sources.label')"
  />
</template>
