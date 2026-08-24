<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

// The app's hover explanation, as a primitive.
//
// The surface already existed three times over — the spark chart, the
// contribution heatmap and the Sankey widget each hand-rolled the same
// teleported `bg-white dark:bg-dark-800 / border / shadow-lg / text-xxs` box,
// because there was nothing to reach for. This is that box, once.
//
// Why teleported and `fixed` rather than an absolutely positioned sibling: a
// trigger often lives inside something that clips (the heatmap's scroll
// container, `SectionNav`'s horizontal strip below `lg`), and an absolute
// bubble is cut off by its ancestor's `overflow`. It also has to escape any
// stacking context the trigger sits in.
//
// It explains, it never *contains* — no interactive content, `pointer-events`
// off, so it can never swallow a click meant for the trigger. Text that only a
// tooltip carries is text a touch user never gets: the caller keeps saying it
// some other way too (`SectionNav` keeps its screen-reader span).
const props = withDefaults(
  defineProps<{
    // Resolved text — the caller owns i18n (§5.5). Empty renders no tooltip,
    // so an optional label needs no `v-if` at the call site.
    text?: string;
    // Wrapper display. `inline-flex` suits a chip beside a label; `contents`
    // lets the trigger keep its parent's layout (a grid or flex child that
    // must not gain a box).
    display?: 'inline-flex' | 'contents';
    // Which side of the trigger the bubble sits on. `right` exists for a
    // vertical strip of triggers — the collapsed sidebar rail (#268) — where a
    // bubble above the item covers the item above it.
    placement?: 'top' | 'right';
    // `xs` is the hover box over a chart or a chip. `sm` is for a tooltip that
    // stands in for a LABEL the UI is currently not showing (the collapsed
    // rail): it has to read like the label it replaces, which in the expanded
    // sidebar is `text-sm`.
    size?: 'xs' | 'sm';
  }>(),
  { text: '', display: 'inline-flex', placement: 'top', size: 'xs' },
);

// Viewport coordinates of the anchor point: the top-centre of the trigger, or
// its right-middle when the bubble sits beside it.
const at = ref<{ x: number; y: number } | null>(null);

const hide = (): void => {
  at.value = null;
};

const show = (event: Event): void => {
  if (!props.text) return;
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  // A `display: contents` wrapper generates no box, so it has no rect of its
  // own — every coordinate off it is 0, and the bubble lands in the top-left
  // corner of the window. Measure what it wraps instead.
  const anchor =
    props.display === 'contents' && el.firstElementChild instanceof HTMLElement
      ? el.firstElementChild
      : el;
  const rect = anchor.getBoundingClientRect();
  at.value =
    props.placement === 'right'
      ? { x: rect.right, y: rect.top + rect.height / 2 }
      : { x: rect.left + rect.width / 2, y: rect.top };
};

// A bubble centred on a trigger near the edge hangs half of itself off screen —
// the section picker is a horizontal strip on a phone, so its last chip is
// always that trigger. The correction is measured, not assumed: nudging by a
// worst-case width would shove every SHORT tooltip inwards too, and a bubble
// that does not sit over the thing it explains is its own bug.
const EDGE = 8;

// The gap between the trigger and a bubble sitting beside it. The `top`
// placement's equivalent is the -6px lift below.
const GAP = 8;

const tip = ref<HTMLElement | null>(null);
const shift = ref({ x: 0, y: 0 });

// Both axes, for both placements: a `right` bubble on the rail's last item runs
// off the BOTTOM as readily as a `top` one runs off the side, and a `top` bubble
// on a trigger in the first row runs off above.
watch(at, async (anchor) => {
  shift.value = { x: 0, y: 0 };
  if (!anchor) return;
  await nextTick();
  const rect = tip.value?.getBoundingClientRect();
  if (!rect) return;
  shift.value = {
    x:
      Math.max(0, EDGE - rect.left) -
      Math.max(0, rect.right - (window.innerWidth - EDGE)),
    y:
      Math.max(0, EDGE - rect.top) -
      Math.max(0, rect.bottom - (window.innerHeight - EDGE)),
  };
});

const position = computed<Record<string, string>>(() => {
  const anchor = at.value;
  if (!anchor) return {};
  if (props.placement === 'right') {
    return {
      left: `${anchor.x + GAP + shift.value.x}px`,
      top: `${anchor.y + shift.value.y}px`,
      // Beside the trigger there is only so much room left. A bubble would
      // rather wrap than hang off the screen: cap it at what remains instead of
      // sliding it back over the very thing it explains. Inline max-width beats
      // the class, so the primitive's own `max-w-xs` (20rem) is restated here
      // rather than lost — this narrows the bubble, it never widens it.
      maxWidth: `min(20rem, ${Math.max(0, window.innerWidth - anchor.x - GAP - EDGE)}px)`,
    };
  }
  return {
    left: `${anchor.x + shift.value.x}px`,
    top: `${anchor.y - 6 + shift.value.y}px`,
  };
});

// A `fixed` bubble does not travel with the page, so anything that moves the
// trigger under it must close it rather than leave it pointing at nothing.
// Capture phase: the scroll that matters is usually an inner container's.
const onScroll = (): void => hide();

window.addEventListener('scroll', onScroll, true);
window.addEventListener('resize', onScroll);
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onScroll);
});
</script>

<template>
  <span
    :class="display === 'contents' ? 'contents' : 'inline-flex'"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
  </span>

  <Teleport to="body">
    <div
      v-if="at && text"
      ref="tip"
      role="tooltip"
      class="fixed z-tooltip max-w-xs rounded-lg border border-slate-200 bg-white text-slate-600 shadow-lg pointer-events-none dark:border-white/10 dark:bg-dark-800 dark:text-slate-300"
      :class="[
        placement === 'right'
          ? '-translate-y-1/2'
          : '-translate-x-1/2 -translate-y-full',
        size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-2 py-1 text-xxs',
      ]"
      :style="position"
    >
      {{ text }}
    </div>
  </Teleport>
</template>
