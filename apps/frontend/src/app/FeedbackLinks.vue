<script setup lang="ts">
import { Bug, Lightbulb } from '@lucide/vue';
import { Tooltip } from '@makekeeper/frontend-core';

// The product's route back to us, as the shell shows it (#342).
//
// Neither surface decides anything: both lead to Settings → About, which is
// where the addresses, the prefilled report and the description live. A shell
// that assembled a GitHub URL of its own would be a second copy of that
// knowledge, and the two would drift.
//
// Two places, because neither is enough alone: the sidebar is where a user
// looks for the app's own information (the version already sits there), and the
// avatar menu is what remains when the sidebar is collapsed.
const props = withDefaults(
  defineProps<{
    variant: 'sidebar' | 'menu';
    /** Sidebar only: icon-only rows, named by the tooltip instead. */
    collapsed?: boolean;
  }>(),
  { collapsed: false },
);

// By PATH, not by route name: the target route belongs to the settings plugin,
// and `RouterLink` THROWS on a name it cannot resolve while an unmatched path
// merely warns. Settings is core and never disabled, so this is belt and
// braces — but a shell that dies because a plugin route moved is the wrong
// trade for one saved lookup. The path is the same one the manifest declares.
const ABOUT_PATH = '/settings/about';

// Both rows land on the same page, so each says which action it came for and
// About highlights that one. Two entries leading to one screen with nothing to
// tell them apart makes the reader search for the button they just pressed.
//
// In the query rather than a hash: navigation state is route state (§5.3), and
// a query survives the section picker's own links, which rebuild the query.
const links = [
  {
    key: 'report',
    icon: Bug,
    labelKey: 'header.feedback.report',
    action: 'bug',
  },
  {
    key: 'suggest',
    icon: Lightbulb,
    labelKey: 'header.feedback.suggest',
    action: 'idea',
  },
] as const;

const rowClass =
  props.variant === 'menu'
    ? 'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
    : 'flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500';
</script>

<template>
  <div
    class="flex flex-col gap-0.5"
    :class="variant === 'sidebar' ? 'px-2 pb-2' : 'px-2 py-2'"
  >
    <p
      v-if="variant === 'menu'"
      class="px-3 pb-1 text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
    >
      {{ $t('header.feedback.title') }}
    </p>

    <!-- Collapsed, the row is an icon and the tooltip is its only name — the
         same bargain the version badge above it already makes (#268). -->
    <Tooltip
      v-for="link in links"
      :key="link.key"
      display="contents"
      placement="right"
      size="sm"
      :text="collapsed && variant === 'sidebar' ? $t(link.labelKey) : ''"
    >
      <RouterLink
        :to="{ path: ABOUT_PATH, query: { action: link.action } }"
        :class="[
          rowClass,
          collapsed && variant === 'sidebar' ? 'justify-center px-0' : '',
        ]"
        :aria-label="
          collapsed && variant === 'sidebar' ? $t(link.labelKey) : undefined
        "
      >
        <component
          :is="link.icon"
          class="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <span
          v-if="!(collapsed && variant === 'sidebar')"
          class="whitespace-nowrap"
        >
          {{ $t(link.labelKey) }}
        </span>
      </RouterLink>
    </Tooltip>
  </div>
</template>
