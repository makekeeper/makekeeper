<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlarmClock } from '@lucide/vue';
import { Button } from '@makekeeper/frontend-core';
import ReminderModal from './ReminderModal.vue';

// "Remind me" wherever a page names the object it is showing (#309).
//
// It rides the shared `page.header.actions` slot rather than asking every host
// for a place of its own: the entity's ORef arrives in the ctx, so a task, an
// order and an item all get the same control in the same corner, and no host
// plugin learns that reminders exist.
defineProps<{ entityRef?: string }>();

const { t } = useI18n();
const open = ref(false);
</script>

<template>
  <template v-if="entityRef">
    <Button variant="ghost" size="sm" @click="open = true">
      <AlarmClock class="w-4 h-4" />
      {{ t('schedule.reminder.action') }}
    </Button>
    <ReminderModal v-model="open" :entity-ref="entityRef" />
  </template>
</template>
