<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

// A dropdown panel that escapes its anchor's stacking context (#274).
//
// A panel rendered in place inherits the z-index ceiling of whatever contains
// it — the app header is `z-30` while the sidebar is `z-40`, so an `absolute`
// menu inside the header slides UNDER the sidebar the moment its anchor sits
// close enough to it. The cure is the same one `Select` uses: teleport to
// <body>, position `fixed` at the `z-popover` tier, follow the anchor on
// scroll (capture phase, so scrolling ancestors are caught) and resize.
//
// The caller owns `open` and the anchor element; the popover owns where the
// panel sits and when it should close. Dismissal lives here, not in every
// caller: with the panel teleported to <body>, "outside" means outside the
// anchor AND outside the panel — a check every caller used to duplicate — and
// Escape must be heard wherever focus currently is, which only a
// document-level listener guarantees once the panel has left the anchor's
// subtree. Alignment is to the anchor's trailing edge, the header-menu case;
// extend with an `align` prop when a leading-edge caller appears.
const props = defineProps<{
  open: boolean;
  anchor: HTMLElement | null;
}>();

const emit = defineEmits<{ close: [] }>();

const GAP = 8;
const panelStyle = ref<{ top: string; right: string }>({
  top: '0',
  right: '0',
});

const updatePosition = (): void => {
  const anchor = props.anchor;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  panelStyle.value = {
    top: `${rect.bottom + GAP}px`,
    right: `${window.innerWidth - rect.right}px`,
  };
};

const panelRef = ref<HTMLElement | null>(null);

const onDocumentClick = (event: MouseEvent): void => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (props.anchor?.contains(target) || panelRef.value?.contains(target)) {
    return;
  }
  emit('close');
};

const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close');
};

const detach = (): void => {
  window.removeEventListener('scroll', updatePosition, true);
  window.removeEventListener('resize', updatePosition);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      updatePosition();
      void nextTick(updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      // Attached only while open, inside the watcher's post-task microtask —
      // the click that opened the panel has finished propagating by then, so
      // it can never dismiss what it just opened.
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('keydown', onDocumentKeydown);
    } else {
      detach();
    }
  },
  { immediate: true },
);

onBeforeUnmount(detach);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="panelRef" class="fixed z-popover" :style="panelStyle">
      <slot />
    </div>
  </Teleport>
</template>
