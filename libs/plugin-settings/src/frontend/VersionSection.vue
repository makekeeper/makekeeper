<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Badge,
  Button,
  Spinner,
  useToastStore,
} from '@makekeeper/frontend-core';
import { RefreshCw } from '@lucide/vue';
import SectionShell from './SectionShell.vue';
import { useUpdateStore } from './update-store';

// What version is installed and whether anything newer exists (#267). The
// fetch itself belongs to the view — the picker's badge has to be right on a
// page opened at any section — so this pane only reads the store and offers
// the one action that is its own: check again, now.
const { t } = useI18n();
const toast = useToastStore();
const store = useUpdateStore();

const lastCheckedLabel = computed<string>(() => {
  const iso = store.state?.lastCheckedAt;
  if (!iso) return t('settings.updates.neverChecked');
  return new Date(iso).toLocaleString();
});

async function onCheck(): Promise<void> {
  const result = await store.checkNow();
  if (!result || result.lastCheckStatus === 'unreachable') {
    toast.error(t('settings.updates.toast.checkFailed'));
    return;
  }
  if (result.updateAvailable) {
    toast.success(
      t('settings.updates.toast.updateFound', {
        version: result.latestVersion,
      }),
    );
  } else {
    toast.success(t('settings.updates.toast.upToDate'));
  }
}
</script>

<template>
  <SectionShell
    :title="$t('settings.updates.sections.version.title')"
    :description="$t('settings.updates.sections.version.description')"
  >
    <template #actions>
      <Button
        variant="secondary"
        :icon-left="RefreshCw"
        :loading="store.checking"
        @click="onCheck"
      >
        {{ $t('settings.updates.checkNow') }}
      </Button>
    </template>

    <div v-if="store.loading && !store.state" class="flex justify-center py-12">
      <Spinner />
    </div>

    <div v-else-if="store.state" class="glass-card rounded-2xl p-6 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p
            class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {{ $t('settings.updates.currentVersion') }}
          </p>
          <p
            class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            {{ store.state.currentVersion }}
          </p>
        </div>
        <Badge v-if="store.state.updateAvailable" tone="warning">
          {{ $t('settings.updates.updateAvailable') }}
        </Badge>
        <Badge v-else-if="store.state.lastCheckStatus === 'ok'" tone="success">
          {{ $t('settings.updates.upToDate') }}
        </Badge>
      </div>

      <!-- Update-available highlight -->
      <div
        v-if="store.state.updateAvailable"
        class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
      >
        {{
          $t('settings.updates.newVersion', {
            version: store.state.latestVersion,
          })
        }}
        <a
          v-if="store.state.releaseUrl"
          :href="store.state.releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-1 font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
        >
          {{ $t('settings.updates.viewRelease') }}
        </a>
      </div>

      <p class="text-sm text-slate-500 dark:text-slate-400">
        <span v-if="store.state.lastCheckStatus === 'unreachable'">
          {{ $t('settings.updates.unreachable') }}
        </span>
        <span v-else>
          {{ $t('settings.updates.lastChecked', { time: lastCheckedLabel }) }}
        </span>
      </p>
    </div>

    <p
      v-else
      class="glass-card rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('settings.updates.loadError') }}
    </p>
  </SectionShell>
</template>
