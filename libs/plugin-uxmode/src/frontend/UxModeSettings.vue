<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  getConfigurableFeatures,
  resolvePluginIcon,
  usePluginsStore,
  usePreferencesStore,
  Switch,
  Button,
  Badge,
  type RegisteredUxFeature,
} from '@makekeeper/frontend-core';
import { ChevronDown, Search, SlidersHorizontal } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

// The UX-mode settings panel, hosted by the Settings plugin like any other
// plugin panel: the Simple/Pro switch plus one toggle per feature the plugins
// declare in their manifests. Each toggle answers ONE question — "is this
// feature visible while the interface is in simple mode?" — and starts on the
// manifest's declared default, so the shipped split is initial settings only:
// the user can pull any feature into simple mode or push it out (#269).
//
// The list crossed 40 rows once the dashboard joined the lens, so it is filed
// by owning plugin into collapsed groups with a "shown of total" count, over a
// search box. Collapsed BY DEFAULT (unlike Settings → Plugins, whose two groups
// fit on screen): nine groups open at once is the wall of switches this
// grouping exists to remove.
const pluginsStore = usePluginsStore();
const prefs = usePreferencesStore();
const { t } = useI18n();

const isAdvancedMode = computed<boolean>({
  get: () => prefs.uxMode === 'advanced',
  set: (value) => prefs.setMode(value ? 'advanced' : 'simple'),
});

// The toggle's value is the feature's EFFECTIVE simple-mode visibility:
// the user's override when one exists, the manifest default otherwise. Not
// `isFeatureVisible` — that answers for the current mode (always true in pro),
// while this panel configures the simple tier from either mode.
const isVisibleInSimple = (feature: RegisteredUxFeature): boolean =>
  prefs.featureOverrides[feature.key] ?? feature.defaultAdvanced === false;

// Flipping back to the manifest default clears the override instead of storing
// it, so localStorage holds only actual deviations and a later default change
// in a manifest reaches every user who didn't deliberately diverge.
const setFeature = (feature: RegisteredUxFeature, value: boolean): void => {
  const isDefault = value === (feature.defaultAdvanced === false);
  prefs.setFeatureOverride(feature.key, isDefault ? null : value);
};

const search = ref('');

interface FeatureGroup {
  pluginId: string;
  nameKey: string;
  icon: Component;
  features: RegisteredUxFeature[];
  shown: number;
}

// Matching is on what the user can actually read: the feature's label and its
// plugin's name. Not the key — `inventory.extraFields` is our vocabulary.
const matches = (feature: RegisteredUxFeature, query: string): boolean =>
  `${t(feature.labelKey)} ${t(feature.nameKey)}`.toLowerCase().includes(query);

const groups = computed<FeatureGroup[]>(() => {
  const query = search.value.trim().toLowerCase();
  const byPlugin = new Map<string, FeatureGroup>();
  for (const feature of getConfigurableFeatures()) {
    // A disabled plugin's surfaces are already gone; a switch for them would
    // promise something the toggle cannot deliver.
    if (!pluginsStore.isEnabled(feature.pluginId)) continue;
    if (query && !matches(feature, query)) continue;
    const group = byPlugin.get(feature.pluginId) ?? {
      pluginId: feature.pluginId,
      nameKey: feature.nameKey,
      icon: resolvePluginIcon(
        pluginsStore.plugins.find((p) => p.id === feature.pluginId)?.icon ?? '',
      ),
      features: [],
      shown: 0,
    };
    group.features.push(feature);
    if (isVisibleInSimple(feature)) group.shown += 1;
    byPlugin.set(feature.pluginId, group);
  }
  return [...byPlugin.values()];
});

const hasOverrides = computed<boolean>(
  () => Object.keys(prefs.featureOverrides).length > 0,
);

// Collapsed state per group, persisted like the other collapsible sections.
// Stored as the OPEN set, because the default here is closed.
const OPEN_STORAGE_KEY = 'uxmode:openGroups';

const loadOpen = (): string[] => {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
};

const openGroups = ref<string[]>(loadOpen());

// A search hit that stayed hidden inside a collapsed group would read as "no
// results", so a live query opens every group it matched.
const isOpen = (pluginId: string): boolean =>
  search.value.trim() !== '' || openGroups.value.includes(pluginId);

