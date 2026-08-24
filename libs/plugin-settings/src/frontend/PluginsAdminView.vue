<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import {
  getFrontendPlugin,
  resolvePluginIcon as resolveIcon,
  usePluginsStore,
  Switch,
  Badge,
  PageHeader,
} from '@makekeeper/frontend-core';
import type { PluginPublic } from '@makekeeper/plugin-contract';
import { Blocks, Lock, ChevronDown } from '@lucide/vue';

// Admin: enable/disable installed plugins INSTANCE-WIDE, split into two
// collapsible groups — Core (locked, no toggle) and Additional (toggleable).
// Switches bind to `instanceEnabled` (the raw admin toggle), never to the
// caller's effective state — a user's personal set lives on its own page
// (Settings → My plugins, multiuser plugin). Admin-only in multi-user mode
// (nav + route meta); in single-user mode the single user IS the admin.
const store = usePluginsStore();

interface PluginGroup {
  key: 'core' | 'optional';
  titleKey: string;
  icon: Component;
  toggleable: boolean;
  plugins: PluginPublic[];
}

const groups = computed<PluginGroup[]>(() => {
  const core = store.plugins.filter((p) => p.core);
  const optional = store.plugins.filter((p) => !p.core);
  return [
    {
      key: 'core',
      titleKey: 'settings.pluginsAdmin.coreGroup',
      icon: Lock,
      toggleable: false,
      plugins: core,
    },
    {
      key: 'optional',
      titleKey: 'settings.pluginsAdmin.optionalGroup',
      icon: Blocks,
      toggleable: true,
      plugins: optional,
    },
  ].filter((g) => g.plugins.length > 0);
});

// Mode-changing side effects (e.g. multiuser's transition overlay + reload)
// live in the plugins' own frontend lifecycle hooks, invoked by the store.
const toggle = async (pluginId: string, next: boolean): Promise<void> => {
  await store.setEnabled(pluginId, next);
};

// A plugin that declares frontend lifecycle hooks transforms the whole app
// when toggled — its row stays in the shared list but carries an iridescent
// tint echoing its transition effect.
const isModeChanging = (pluginId: string): boolean => {
  const frontend = getFrontendPlugin(pluginId);
  return Boolean(frontend?.onInstanceEnabled || frontend?.onInstanceDisabled);
};

// Collapsed state per group, persisted (mirrors the other collapsible sections).
const COLLAPSED_STORAGE_KEY = 'pluginsAdmin:collapsedGroups';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadCollapsed = (): Record<string, boolean> => {
  const result: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return result;
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'boolean') result[key] = value;
      }
    }
  } catch {
    // ignore malformed storage
  }
  return result;
};

const collapsed = ref<Record<string, boolean>>(loadCollapsed());
const isCollapsed = (key: string): boolean => collapsed.value[key] === true;
const toggleGroup = (key: string): void => {
  collapsed.value = { ...collapsed.value, [key]: !isCollapsed(key) };
  try {
    localStorage.setItem(
      COLLAPSED_STORAGE_KEY,
      JSON.stringify(collapsed.value),
    );
  } catch (error) {
    console.error('Error persisting collapsed groups:', error);
  }
};

onMounted(() => {
  // Refresh in case the state changed elsewhere since bootstrap.
  store.fetchPlugins();
});
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      :title="$t('settings.pluginsAdmin.title')"
      :subtitle="$t('settings.pluginsAdmin.subtitle')"
      :icon="Blocks"
    />

    <!-- One collapsible section per group (Core / Additional) -->
    <div v-for="group in groups" :key="group.key" class="space-y-4">
      <h3 class="text-sm font-bold">
        <button
          type="button"
          :aria-expanded="!isCollapsed(group.key)"
          class="w-full flex items-center gap-3 text-left rounded-xl transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02] -mx-2 px-2 py-2"
          @click="toggleGroup(group.key)"
        >
          <span
            class="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
          >
            <component :is="group.icon" class="w-5 h-5" />
          </span>
          <span class="text-slate-900 dark:text-white">
            {{ $t(group.titleKey) }}
          </span>
          <span
            class="text-xxs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400"
          >
            {{
              $t('settings.pluginsAdmin.count', { count: group.plugins.length })
            }}
          </span>
          <ChevronDown
            class="w-4 h-4 ml-auto text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0"
            :class="{ '-rotate-90': isCollapsed(group.key) }"
          />
        </button>
      </h3>

      <div
        v-show="!isCollapsed(group.key)"
        class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
      >
        <div
          v-for="plugin in group.plugins"
          :key="plugin.id"
          class="flex items-center gap-4 px-5 py-4"
          :class="
            isModeChanging(plugin.id)
              ? 'first:rounded-t-2xl last:rounded-b-2xl bg-gradient-to-r from-brand-500/5 via-fuchsia-500/5 to-cyan-400/5 dark:from-brand-400/10 dark:via-fuchsia-400/10 dark:to-cyan-300/10'
              : ''
          "
        >
          <span
            class="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
            :class="
              isModeChanging(plugin.id)
                ? 'bg-mode-aurora text-white shadow-md'
                : 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
            "
          >
            <component :is="resolveIcon(plugin.icon)" class="w-5 h-5" />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-slate-900 dark:text-white">
                {{ $t(plugin.nameKey) }}
              </span>
              <Badge tone="neutral">
                {{
                  $t('settings.pluginSettings.version', {
                    version: plugin.version,
                  })
                }}
              </Badge>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ $t(plugin.descriptionKey) }}
            </p>
          </div>

          <!-- Toggle switch — only for the toggleable (Additional) group. -->
          <Switch
            v-if="group.toggleable"
            :model-value="plugin.instanceEnabled"
            :aria-label="
              plugin.instanceEnabled
                ? $t('settings.pluginsAdmin.disable')
                : $t('settings.pluginsAdmin.enable')
            "
            @change="(v: boolean) => toggle(plugin.id, v)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
