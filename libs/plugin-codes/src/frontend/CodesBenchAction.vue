<script setup lang="ts">
// Codes' verb in the dashboard action strip (#90): start a global scan. The
// live session + bridge modal are owned by GlobalScanButton in the app header
// (always mounted); this verb only kicks it off through the shared session
// store, so no second session host is created.
import { useI18n } from 'vue-i18n';
import { ScanLine } from '@lucide/vue';
import { DashboardAction } from '@makekeeper/frontend-core';
import { useScanSessionStore } from './scan-session';

const { t } = useI18n();
const session = useScanSessionStore();
</script>

<template>
  <DashboardAction
    :label="t('codes.bench.scan')"
    :icon="ScanLine"
    @activate="session.start(null)"
  />
</template>
