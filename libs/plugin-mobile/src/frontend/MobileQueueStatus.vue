<script setup lang="ts">
import { Button, useOfflineQueue } from '@makekeeper/frontend-core';
import { CloudOff, AlertTriangle, X } from '@lucide/vue';

// What the offline queue looks like to the person holding the phone (#202).
//
// Two states, and the difference matters. PENDING is weather: the work is safe
// and will go when the signal comes back. FAILED is a verdict: the server
// refused this delta — the part is gone, or the count would go negative — and it
// will never apply, so it is shown until a human deals with it. What must never
// happen is either one looking like a success.

const queue = useOfflineQueue();
</script>

<template>
  <div
    v-if="queue.pendingCount > 0 || queue.failed.length > 0"
    class="px-4 py-2 space-y-2 border-t border-slate-200 dark:border-white/5"
  >
    <p
      v-if="queue.pendingCount > 0"
      class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
    >
      <CloudOff class="w-4 h-4 shrink-0" />
      {{ $t('mobile.queue.pending', { count: queue.pendingCount }) }}
    </p>

    <div
      v-for="op in queue.failed"
      :key="op.id"
      class="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
    >
      <AlertTriangle
        class="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
      />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold text-amber-900 dark:text-amber-200">
          {{ $t('mobile.queue.failed', { label: op.label }) }}
        </p>
        <p
          v-if="op.error"
          class="text-xs text-amber-800 dark:text-amber-300 break-words"
        >
          {{ op.error }}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        :icon-left="X"
        :aria-label="$t('mobile.queue.dismiss')"
        @click="queue.discard(op.id)"
      />
    </div>
  </div>
</template>
