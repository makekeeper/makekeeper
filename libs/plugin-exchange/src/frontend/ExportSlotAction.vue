<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Upload } from '@lucide/vue';
import { parseObjectRef } from '@makekeeper/plugin-contract';
import { Button } from '@makekeeper/frontend-core';
import type { ExchangeCatalogRoot } from '../exchange-types';
import ExportModal from './ExportModal.vue';
import { getCachedCatalog } from './exchange-data';

// In-context "Export" action contributed into the page.header.actions slot.
// PluginSlot spreads the host's ctx onto the contribution as individual props,
// so `entityRef` arrives directly from PageHeader's `context-ref`. Whether the
// ref is exportable comes from the backend catalog — the declared entity
// roots — not from a hardcoded plugin list; non-root/absent refs render nothing.

const props = defineProps<{
  entityRef?: string;
  editable?: boolean;
}>();

const { t } = useI18n();
const open = ref(false);
const roots = ref<ExchangeCatalogRoot[]>([]);

onMounted(async () => {
  try {
    roots.value = (await getCachedCatalog()).roots;
  } catch {
    // No catalog (backend unreachable / forbidden) — the action just hides.
    roots.value = [];
  }
});

const root = computed(() => {
  const parsed = parseObjectRef(props.entityRef);
  if (!parsed || parsed.fragment !== undefined) return null;
  const match = roots.value.find(
    (r) =>
      r.kind === 'entity' &&
      r.pluginId === parsed.pluginId &&
      r.entityType === parsed.entityType,
  );
  return match ? { rootType: match.entityType, rootId: props.entityRef } : null;
});
</script>

<template>
  <template v-if="root">
    <Button
      variant="secondary"
      size="sm"
      :icon-left="Upload"
      @click="open = true"
    >
      {{ t('exchange.action.export') }}
    </Button>
    <ExportModal
      v-model="open"
      :root-type="root.rootType"
      :root-id="root.rootId"
    />
  </template>
</template>
