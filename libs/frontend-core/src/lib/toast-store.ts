import { defineStore } from 'pinia';
import { ref } from 'vue';

// App-wide, non-blocking notification surface. Replaces the scattered silent
// `console.error` catches and native `alert()` calls: a failed save now shows an
// error toast, a background action a success toast. Rendered once by
// <ToastViewport> mounted in the app shell.
export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const DEFAULT_DURATION_MS = 4000;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);
  // Monotonic id counter — avoids Date.now()/random collisions on rapid toasts.
  let nextId = 0;

  const dismiss = (id: number): void => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };

  const show = (
    message: string,
    tone: ToastTone = 'info',
    durationMs: number = DEFAULT_DURATION_MS,
  ): number => {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, message, tone }];
    if (durationMs > 0) {
      setTimeout(() => dismiss(id), durationMs);
    }
    return id;
  };

  const success = (message: string, durationMs?: number): number =>
    show(message, 'success', durationMs);
  const error = (message: string, durationMs?: number): number =>
    show(message, 'error', durationMs);
  const info = (message: string, durationMs?: number): number =>
    show(message, 'info', durationMs);

  return { toasts, show, success, error, info, dismiss };
});
