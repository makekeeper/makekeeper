<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AnchoredPopover, BrandMark } from '@makekeeper/frontend-core';
import { HEADER_OVERFLOW } from './header-overflow';
import HeaderOverflowSection from './HeaderOverflowSection.vue';
import FeedbackLinks from './FeedbackLinks.vue';

// The single-user counterpart of the multiuser `UserMenu` (#274): the same
// avatar circle, opening the same menu.
//
// It used to be an inert badge until the header had something collapsed to
// show — an empty menu promises what it cannot deliver. Since #342 the menu is
// never empty: the feedback block is always in it, which is the point of a
// route back to us that does not depend on how wide the window happens to be.
const overflow = inject(HEADER_OVERFLOW, null);
// Still needed for the label: "More" names a menu that is mostly collapsed
// controls, and the badge beside the avatar counts them.
const count = computed(() => overflow?.collapsedCount.value ?? 0);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

// Navigating from the menu closes it. Until #342 the panel held only toggles,
// so nothing in it ever changed the route and the question never came up; a
// menu left hanging over the page it just opened reads as a stuck overlay.
const route = useRoute();
watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);

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

    <!-- Teleported out for the same reason as UserMenu's panel: the header's
         z-30 stacking context would put an in-place menu under the sidebar. -->
    <AnchoredPopover :open="open" :anchor="root" @close="open = false">
      <div class="w-72 glass-card rounded-2xl shadow-xl py-2 animate-scale-in">
        <!-- The divider is back on: the collapsed controls are no longer the
             menu's only content, and two unrelated groups need the rule. -->
        <HeaderOverflowSection />
        <FeedbackLinks variant="menu" />
      </div>
    </AnchoredPopover>
  </div>
</template>
