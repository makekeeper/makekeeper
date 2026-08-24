<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
// Relative, not `@makekeeper/frontend-core`: this component now lives INSIDE
// that library, and a lib importing itself through its own alias is a cycle.
import Button from './Button.vue';
import { previewUrl } from '../preview-url';
import { ChevronLeft, ChevronRight, Download, X } from '@lucide/vue';

// Full-size viewing for the Files tab (#117).
//
// Not built on the shared `Modal`: that is a glass card sized to its content,
// and a photo viewer is the opposite — a dark full-bleed surface where the
// picture is the content and the chrome gets out of its way. What it does copy
// from Modal is the behaviour that makes a dialog a dialog: teleport to body,
// Esc to close, focus captured and returned, `aria-modal`.
//
// The picture shown is the `lg` rendition (2048 px), never the original: the
// original is what Download and drag-out serve (#109), and a build log's photos
// are multi-megabyte camera files. The backend produces `lg` on first request,
// so the first open of a given photo pays the resize and every later one is a
// cache hit.

export interface LightboxImage {
  id: string;
  url: string;
  filename: string | null;
}

const props = defineProps<{
  images: LightboxImage[];
  // Which image is open; null closes. Owned by the route, not by this component.
  openId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:openId', value: string | null): void;
  (e: 'download', image: LightboxImage): void;
}>();

const index = computed<number>(() =>
  props.images.findIndex((image) => image.id === props.openId),
);
const current = computed<LightboxImage | null>(
  () => props.images[index.value] ?? null,
);

const isOpen = computed<boolean>(() => current.value !== null);

const go = (step: number): void => {
  if (props.images.length === 0 || index.value < 0) return;
  // Wrap around: in a grid of photos there is no "first" or "last" worth
  // stopping at, and a dead arrow key reads as a broken one.
  const next = (index.value + step + props.images.length) % props.images.length;
  emit('update:openId', props.images[next].id);
};

const close = (): void => emit('update:openId', null);

// Preload the neighbours so arrowing through a project does not flash empty
// frames — the browser has them by the time the key is pressed.
const neighbours = computed<string[]>(() => {
  if (props.images.length < 2 || index.value < 0) return [];
  const at = (step: number): LightboxImage =>
    props.images[
      (index.value + step + props.images.length) % props.images.length
    ];
  return [at(1), at(-1)]
    .filter((image) => image.id !== props.openId)
    .map((image) => previewUrl(image.url, 'lg'));
});

const panelRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

// Same selector and cycle as `Modal` — a dialog with `aria-modal` that lets Tab
// walk out onto the page it claims to have covered is the failure this prevents.
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

const trapTab = (event: KeyboardEvent): void => {
  const panel = panelRef.value;
  if (!panel) return;
  const focusable = Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Tab') {
    trapTab(event);
    return;
  }
  if (event.key === 'Escape') close();
  else if (event.key === 'ArrowRight') go(1);
  else if (event.key === 'ArrowLeft') go(-1);
  else return;
  event.preventDefault();
};

// `immediate` matters: a deep link lands with the viewer ALREADY open, and a
// watcher that only fires on change would leave that page with no key handling
// and no focus — the one case a keyboard user is most likely to arrive in.
watch(
  isOpen,
  (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', onKeydown);
      // Focus the surface itself, not its first button: the arrow keys are the
      // primary control here and must work without the user clicking first,
      // which parking focus on Download would not achieve.
      void Promise.resolve().then(() => panelRef.value?.focus());
    } else {
      document.removeEventListener('keydown', onKeydown);
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

// Swipe: the same gesture as every phone gallery. Tracked with pointer events
// so a mouse drag works too, and thresholded so a tap-with-a-wobble does not
// count as a swipe.
const SWIPE_THRESHOLD_PX = 50;
let pointerStartX: number | null = null;
// A mouse swipe across the backdrop ends in a synthesized `click`, which the
// backdrop reads as "dismiss". Without this the gesture would advance the image
// and then immediately close the viewer.
let swipeConsumedClick = false;

const onPointerDown = (event: PointerEvent): void => {
  pointerStartX = event.clientX;
  swipeConsumedClick = false;
};

// A cancelled gesture (the browser takes over the pan, the pointer leaves the
// window) must forget its origin: a stale start point would turn the next tap
// into a swipe of whatever distance separated the two.
const onPointerCancel = (): void => {
  pointerStartX = null;
};

const onPointerUp = (event: PointerEvent): void => {
  if (pointerStartX === null) return;
  const dx = event.clientX - pointerStartX;
  pointerStartX = null;
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
  swipeConsumedClick = true;
  go(dx < 0 ? 1 : -1);
};

const onBackdropClick = (): void => {
  if (swipeConsumedClick) {
    swipeConsumedClick = false;
    return;
  }
  close();
};
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
        v-if="current"
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        :aria-label="current.filename ?? $t('common.lightbox.title')"
        tabindex="-1"
        class="fixed inset-0 z-modal flex flex-col bg-slate-950/90 backdrop-blur-sm focus:outline-none"
        @click.self="onBackdropClick"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <!-- Chrome: name on the left, actions on the right. Kept at low contrast
             so it never competes with the picture. -->
        <div
          class="flex shrink-0 items-center gap-3 px-4 py-3 text-white/80"
          @click.stop
        >
          <p class="min-w-0 flex-1 truncate text-sm">
            {{ current.filename || $t('common.lightbox.unnamed') }}
          </p>
          <p v-if="images.length > 1" class="shrink-0 text-xs text-white/50">
            {{ index + 1 }} / {{ images.length }}
          </p>
          <Button
            variant="overlay"
            size="icon"
            :icon-left="Download"
            :aria-label="$t('common.download')"
            @click="emit('download', current)"
          />
          <Button
            variant="overlay"
            size="icon"
            :icon-left="X"
            :aria-label="$t('common.close')"
            @click="close()"
          />
        </div>

        <!-- The picture. `object-contain` inside the remaining space: a photo is
             never cropped here, which is the whole point of opening it. -->
        <div
          class="relative flex min-h-0 flex-1 items-center justify-center p-4"
        >
          <img
            :key="current.id"
            :src="previewUrl(current.url, 'lg')"
            :alt="current.filename ?? $t('common.lightbox.alt')"
            class="max-h-full max-w-full object-contain animate-fade-in"
            draggable="false"
            @click.stop
          />

          <template v-if="images.length > 1">
            <Button
              variant="overlayScrim"
              size="icon"
              pill
              class="absolute left-2"
              :icon-left="ChevronLeft"
              :aria-label="$t('common.lightbox.previous')"
              @click.stop="go(-1)"
            />
            <Button
              variant="overlayScrim"
              size="icon"
              pill
              class="absolute right-2"
              :icon-left="ChevronRight"
              :aria-label="$t('common.lightbox.next')"
              @click.stop="go(1)"
            />
          </template>
        </div>

        <!-- Neighbours, fetched but never shown. -->
        <img
          v-for="src in neighbours"
          :key="src"
          :src="src"
          alt=""
          aria-hidden="true"
          class="hidden"
        />
      </div>
    </Transition>
  </Teleport>
</template>
