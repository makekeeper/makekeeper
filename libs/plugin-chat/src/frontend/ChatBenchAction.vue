<script setup lang="ts">
// Chat's verb in the dashboard action strip (#90): open the assistant, composer
// focused. Uses the requestChatPrompt seam (empty text just opens + focuses,
// without clobbering an in-progress draft).
import { useI18n } from 'vue-i18n';
import { Bot } from '@lucide/vue';
import { DashboardAction, requestChatPrompt } from '@makekeeper/frontend-core';

const { t } = useI18n();
</script>

<template>
  <DashboardAction
    :label="t('chat.bench.askAi')"
    :icon="Bot"
    @activate="requestChatPrompt('')"
  />
</template>
