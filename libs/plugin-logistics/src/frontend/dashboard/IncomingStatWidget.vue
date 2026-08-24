<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Truck } from '@lucide/vue';
import { DashboardStatCard } from '@makekeeper/frontend-core';
import { fetchIncomingOrders } from './logistics-dashboard-data';

// Dashboard stat: orders on their way (placed or shipped, not yet delivered;
// CART drafts don't count as expected deliveries).
const { t } = useI18n();
const loading = ref(true);
const count = ref<number | null>(null);

// A failed fetch renders an em dash instead of a misleading zero.
const value = computed<string | number>(() => count.value ?? '—');

onMounted(async () => {
  try {
    count.value = (await fetchIncomingOrders()).length;
  } catch {
    count.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DashboardStatCard
    :label="t('logistics.dashboard.incoming')"
    :value="value"
    :icon="Truck"
    to="/logistics"
    :loading="loading"
  />
</template>
