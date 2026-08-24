<script setup lang="ts">
// Inventory's verbs in the dashboard action strip (#90): "add part" always, and
// "put away N" only while parts sit in stock without a storage cell. Contributed
// into the `dashboard.actions` slot; rendered only while inventory is enabled.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { MapPinOff, PackagePlus } from '@lucide/vue';
import { DashboardAction, apiJson } from '@makekeeper/frontend-core';

interface StockRow {
  quantity: number;
  storageId: string | null;
}

const { t } = useI18n();
const unplaced = ref(0);

onMounted(async () => {
  try {
    const rows = await apiJson<StockRow[]>('/api/components');
    unplaced.value = rows.filter((r) => r.quantity > 0 && !r.storageId).length;
  } catch {
    unplaced.value = 0;
  }
});

const putAwayLabel = computed(() =>
  t('inventory.bench.putAway', { n: unplaced.value }),
);
</script>

<template>
  <DashboardAction
    v-if="unplaced > 0"
    :label="putAwayLabel"
    :icon="MapPinOff"
    to="/inventory"
    urgent
  />
  <DashboardAction
    :label="t('inventory.bench.addPart')"
    :icon="PackagePlus"
    to="/inventory/new"
  />
</template>
