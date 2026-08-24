<script setup lang="ts">
// "A scan session is filing into THIS object right now" (#79), mounted into the
// host's `manifest.codes.scan.statusSlot`. The session outlives the screen that
// started it, so on returning to that screen the user needs to see it is still
// running — and, just as important, must NOT see it on a sibling object. The
// match is on the context's canonical ORef, the one identity that survives an
// unmount/remount cycle.
import { computed } from 'vue';
import { Loader } from '@lucide/vue';
import { useScanSessionStore } from './scan-session';

const props = defineProps<{ entityRef?: string }>();

const session = useScanSessionStore();

const isRunningHere = computed<boolean>(
  () =>
    session.active &&
    Boolean(props.entityRef) &&
    session.request?.originRef === props.entityRef,
);
</script>

<template>
  <span
    v-if="isRunningHere"
    class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xxs font-bold bg-brand-500/15 text-brand-600 dark:text-brand-400"
    :title="$t('codes.scan.runningHere')"
  >
    <Loader class="w-3 h-3 animate-spin" />
    {{ $t('codes.scan.runningHere') }}
  </span>
</template>
