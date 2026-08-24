<script setup lang="ts" generic="T extends string">
import { type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import Badge from './Badge.vue';
import Tooltip from './Tooltip.vue';

// Vertical section picker for a page whose parts are too big to stack (#262):
// the sections on the left, the selected one filling the pane on the right.
//
// A sibling of `PageTabs`, not a replacement: that one is the tab bar of a
// hub, sitting between the page and its routes. This one lives INSIDE a page
// and is the reason a page stops being a scroll. Both are navigation — every
// item is a `RouterLink`, so a section is linkable, restorable and openable in
// a new tab, which a `v-model` control (`SegmentedControl`) is not.
//
// Below `lg` the column becomes a horizontally scrollable strip: two columns
// on a phone would leave neither of them usable.
export interface SectionNavItem<V extends string = string> {
  // Identity of the section, matched against `activeKey`.
  key: V;
  // Resolved label — the caller owns i18n (§5.5).
  label: string;
  to: RouteLocationRaw;
  icon?: Component;
  // One line under the label, on the wide layout only: the strip has no room
  // for it and a truncated hint is worse than none.
  description?: string;
  // Things inside the section waiting for the user. Rendered as a chip so a
  // section that is NOT selected can still ask to be opened; `0` renders
  // nothing rather than a zero.
  badge?: number;
  // What the count MEANS, resolved by the caller (§5.5). A bare number next to
  // a label says nothing to ANYONE — it is read out as "Connect 2", and a
  // sighted user is left guessing just as hard ("Labels & Codes 1" was asked
  // about the day it shipped). So it rides along twice: in a
  // screen-reader-only span, and as the chip's hover title.
  badgeLabel?: string;
}

defineProps<{
  items: SectionNavItem<T>[];
  activeKey: T;
  // Accessible name of the picker as a whole.
  ariaLabel: string;
}>();
</script>

<template>
  <nav
    :aria-label="ariaLabel"
    class="flex gap-1 overflow-x-auto no-scrollbar lg:flex-col lg:overflow-visible"
  >
    <RouterLink
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      :aria-current="item.key === activeKey ? 'page' : undefined"
      class="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:shrink lg:items-start"
      :class="
        item.key === activeKey
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200'
      "
    >
      <component
        :is="item.icon"
        v-if="item.icon"
        class="h-4 w-4 shrink-0 lg:mt-0.5"
        aria-hidden="true"
      />
      <span class="min-w-0 lg:flex-1">
        <span class="block truncate">{{ item.label }}</span>
        <span
          v-if="item.description"
          class="mt-0.5 hidden text-xxs font-normal text-slate-500 dark:text-slate-400 lg:block"
        >
          {{ item.description }}
        </span>
      </span>
      <Tooltip v-if="item.badge" :text="item.badgeLabel" class="shrink-0">
        <Badge tone="warning">
          {{ item.badge }}
          <span v-if="item.badgeLabel" class="sr-only">{{
            item.badgeLabel
          }}</span>
        </Badge>
      </Tooltip>
    </RouterLink>
  </nav>
</template>
