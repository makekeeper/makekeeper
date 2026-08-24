<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, computed } from 'vue';
import { X } from '@lucide/vue';

// One dialog primitive: teleported overlay, glass panel, Esc + backdrop dismiss,
// focus capture/return. Replaces the three hand-rolled modals that differed in
// overlay colour, container class, close affordance and animation.
type ModalWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

// Which rung of the overlay ladder this dialog sits on (tailwind.config.js).
// `confirm` is for a dialog that must cover another dialog — a confirmation
// raised from inside one is the case that exists.
type ModalLayer = 'modal' | 'confirm';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    width?: ModalWidth;
    layer?: ModalLayer;
    // Set false to force use of an explicit action instead of backdrop/Esc.
    dismissible?: boolean;
  }>(),
  {
    title: '',
    width: 'md',
    layer: 'modal',
    dismissible: true,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'close'): void;
}>();

const panelRef = ref<HTMLElement | null>(null);
// The element focused before the dialog opened, restored on close.
let previouslyFocused: HTMLElement | null = null;

const widthClass = computed<string>(() => {
  const map = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  } satisfies Record<ModalWidth, string>;
  return map[props.width];
});

const close = (): void => {
  if (!props.dismissible) return;
  emit('update:modelValue', false);
  emit('close');
};

const focusableSelector =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    close();
    return;
  }
  if (e.key !== 'Tab' || !panelRef.value) return;
  const focusable = Array.from(
    panelRef.value.querySelectorAll<HTMLElement>(focusableSelector),
  );
  if (focusable.length === 0) {
    e.preventDefault();
    panelRef.value.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', onKeydown);
      nextTick(() => {
        const target =
          panelRef.value?.querySelector<HTMLElement>(focusableSelector);
        (target ?? panelRef.value)?.focus();
      });
    } else {
      document.removeEventListener('keydown', onKeydown);
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm"
        :class="layer === 'confirm' ? 'z-confirm' : 'z-modal'"
        @click.self="close"
      >
        <div
          ref="panelRef"
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          tabindex="-1"
          class="glass-card w-full rounded-2xl shadow-2xl animate-scale-in focus:outline-none"
          :class="widthClass"
        >
          <!-- Header -->
          <div
            v-if="title || $slots.header || dismissible"
            class="flex items-start justify-between gap-4 p-6 pb-0"
          >
            <slot name="header">
              <h3
                v-if="title"
                class="text-base font-semibold text-slate-900 dark:text-white"
              >
                {{ title }}
              </h3>
            </slot>
            <button
              v-if="dismissible"
              type="button"
              @click="close"
              :aria-label="$t('common.close')"
              class="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Body -->
          <div
            class="p-6"
            :class="{ 'pt-4': title || $slots.header || dismissible }"
          >
            <slot />
          </div>

          <!-- Footer -->
          <div
            v-if="$slots.footer"
            class="px-6 pb-6 pt-0 flex justify-end gap-3"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
