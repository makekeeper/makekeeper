<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Box } from '@lucide/vue';
import { apiJson, DashboardStatCard } from '@makekeeper/frontend-core';

// Dashboard stat: how many storage locations exist. Published via the
// manifest's `dashboardWidgets` declaration.
const { t } = useI18n();
const loading = ref(true);
const count = ref<number | null>(null);

// A failed fetch renders an em dash instead of a misleading zero.
const value = computed<string | number>(() => count.value ?? '—');

onMounted(async () => {
  try {
    count.value = (await apiJson<unknown[]>('/api/storages')).length;
  } catch {
    count.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DashboardStatCard
    :label="t('storages.dashboard.total')"
    :value="value"
    :icon="Box"
    to="/storages"
    tone="emerald"
    :loading="loading"
  />
</template>
