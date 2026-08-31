<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { AlarmClock } from '@lucide/vue';
import { Button } from '@makekeeper/frontend-core';

// The bell is where a person already thinks about what should reach them, and
// it offered nothing to do (#315). This rides the
// `notify.inbox.actions` slot rather than the inbox learning that reminders
// exist; with `schedule` disabled nobody contributes and the state stays empty.
//
// It navigates instead of opening the dialog in place: the bell's popover
// renders its content behind `v-if`, so a modal mounted inside it would be
// destroyed the moment the popover closed. Going to the calendar also makes
// the compose state linkable.
const { t } = useI18n();
const router = useRouter();

const compose = (): void => {
  void router.push({ name: 'calendar', query: { compose: 'new' } });
};
</script>

<template>
  <Button variant="primary" size="sm" @click="compose">
    <AlarmClock class="w-4 h-4" />
    {{ t('schedule.calendar.newReminder') }}
  </Button>
</template>
