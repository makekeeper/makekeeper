<script setup lang="ts">
import { computed, ref } from 'vue';
import { ImagePlus, Star, Upload, X } from '@lucide/vue';
import Button from './Button.vue';
import Badge from './Badge.vue';
import { previewUrl } from '../preview-url';

// A set of photographs, edited in place (#214, epic #212).
//
// It lives here rather than in `plugin-inventory` because it is design-system
// UI — a thumbnail grid, a cover badge, a drop zone — and the repo's rule is to
// extend the primitive rather than fork it (§5.4). A project's Files tab is a
// FILE list and deliberately stays its own thing; this is the picture case.
//
// The component is CONTROLLED: it owns no list. The form holds the photos, so
// Cancel really cancels — which is the whole reason the desktop form is not
// three immediate endpoints.
//
// Thumbnails render the `xs` rendition of a stored photo (#113); a pending pick
// is its own data URL, which has no renditions yet.

export interface GalleryPhoto {
  // Stable identity within the list. The attachment id for a stored photo; any
  // unique token for one that has not been saved yet.
  key: string;
  // What to paint: an "/api/uploads/:id" URL or a `data:` URL.
  src: string;
  isCover: boolean;
}

const props = withDefaults(
  defineProps<{
    photos: GalleryPhoto[];
    // Hard cap; the add control disables at it.
    max: number;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  // Files the user picked or dropped, already filtered to images and capped to
  // the remaining slots. Turning them into data URLs is the owner's job — it is
  // the owner that decides how they are downscaled and sent.
  (e: 'add', files: File[]): void;
  (e: 'remove', key: string): void;
  (e: 'makeCover', key: string): void;
  (e: 'open', key: string): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

const remaining = computed<number>(() =>
  Math.max(0, props.max - props.photos.length),
);
const isFull = computed<boolean>(() => remaining.value === 0);

// Only images, and only as many as still fit. Silently trimming the overflow
// beats accepting a drop and then refusing the whole thing on save.
const accept = (files: FileList | null | undefined): void => {
  if (!files || isFull.value) return;
  const images = Array.from(files)
    .filter((file) => file.type.startsWith('image/'))
    .slice(0, remaining.value);
  if (images.length > 0) emit('add', images);
};

const onSelected = (event: Event): void => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const files = input.files;
  // Cleared before the emit, so picking the same file twice in a row still
  // fires a `change`.
  input.value = '';
  accept(files);
};

// Only an external FILE drag highlights and drops — an internal drag of the
// app's own chips must not look droppable here.
const onDragOver = (event: DragEvent): void => {
  if (props.disabled || isFull.value) return;
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
    isDragging.value = true;
  }
};

// `relatedTarget` outside the zone, so crossing a child does not flicker.
// Both ends are narrowed with `instanceof` rather than asserted (§5.1); a
// pointer leaving for outside the document has no related target at all, which
// is itself "left the zone".
const onDragLeave = (event: DragEvent): void => {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  const to = event.relatedTarget;
  if (!(to instanceof Node) || !el.contains(to)) {
    isDragging.value = false;
  }
};

const onDrop = (event: DragEvent): void => {
  if (props.disabled || isFull.value) return;
  event.preventDefault();
  isDragging.value = false;
  accept(event.dataTransfer?.files);
};

// A stored photo gets its small rendition; a pending `data:` URL is already the
// bytes we have.
const thumbSrc = (photo: GalleryPhoto): string =>
  photo.src.startsWith('data:') ? photo.src : previewUrl(photo.src, 'xs');
</script>

<template>
  <div
    class="relative space-y-3 rounded-xl transition-colors"
    :class="
      isDragging
        ? 'ring-2 ring-brand-500/60 ring-offset-4 ring-offset-slate-50 dark:ring-offset-dark-950'
        : ''
    "
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onSelected"
    />

    <div
      v-if="isDragging"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500/60 bg-brand-500/10"
    >
      <span
        class="flex items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-400"
      >
        <Upload class="h-5 w-5" />
        {{ $t('common.photos.dropHere') }}
      </span>
    </div>

    <ul v-if="photos.length > 0" class="grid grid-cols-2 gap-3">
      <li
        v-for="photo in photos"
        :key="photo.key"
        class="group relative aspect-square"
      >
        <button
          type="button"
          :aria-label="$t('common.photos.open')"
          class="block h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-white/5 dark:bg-white/[0.02]"
          @click="emit('open', photo.key)"
        >
          <img
            :src="thumbSrc(photo)"
            :alt="$t('common.photos.alt')"
            class="h-full w-full object-cover"
            draggable="false"
          />
        </button>

        <!-- The cover, said once. A badge on the one that is, a quiet action on
             the ones that could be — never both on the same thumbnail. -->
        <Badge
          v-if="photo.isCover"
          tone="overlay"
          class="pointer-events-none absolute left-2 top-2"
        >
          <Star class="h-3 w-3" />
          {{ $t('common.photos.cover') }}
        </Badge>
        <!-- `overlayScrim` is the primitive for a control sitting ON a picture
             (§5.4): it brings its own scrim, so a white glyph does not vanish
             against a light photo. Hand-classing these was how the chrome of
             every media surface used to drift apart. -->
        <Button
          v-else-if="!disabled"
          variant="overlayScrim"
          size="icon-sm"
          class="absolute left-2 top-2"
          :icon-left="Star"
          :aria-label="$t('common.photos.makeCover')"
          :title="$t('common.photos.makeCover')"
          @click="emit('makeCover', photo.key)"
        />

        <Button
          v-if="!disabled"
          variant="overlayScrim"
          size="icon-sm"
          class="absolute right-2 top-2"
          :icon-left="X"
          :aria-label="$t('common.photos.remove')"
          :title="$t('common.photos.remove')"
          @click="emit('remove', photo.key)"
        />
      </li>
    </ul>

    <!-- Empty state doubles as the drop target; with photos present the add
         control shrinks to a button so the pictures keep the space. -->
    <button
      v-if="photos.length === 0"
      type="button"
      :disabled="disabled"
      :aria-label="$t('common.photos.add')"
      class="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-brand-500/50 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10"
      @click="fileInput?.click()"
    >
      <ImagePlus class="h-8 w-8" />
      <span class="text-xs font-semibold">{{ $t('common.photos.add') }}</span>
    </button>
    <Button
      v-else
      variant="secondary"
      size="sm"
      type="button"
      block
      :icon-left="ImagePlus"
      :disabled="disabled || isFull"
      @click="fileInput?.click()"
    >
      {{
        isFull
          ? $t('common.photos.full', { max })
          : $t('common.photos.addMore', { remaining })
      }}
    </Button>
  </div>
</template>
