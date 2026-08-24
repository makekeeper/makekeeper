<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Wrench } from '@lucide/vue';
import { apiJson, DashboardStatCard } from '@makekeeper/frontend-core';

// Dashboard stat: components whose free stock is at or below their min-stock
// threshold. Published via the manifest's `dashboardWidgets` declaration.
interface ComponentStockSummary {
  quantity: number;
  minQuantity: number;
}

const { t } = useI18n();
const loading = ref(true);
const count = ref<number | null>(null);

// A failed fetch renders an em dash instead of a misleading zero.
const value = computed<string | number>(() => count.value ?? '—');

onMounted(async () => {
  try {
    const components =
      await apiJson<ComponentStockSummary[]>('/api/components');
    count.value = components.filter((c) => c.quantity <= c.minQuantity).length;
  } catch {
    count.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DashboardStatCard
    :label="t('inventory.dashboard.lowStock')"
    :value="value"
    :icon="Wrench"
    to="/inventory"
    tone="amber"
    :loading="loading"
  />
</template>