const toggleGroup = (pluginId: string): void => {
  openGroups.value = openGroups.value.includes(pluginId)
    ? openGroups.value.filter((id) => id !== pluginId)
    : [...openGroups.value, pluginId];
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify(openGroups.value));
  } catch (error) {
    console.error('Error persisting open groups:', error);
  }
};

// Whole-group shortcut. Applies to the rows the group currently SHOWS, so
// during a search it moves exactly what is on screen and nothing hidden.
const setGroup = (group: FeatureGroup, value: boolean): void => {
  for (const feature of group.features) setFeature(feature, value);
};
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <label
          for="ux-mode-switch"
          class="text-sm font-semibold text-slate-900 dark:text-white"
        >
          {{ $t('uxmode.settings.advancedLabel') }}
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('uxmode.settings.advancedHint') }}
        </p>
      </div>
      <Switch
        id="ux-mode-switch"
        v-model="isAdvancedMode"
        :aria-label="$t('uxmode.settings.advancedLabel')"
      />
    </div>

    <!-- The whole division, configurable from either mode; the toggles take
         visible effect while the interface is simple (pro shows everything). -->
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
          {{ $t('uxmode.settings.featuresHint') }}
        </p>
        <Button
          v-if="hasOverrides"
          variant="ghost"
          size="sm"
          @click="prefs.clearFeatureOverrides()"
        >
          {{ $t('uxmode.settings.resetOverrides') }}
        </Button>
      </div>

      <div class="relative">
        <Search
          class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none"
        />
        <input
          v-model="search"
          type="search"
          :placeholder="$t('uxmode.settings.searchPlaceholder')"
          :aria-label="$t('uxmode.settings.searchPlaceholder')"
          class="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-sm"
        />
      </div>

      <div v-for="group in groups" :key="group.pluginId" class="space-y-2">
        <div class="flex items-center gap-2">
          <h4 class="flex-1 min-w-0 text-sm font-bold">
            <button
              type="button"
              :aria-expanded="isOpen(group.pluginId)"
              :aria-controls="`ux-group-${group.pluginId}`"
              class="w-full flex items-center gap-3 text-left rounded-xl transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02] -mx-2 px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              @click="toggleGroup(group.pluginId)"
            >
              <span
                class="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
              >
                <component :is="group.icon" class="w-5 h-5" />
              </span>
              <span class="truncate text-slate-900 dark:text-white">
                {{ $t(group.nameKey) }}
              </span>
              <Badge :tone="group.shown > 0 ? 'brand' : 'neutral'">
                {{
                  $t('uxmode.settings.groupCount', {
                    shown: group.shown,
                    total: group.features.length,
                  })
                }}
              </Badge>
              <ChevronDown
                class="w-4 h-4 ml-auto text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0"
                :class="{ '-rotate-90': !isOpen(group.pluginId) }"
              />
            </button>
          </h4>
          <!-- Siblings of the collapse button, never nested inside it: a
               button within a button is invalid and unreachable by keyboard. -->
          <Button
            variant="ghost"
            size="sm"
            :aria-label="
              $t('uxmode.settings.groupAllAria', { plugin: $t(group.nameKey) })
            "
            @click="setGroup(group, true)"
          >
            {{ $t('uxmode.settings.groupAll') }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :aria-label="
              $t('uxmode.settings.groupNoneAria', { plugin: $t(group.nameKey) })
            "
            @click="setGroup(group, false)"
          >
            {{ $t('uxmode.settings.groupNone') }}
          </Button>
        </div>

        <div
          v-show="isOpen(group.pluginId)"
          :id="`ux-group-${group.pluginId}`"
          class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
        >
          <div
            v-for="feature in group.features"
            :key="feature.key"
            class="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span class="text-sm text-slate-700 dark:text-slate-300">
              {{ $t(feature.labelKey) }}
            </span>
            <Switch
              :model-value="isVisibleInSimple(feature)"
              :aria-label="$t(feature.labelKey)"
              @update:model-value="setFeature(feature, $event)"
            />
          </div>
        </div>
      </div>

      <p
        v-if="groups.length === 0"
        class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4"
      >
        <SlidersHorizontal class="w-4 h-4 shrink-0" />
        {{ $t('uxmode.settings.noMatches') }}
      </p>
    </div>
  </div>
</template>
