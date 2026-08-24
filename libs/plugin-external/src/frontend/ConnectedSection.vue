<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { Blocks } from '@lucide/vue';
import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Spinner,
} from '@makekeeper/frontend-core';
import { useExternalAdmin, type AdminPlugin } from './external-admin';
import SectionShell from './SectionShell.vue';
import PluginCard from './PluginCard.vue';

// The plugins that are already in: their state, their consents and their own
// settings screens.
const { t } = useI18n();
const admin = useExternalAdmin();

// The way to the Connect section arrives as a route, not as an event: the
// picker navigates with links, and a second mechanism for the same piece of
// state is how the two drift apart.
defineProps<{ connectTo: RouteLocationRaw }>();

// Uninstall uses a Modal, not `useConfirm`: it carries the purge choice.
const uninstallTarget = ref<AdminPlugin | null>(null);
const purgeChecked = ref(false);

const openUninstall = (plugin: AdminPlugin): void => {
  uninstallTarget.value = plugin;
  purgeChecked.value = false;
};

const doUninstall = async (): Promise<void> => {
  const target = uninstallTarget.value;
  if (!target) return;
  uninstallTarget.value = null;
  await admin.uninstall(target, purgeChecked.value);
};
</script>

<template>
  <SectionShell
    :title="t('external.sections.connected.title')"
    :description="t('external.sections.connected.description')"
  >
    <div v-if="admin.loading.value" class="flex justify-center py-12">
      <Spinner />
    </div>

    <EmptyState
      v-else-if="admin.connected.value.length === 0"
      :icon="Blocks"
      :title="t('external.emptyTitle')"
      :description="t('external.empty')"
    >
      <template #action>
        <Button :to="connectTo">
          {{ t('external.sections.connect.title') }}
        </Button>
      </template>
    </EmptyState>

    <div v-else class="grid gap-4">
      <PluginCard
        v-for="p in admin.connected.value"
        :key="p.pluginId"
        :plugin="p"
        @uninstall="openUninstall"
      />
    </div>

    <!-- Uninstall with the optional purge choice -->
    <Modal
      :model-value="uninstallTarget !== null"
      :title="t('external.actions.uninstall')"
      @update:model-value="uninstallTarget = null"
    >
      <p
        v-if="uninstallTarget"
        class="text-sm text-slate-600 dark:text-slate-300"
      >
        {{
          t('external.confirm.uninstall', {
            name: admin.pluginName(uninstallTarget.manifest),
          })
        }}
      </p>
      <label
        v-if="uninstallTarget?.manifest.purgeHook"
        class="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
      >
        <Checkbox
          v-model="purgeChecked"
          :aria-label="t('external.confirm.purgeOption')"
        />
        {{ t('external.confirm.purgeOption') }}
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="secondary" @click="uninstallTarget = null">
          {{ t('common.cancel') }}
        </Button>
        <Button variant="danger" @click="doUninstall">
          {{ t('external.actions.uninstall') }}
        </Button>
      </div>
    </Modal>
  </SectionShell>
</template>
