<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { AnchoredPopover, BrandMark } from '@makekeeper/frontend-core';
import { HEADER_OVERFLOW } from './header-overflow';
import HeaderOverflowSection from './HeaderOverflowSection.vue';

// The single-user counterpart of the multiuser `UserMenu` (#274): the same
// avatar circle, opening a menu only when the header has collapsed controls to
// show. With nothing collapsed it stays the inert badge it always was — an
// empty menu would promise something it cannot deliver.
const overflow = inject(HEADER_OVERFLOW, null);
const count = computed(() => overflow?.collapsedCount.value ?? 0);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

// One circle, two roles: the same shape whether it is the inert badge or the
// menu trigger — only interactivity differs. It carries the PRODUCT's mark,
// not a person's initial: single-user mode has no account, and the "H" that
// stood here since the first commit was a mock-up's placeholder that never
// meant anything. `currentColor` on the circle tints the glyph.
const circleClass =
  'w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/10 flex items-center justify-center text-brand-600 dark:text-brand-300';
</script>

<template>
  <div ref="root" class="relative">
    <!-- The label names the button, not its contents: the count is announced
         by the shell's badge beside it (`HeaderOverflowBadge`), which overlays
         BOTH avatars. Saying it here too read it twice in a row. -->
    <button
      v-if="count > 0"
      type="button"
      :aria-label="$t('header.more')"
      :aria-expanded="open"
      aria-haspopup="true"
      :class="[
        circleClass,
        'transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
      ]"
      @click="open = !open"
    >
      <BrandMark variant="glyph" size="sm" />
    </button>
    <div v-else :class="circleClass" aria-hidden="true">
      <BrandMark variant="glyph" size="sm" />
    </div>

    <!-- Teleported out for the same reason as UserMenu's panel: the header's
         z-30 stacking context would put an in-place menu under the sidebar. -->
    <AnchoredPopover
      :open="open && count > 0"
      :anchor="root"
      @close="open = false"
    >
      <div class="w-72 glass-card rounded-2xl shadow-xl py-2 animate-scale-in">
        <HeaderOverflowSection :divider="false" />
      </div>
    </AnchoredPopover>
  </div>
</template>
