<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { FolderGit } from '@lucide/vue';
import { DashboardStatCard } from '@makekeeper/frontend-core';
import { fetchDashboardProjects } from './projects-dashboard-data';

// Dashboard stat: how many projects are not completed yet. Published via the
// manifest's `dashboardWidgets` declaration.
const { t } = useI18n();
const loading = ref(true);
const count = ref<number | null>(null);

// A failed fetch renders an em dash instead of a misleading zero.
const value = computed<string | number>(() => count.value ?? '—');

onMounted(async () => {
  try {
    const projects = await fetchDashboardProjects();
    count.value = projects.filter((p) => p.status !== 'COMPLETED').length;
  } catch {
    count.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DashboardStatCard
    :label="t('projects.dashboard.activeProjects')"
    :value="value"
    :icon="FolderGit"
    to="/projects"
    :loading="loading"
  />
</template>
