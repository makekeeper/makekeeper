<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { resolvePluginIcon } from '../plugin-icons';
import { isNavPathActive } from '../registry';

// Navigational tab bar for a page whose sub-sections are their own routes
// (#110): underline style, one `RouterLink` per tab, horizontally scrollable on
// narrow screens. Navigation — NOT a `v-model` control, which is why
// `SegmentedControl` is not reused here.
export interface PageTabItem {
  // Router path the tab links to.
  path: string;
  // i18n key for the tab label (never a literal, §5.5).
  titleKey: string;
  // Lucide icon name, resolved through the shared plugin-icon registry.
  icon?: string;
}

const props = defineProps<{
  tabs: PageTabItem[];
  // Accessible name of the tab bar as a whole (e.g. the hub's own label).
  ariaLabel: string;
}>();

const route = useRoute();

// The active tab is the one whose path matches most specifically: an exact
// match, else the LONGEST path the current route is a sub-path of. Longest wins
// so a hub's own root tab (`/settings`) does not stay lit on `/settings/agent`,
// while a tab with drill-down routes of its own still keeps its tab lit.
const activePath = computed<string | null>(() => {
  const matches = props.tabs
    .map((tab) => tab.path)
    .filter((path) => isNavPathActive(route.path, path));
  return matches.reduce<string | null>(
    (best, path) => (best === null || path.length > best.length ? path : best),
    null,
  );
});
</script>

<template>
  <nav
    :aria-label="ariaLabel"
    class="flex gap-6 overflow-x-auto border-b border-slate-200 dark:border-white/5 select-none no-scrollbar"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      :aria-current="activePath === tab.path ? 'page' : undefined"
      class="flex items-center gap-2 shrink-0 pb-3.5 text-sm font-semibold border-b-2 transition-all rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      :class="[
        activePath === tab.path
          ? 'border-brand-500 text-brand-600 dark:text-brand-400'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
      ]"
    >
      <component
        :is="resolvePluginIcon(tab.icon)"
        v-if="tab.icon"
        class="w-4 h-4 shrink-0"
      />
      {{ $t(tab.titleKey) }}
    </RouterLink>
  </nav>
</template>
