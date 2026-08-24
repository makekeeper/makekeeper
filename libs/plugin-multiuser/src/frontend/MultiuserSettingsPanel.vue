<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  Switch,
  apiJson,
  onReactivated,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { MultiuserSettingsPublic } from '@makekeeper/plugin-contract';

// Admin panel of the multiuser overlay itself (rendered by the Settings host;
// the manifest marks it settingsAdminOnly, so regular users never see it).
const { t } = useI18n();
const toast = useToastStore();

const settings = ref<MultiuserSettingsPublic | null>(null);

const load = async (): Promise<void> => {
  try {
    settings.value = await apiJson<MultiuserSettingsPublic>(
      '/api/multiuser/settings',
    );
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.settings.loadError')));
  }
};

onMounted(load);
// Settings keeps its panes alive (#266): without this the overlay's own state
// would be as old as the first time this section was opened, and it is
// administered from more than one place.
onReactivated(() => {
  void load();
});

const patch = async (body: Partial<MultiuserSettingsPublic>): Promise<void> => {
  if (!settings.value) return;
  const previous = { ...settings.value };
  Object.assign(settings.value, body);
  try {
    settings.value = await apiJson<MultiuserSettingsPublic>(
      '/api/multiuser/settings',
      { method: 'PATCH', body },
    );
    toast.success(t('multiuser.settings.saved'));
  } catch (err) {
    settings.value = previous;
    toast.error(apiErrorMessage(err, t('multiuser.settings.saveError')));
  }
};

const toggleRegistration = (next: boolean): Promise<void> =>
  patch({ allowRegistration: next });
</script>

<template>
  <div v-if="settings" class="space-y-4">
    <div class="flex items-center gap-4">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-bold text-slate-900 dark:text-white">
          {{ $t('multiuser.settings.allowRegistration') }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('multiuser.settings.allowRegistrationHint') }}
        </p>
      </div>
      <Switch
        :model-value="settings.allowRegistration"
        :aria-label="$t('multiuser.settings.allowRegistration')"
        @update:model-value="toggleRegistration"
      />
    </div>
  </div>
</template>
