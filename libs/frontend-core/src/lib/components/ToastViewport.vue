<script setup lang="ts">
import { computed, type Component } from 'vue';
import { CheckCircle, XCircle, Info, X } from '@lucide/vue';
import { useToastStore, type ToastTone } from '../toast-store';

// Renders the toast stack. Mount once in the app shell; plugins push messages
// via useToastStore(). Teleported top-right, above modals/panels.
const store = useToastStore();

const toneIcon = (tone: ToastTone): Component => {
  const map = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
  } satisfies Record<ToastTone, Component>;
  return map[tone];
};

const toneClass = (tone: ToastTone): string => {
  const map = {
    success: 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    error: 'border-red-500/30 text-red-700 dark:text-red-300',
    info: 'border-brand-500/30 text-brand-700 dark:text-brand-300',
  } satisfies Record<ToastTone, string>;
  return map[tone];
};

const iconClass = (tone: ToastTone): string => {
  const map = {
    success: 'text-emerald-500',
    error: 'text-red-500',
    info: 'text-brand-500',
  } satisfies Record<ToastTone, string>;
  return map[tone];
};

const hasToasts = computed<boolean>(() => store.toasts.length > 0);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="hasToasts"
      class="fixed top-4 right-4 z-toast flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
      role="region"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="transition ease-out duration-200"
        enter-from-class="opacity-0 translate-x-4"
        enter-to-class="opacity-100 translate-x-0"
        leave-active-class="transition ease-in duration-150"
        leave-from-class="opacity-100 translate-x-0"
        leave-to-class="opacity-0 translate-x-4"
      >
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="glass-card rounded-xl border shadow-lg p-3 pr-2 flex items-start gap-2.5"
          :class="toneClass(toast.tone)"
        >
          <component
            :is="toneIcon(toast.tone)"
            class="w-5 h-5 shrink-0 mt-0.5"
            :class="iconClass(toast.tone)"
          />
          <!-- whitespace-pre-line: a caller that reports several rejected files
               in one toast separates them with newlines (#112); without this
               they collapse into one run-on line. -->
          <p
            class="flex-1 text-sm text-slate-700 dark:text-slate-200 leading-snug break-words whitespace-pre-line"
          >
            {{ toast.message }}
          </p>
          <button
            type="button"
            @click="store.dismiss(toast.id)"
            :aria-label="$t('common.close')"
            class="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
