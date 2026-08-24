<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, toRef } from 'vue';
import { HEADER_OVERFLOW } from './header-overflow';

// One control in the app header (#274). It declares how long it should survive
// a narrowing window; `HeaderOverflowRow` measures it and, when it no longer
// fits, the control teleports itself into the overflow panel — the same
// component instance, so its state and focus behaviour travel with it.
const props = defineProps<{
  /** Stable across renders — it keys the measurement cache. */
  id: string;
  /** Higher survives longer; `Infinity` never collapses. */
  priority: number;
  /**
   * What names the control once it is inside the panel, where it has lost the
   * context its place in the row gave it. Already translated by the caller.
   * Omitted for a pinned control, which never reaches the panel.
   */
  label?: string;
  /**
   * Where the control sits inside the panel. Rows arrive in the order they
   * collapse, not the order they stood in the row — flex `order` restores a
   * stable reading order whatever the collapse history was.
   */
  panelOrder?: number;
  /**
   * The control IS its own row in the panel: no label beside it, full menu
   * width. The search field — a control whose placeholder already names it.
   */
  panelFull?: boolean;
}>();

const el = ref<HTMLElement | null>(null);
const overflow = inject(HEADER_OVERFLOW, null);

const collapsed = computed(() => overflow?.isCollapsed(props.id) ?? false);
const compact = computed(() => overflow?.isCompact(props.id) ?? false);
const panelBody = computed(() => overflow?.panelBody.value ?? null);

onMounted(() => {
  // No compact declaration: the row discovers a narrower form from the
  // rendered `[data-compact-drop]` markup on every measure (#277).
  overflow?.register({
    id: props.id,
    priority: toRef(props, 'priority'),
    el,
  });
});

onBeforeUnmount(() => overflow?.unregister(props.id));
</script>

<template>
  <!-- The menu body exists only while the menu is open, so a collapsed control
       may have nowhere to go — then it merely hides in the row (`v-show`), and
       teleports in the moment the section mounts. `v-show`, not `v-if`: the
       control's state must survive the trips. -->
  <Teleport :to="panelBody" :disabled="!collapsed || !panelBody">
    <div
      ref="el"
      v-show="!collapsed || panelBody"
      :class="
        collapsed
          ? panelFull
            ? 'panel-full w-full px-2 py-1.5'
            : 'flex items-center justify-between gap-4 px-2 py-2 rounded-xl'
          : 'shrink-0'
      "
      :style="collapsed ? { order: panelOrder ?? 0 } : undefined"
    >
      <span
        v-if="collapsed && !panelFull"
        class="text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap"
      >
        {{ label }}
      </span>
      <slot :compact="compact" :collapsed="collapsed" />
    </div>
  </Teleport>
</template>

<style scoped>
/* A full-row control stretches to the menu's width and no further. Reaching
   through the slot is deliberate: the contribution sizes itself for the header
   row (`w-56`), and the slot contract (#277) settled on the panel imposing a
   form rather than letting contributions declare one. `!important` because it
   ties with utility classes of equal specificity on the same elements. */
.panel-full > :deep(*) {
  width: 100%;
  max-width: 100%;
}
.panel-full :deep(input) {
  width: 100% !important;
  max-width: 100% !important;
}
</style>
