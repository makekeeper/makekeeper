<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Select,
  Spinner,
  Switch,
  useToastStore,
} from '@makekeeper/frontend-core';
import SectionShell from './SectionShell.vue';
import { useUpdateStore } from './update-store';

// The daily version check and when it runs (#267). An admin who came to press
// "update" used to scroll past this; it is a schedule, not an action.
const { t } = useI18n();
const toast = useToastStore();
const store = useUpdateStore();

const hourOptions = computed(() =>
  Array.from({ length: 24 }, (_, h) => ({
    value: h,
    label: `${String(h).padStart(2, '0')}:00`,
  })),
);

const savedToast = (ok: boolean): void => {
  toast[ok ? 'success' : 'error'](
    t(
      ok ? 'settings.updates.toast.saved' : 'settings.updates.toast.saveFailed',
    ),
  );
};

async function onToggleAuto(value: boolean): Promise<void> {
  savedToast(await store.save({ autoCheckEnabled: value }));
}

async function onChangeHour(value: number): Promise<void> {
  savedToast(await store.save({ checkHourUtc: value }));
}
</script>

<template>
  <SectionShell
    :title="$t('settings.updates.sections.auto.title')"
    :description="$t('settings.updates.sections.auto.description')"
  >
    <div v-if="store.loading && !store.state" class="flex justify-center py-12">
      <Spinner />
    </div>

    <div v-else-if="store.state" class="glass-card rounded-2xl p-6 space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-medium text-slate-900 dark:text-slate-100">
            {{ $t('settings.updates.auto.title') }}
          </p>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {{ $t('settings.updates.auto.hint') }}
          </p>
        </div>
        <Switch
          :model-value="store.state.autoCheckEnabled"
          @update:model-value="onToggleAuto"
        />
      </div>

      <div
        v-if="store.state.autoCheckEnabled"
        class="flex items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-700"
      >
        <label
          for="update-hour"
          class="text-sm text-slate-700 dark:text-slate-300"
        >
          {{ $t('settings.updates.auto.hour') }}
        </label>
        <div class="w-32">
          <Select
            id="update-hour"
            :model-value="store.state.checkHourUtc"
            :options="hourOptions"
            @update:model-value="onChangeHour"
          />
        </div>
      </div>
    </div>

    <p
      v-else
      class="glass-card rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('settings.updates.loadError') }}
    </p>
  </SectionShell>
</template>
