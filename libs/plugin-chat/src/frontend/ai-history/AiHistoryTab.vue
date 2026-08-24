<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentDataChanged } from '@makekeeper/frontend-core';
import { Bot } from '@lucide/vue';
import ChatHistoryPanel from './ChatHistoryPanel.vue';
import ActionJournal from './ActionJournal.vue';
import AiUsageCharts from './AiUsageCharts.vue';

defineProps<{ projectId: string }>();

const { t } = useI18n();

const history = ref<InstanceType<typeof ChatHistoryPanel> | null>(null);
const journal = ref<InstanceType<typeof ActionJournal> | null>(null);
const charts = ref<InstanceType<typeof AiUsageCharts> | null>(null);

// After any agent turn (which may have created a session or run tools in this
// project), refresh the history views without a page reload.
const agentDataChanged = useAgentDataChanged();
watch(agentDataChanged, () => {
  history.value?.reload();
  journal.value?.reload();
  charts.value?.reload();
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-2">
      <div
        class="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400"
      >
        <Bot class="w-5 h-5" />
      </div>
      <div>
        <h2
          class="text-base font-semibold text-slate-900 dark:text-white leading-tight"
        >
          {{ t('projectDetail.ai.title') }}
        </h2>
        <span class="text-xxs text-slate-500">{{
          t('projectDetail.ai.subtitle')
        }}</span>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Left: each chart in its own card -->
      <div class="space-y-6">
        <AiUsageCharts ref="charts" :project-id="projectId" />
      </div>

      <!-- Right: conversation history + search with pagination -->
      <ChatHistoryPanel ref="history" :project-id="projectId" />
    </div>

    <ActionJournal ref="journal" :project-id="projectId" />
  </div>
</template>
