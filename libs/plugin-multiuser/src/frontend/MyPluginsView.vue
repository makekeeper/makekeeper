<script setup lang="ts">
import { onMounted, ref, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  PageHeader,
  resolvePluginIcon,
  Spinner,
  Switch,
  apiJson,
  usePluginsStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { MyPluginState, PluginPublic } from '@makekeeper/plugin-contract';
import { Blocks } from '@lucide/vue';

// The caller's PERSONAL plugin set — affects only this account, never the
// instance (that lives on the admin's Plugins page). Own page on purpose: the
// two switch sets look identical and were confusing side by side.
const { t } = useI18n();
const toast = useToastStore();
const store = usePluginsStore();

const myPlugins = ref<MyPluginState[]>([]);
const loading = ref(true);

const meta = (pluginId: string): PluginPublic | undefined =>
  store.plugins.find((p) => p.id === pluginId);
const resolveIcon = (pluginId: string): Component =>
  resolvePluginIcon(meta(pluginId)?.icon);
const nameKey = (pluginId: string): string =>
  meta(pluginId)?.nameKey ?? pluginId;

onMounted(async () => {
  try {
    myPlugins.value = await apiJson<MyPluginState[]>(
      '/api/multiuser/my-plugins',
    );
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.plugins.loadError')));
  } finally {
    loading.value = false;
  }
});

const toggle = async (pluginId: string, next: boolean): Promise<void> => {
  const entry = myPlugins.value.find((p) => p.pluginId === pluginId);
  const previous = entry?.isEnabled;
  if (entry) entry.isEnabled = next;
  try {
    await apiJson(`/api/multiuser/my-plugins/${pluginId}`, {
      method: 'PATCH',
      body: { isEnabled: next },
    });
    // Effective states changed for this user — refresh sidebar/routes.
    await store.fetchPlugins();
  } catch (err) {
    if (entry && previous !== undefined) entry.isEnabled = previous;
    toast.error(apiErrorMessage(err, t('multiuser.plugins.saveError')));
  }
};
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('multiuser.plugins.mySection')"
      :subtitle="$t('multiuser.plugins.mySectionHint')"
      :icon="Blocks"
    />

    <div v-if="loading" class="flex justify-center py-16">
      <Spinner :label="$t('common.loading')" />
    </div>

    <div
      v-else
      class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
    >
      <div
        v-for="state in myPlugins"
        :key="state.pluginId"
        class="flex items-center gap-4 px-5 py-4"
      >
        <span
          class="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
        >
          <component :is="resolveIcon(state.pluginId)" class="w-5 h-5" />
        </span>
        <div class="min-w-0 flex-1">
          <span class="text-sm font-bold text-slate-900 dark:text-white">
            {{ $t(nameKey(state.pluginId)) }}
          </span>
          <p
            v-if="!meta(state.pluginId)?.instanceEnabled"
            class="text-xs text-slate-500 dark:text-slate-400"
          >
            {{ $t('multiuser.plugins.instanceDisabled') }}
          </p>
        </div>
        <Switch
          :model-value="state.isEnabled"
          :aria-label="$t(nameKey(state.pluginId))"
          @update:model-value="(v: boolean) => toggle(state.pluginId, v)"
        />
      </div>
    </div>
  </div>
</template>
