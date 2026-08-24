import { defineStore } from 'pinia';
import { ref } from 'vue';

// Promise-based confirmation, replacing native window.confirm(). A single
// <ConfirmDialog> mounted in the shell renders the prompt; callers await a
// boolean: `if (!(await confirm({ message }))) return;`.
export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' styles the confirm action as destructive (delete/wipe).
  tone?: 'danger' | 'default';
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

export const useConfirmStore = defineStore('confirm', () => {
  const state = ref<ConfirmState>({ open: false, message: '' });
  let resolver: ((value: boolean) => void) | null = null;

  const ask = (options: ConfirmOptions): Promise<boolean> => {
    state.value = { ...options, open: true };
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  };

  const respond = (value: boolean): void => {
    state.value = { ...state.value, open: false };
    resolver?.(value);
    resolver = null;
  };

  return { state, ask, respond };
});

// Ergonomic wrapper so views call `const confirm = useConfirm()` then
// `await confirm({ message, tone: 'danger' })`.
export const useConfirm = (): ((
  options: ConfirmOptions,
) => Promise<boolean>) => {
  const store = useConfirmStore();
  return (options: ConfirmOptions) => store.ask(options);
};
