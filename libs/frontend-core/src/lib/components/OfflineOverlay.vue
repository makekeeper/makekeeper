<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { WifiOff, Wifi, Loader, RotateCcw, CheckCircle } from '@lucide/vue';
import { useAvailabilityStore } from '../availability-store';
import Spinner from './Spinner.vue';
import Button from './Button.vue';

// Full-screen lock shown by the app shell whenever the backend is unreachable
// (#64). Teleported to <body> so it sits above the sidebar/chat panel (z-overlay)
// regardless of any transformed ancestor, and captures all interaction until
// the availability monitor confirms the backend answers again — at which point
// it tears itself down automatically (no manual reload).
const availability = useAvailabilityStore();

// How long the "connection restored" confirmation lingers before the overlay
// fades out, so the recovery reads as a deliberate state change rather than
// the notice just vanishing.
const RESTORED_LINGER_MS = 2_000;

const isReconnecting = computed<boolean>(
  () => availability.status === 'reconnecting',
);
// First load before the backend has ever answered (it may still be booting):
// show reassuring "starting up" copy and a plain spinner icon instead of the
// alarming "connection lost" wording reserved for a dropped connection.
const isStarting = computed<boolean>(() => !availability.everOnline);

// Post-recovery confirmation: when a real outage (the "connection lost" card,
// not the initial-boot handshake) ends, keep the overlay up briefly in a
// success state — availability icon + "connection restored" line — then hide.
const showRestored = ref(false);
let restoredTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => availability.status,
  (status, previous) => {
    if (
      status === 'online' &&
      (previous === 'offline' || previous === 'reconnecting')
    ) {
      showRestored.value = true;
      if (restoredTimer) clearTimeout(restoredTimer);
      restoredTimer = setTimeout(() => {
        showRestored.value = false;
        restoredTimer = null;
      }, RESTORED_LINGER_MS);
    } else if (status !== 'online' && showRestored.value) {
      // The connection dropped again mid-confirmation — fall straight back to
      // the offline card instead of finishing the success linger.
      if (restoredTimer) clearTimeout(restoredTimer);
      restoredTimer = null;
      showRestored.value = false;
    }
  },
);

// The success state only renders while the backend is actually healthy; a
// relapse during the linger is reset by the watcher above.
const isRestored = computed<boolean>(
  () => showRestored.value && !availability.isOffline,
);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        v-if="availability.isOffline || showRestored"
        role="alertdialog"
        aria-modal="true"
        :aria-label="
          isRestored ? $t('offline.restoredTitle') : $t('offline.title')
        "
        class="fixed inset-0 z-overlay flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm"
      >
        <div
          class="glass-card w-full max-w-sm rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-8 text-center animate-scale-in"
        >
          <div
            class="mx-auto flex items-center justify-center w-14 h-14 rounded-2xl transition-colors duration-300"
            :class="
              isRestored
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : isStarting
                  ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            "
          >
            <Wifi v-if="isRestored" class="w-7 h-7 animate-scale-in" />
            <Loader v-else-if="isStarting" class="w-7 h-7 animate-spin" />
            <WifiOff v-else class="w-7 h-7" />
          </div>
          <h2 class="mt-5 text-lg font-bold text-slate-900 dark:text-white">
            {{
              isRestored
                ? $t('offline.restoredTitle')
                : isStarting
                  ? $t('offline.startingTitle')
                  : $t('offline.title')
            }}
          </h2>
          <p
            class="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed"
          >
            {{
              isRestored
                ? $t('offline.restoredDescription')
                : isStarting
                  ? $t('offline.startingDescription')
                  : $t('offline.description')
            }}
          </p>
          <div
            role="status"
            class="mt-6 flex items-center justify-center gap-2 text-xs font-medium"
            :class="
              isRestored
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            "
          >
            <!-- The icon is purely decorative here; the adjacent span carries
                 the accessible status text, so hide it from screen readers to
                 avoid announcing the same status twice. -->
            <CheckCircle
              v-if="isRestored"
              class="w-4 h-4 shrink-0 animate-scale-in"
              aria-hidden="true"
            />
            <Spinner v-else size="sm" aria-hidden="true" />
            <span>{{
              isRestored
                ? $t('offline.restored')
                : isReconnecting
                  ? $t('offline.reconnecting')
                  : $t('offline.waiting')
            }}</span>
          </div>
          <div v-if="!isRestored" class="mt-6">
            <Button
              variant="secondary"
              size="sm"
              :icon-left="RotateCcw"
              :loading="isReconnecting"
              @click="availability.checkNow()"
            >
              {{ $t('offline.retryNow') }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
