<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChartColumn, ChevronDown, LayoutDashboard } from '@lucide/vue';
import {
  EmptyState,
  getPluginDashboardWidgets,
  resolvePluginIcon,
  usePluginsStore,
  usePreferencesStore,
  type RegisteredDashboardWidget,
} from '@makekeeper/frontend-core';

// The dashboard is a pure host: every block is published by a plugin through the
// manifest's `dashboardWidgets` declaration (see docs/plugins.md). The host only
// lays things out by declared placement — `hero` widgets on top (the bench, #90;
// it carries its own ribbon, verb strip and project charts), then EVERYTHING
// else (stat tiles + the remaining panels) folded into the collapsible Insights
// section — filtering by the owning plugin's enabled state and the
// simple/advanced UX mode, exactly like the sidebar.
const { t } = useI18n();
const pluginsStore = usePluginsStore();
const prefs = usePreferencesStore();

const enabledWidgets = computed<RegisteredDashboardWidget[]>(() =>
  getPluginDashboardWidgets().filter((w) => pluginsStore.isEnabled(w.pluginId)),
);

const visibleWidgets = computed<RegisteredDashboardWidget[]>(() =>
  enabledWidgets.value.filter(
    // An `advanced` widget follows the per-feature rule keyed by its own
    // widget key — same machinery as stats charts, so the user's simple/pro
    // override applies here too (#269).
    (w) => w.advanced !== true || prefs.isFeatureVisible(w.key),
  ),
);

// "Your plugins publish blocks, the interface mode is hiding them" — a
// different problem from "no plugin publishes anything", and a different fix.
// Pointing at Settings → Plugins in this case sends the user to a screen where
// everything is already switched on.
const hiddenByLens = computed<boolean>(
  () => enabledWidgets.value.length > visibleWidgets.value.length,
);

const heroWidgets = computed<RegisteredDashboardWidget[]>(() =>
  visibleWidgets.value.filter((w) => w.size === 'hero'),
);

const statWidgets = computed<RegisteredDashboardWidget[]>(() =>
  visibleWidgets.value.filter((w) => w.size === 'stat'),
);

// Every panel/full widget lives in the Insights drawer.
const insightWidgets = computed<RegisteredDashboardWidget[]>(() =>
  visibleWidgets.value.filter(
    (w) => w.size !== 'hero' && (w.size ?? 'panel') !== 'stat',
  ),
);

// Charts stay collapsed by default — the bench is what you opened the app for.
const insightsOpen = ref(false);
</script>

<template>
  <div class="space-y-8">
    <!-- Hero widgets (the bench): full-width, own chrome, pinned to the top. -->
    <component
      :is="widget.component"
      v-for="widget in heroWidgets"
      :key="widget.key"
    />

    <!-- Insights: the remaining plugin charts, collapsed. Styled after the
         Settings plugin's group pattern (icon chip + title/subtitle + rotating
         chevron, body in v-show). -->
    <div v-if="statWidgets.length || insightWidgets.length" class="space-y-4">
      <h3 class="text-sm font-bold">
        <button
          type="button"
          :aria-expanded="insightsOpen"
          class="w-full flex items-center gap-3 text-left rounded-xl transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02] -mx-2 px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          @click="insightsOpen = !insightsOpen"
        >
          <span
            class="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
          >
            <ChartColumn class="w-5 h-5" />
          </span>
          <span class="flex flex-col min-w-0">
            <span class="text-slate-900 dark:text-white">
              {{ t('dashboard.insights.title') }}
            </span>
            <span
              class="text-xxs font-normal text-slate-500 dark:text-slate-400 truncate"
            >
              {{ t('dashboard.insights.subtitle') }}
            </span>
          </span>
          <ChevronDown
            class="w-4 h-4 ml-auto text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0"
            :class="{ '-rotate-90': !insightsOpen }"
          />
        </button>
      </h3>

      <div v-show="insightsOpen" class="space-y-8">
        <!-- Stat tiles: the ribbon carries the bench's own aggregates, so these
             plugin-published tiles live here rather than in a top row. -->
        <div
          v-if="statWidgets.length"
          class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6"
        >
          <component
            :is="widget.component"
            v-for="widget in statWidgets"
            :key="widget.key"
          />
        </div>

        <div
          v-if="insightWidgets.length"
          class="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          <section
            v-for="widget in insightWidgets"
            :key="widget.key"
            class="flex flex-col gap-3"
            :class="{ 'lg:col-span-2': widget.size === 'full' }"
          >
            <h4
              class="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
            >
              <component
                :is="resolvePluginIcon(widget.icon)"
                class="w-4 h-4 text-brand-500 dark:text-brand-400"
              />
              {{ t(widget.titleKey) }}
            </h4>
            <component :is="widget.component" class="flex-1" />
          </section>
        </div>
      </div>
    </div>

    <!-- Every publishing plugin is disabled (or nothing publishes yet) — or
         they publish and the simple/pro lens hides all of it. -->
    <div v-if="!visibleWidgets.length" class="glass-card rounded-2xl">
      <EmptyState
        :title="t('dashboard.emptyTitle')"
        :description="
          hiddenByLens ? t('dashboard.emptyLensHint') : t('dashboard.emptyHint')
        "
        :icon="LayoutDashboard"
      />
    </div>
  </div>
</template>
