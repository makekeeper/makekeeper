<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  Badge,
  Button,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Switch,
  apiJson,
  useConfirm,
  usePluginsStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type {
  GrantPublic,
  GrantResourceRestrictions,
  RestrictionUiDescriptor,
  ScopeAccessLevel,
} from '@makekeeper/plugin-contract';
import { Pencil, Plus, Share2, Trash2 } from '@lucide/vue';

// Owner-side sharing management: who can enter my scope, at what level, with
// which plugins, narrowed to which resources. The restriction sections render
// generically from what the plugins announce (GET /api/multiuser/restrictions).
const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const pluginsStore = usePluginsStore();

const grants = ref<GrantPublic[]>([]);
const restrictions = ref<RestrictionUiDescriptor[]>([]);
const userOptions = ref<{ id: string; label: string }[]>([]);
const loading = ref(true);

// --- Form state (create + edit share one modal) ---
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formGrantee = ref('');
const formAccess = ref<ScopeAccessLevel>('READ');
const formPlugins = ref<Set<string>>(new Set());
const formSelections = ref<Record<string, Set<string>>>({});
const saving = ref(false);

const accessOptions = computed(() => [
  { value: 'READ', label: t('multiuser.sharing.accessRead') },
  { value: 'WRITE', label: t('multiuser.sharing.accessWrite') },
]);

// Plugins that can be exposed inside a shared scope (core + multiuser are
// always available and never part of a grant).
const grantablePlugins = computed(() =>
  pluginsStore.plugins.filter((p) => !p.core && p.id !== 'multiuser'),
);

const granteeOptions = computed(() =>
  userOptions.value.map((u) => ({ value: u.id, label: u.label })),
);

const restrictionKey = (d: RestrictionUiDescriptor): string =>
  `${d.pluginId}:${d.resourceKey}`;

const visibleRestrictions = computed(() =>
  restrictions.value.filter((d) => formPlugins.value.has(d.pluginId)),
);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const [grantsData, restrictionsData, usersData] = await Promise.all([
      apiJson<GrantPublic[]>('/api/multiuser/grants'),
      apiJson<RestrictionUiDescriptor[]>('/api/multiuser/restrictions'),
      apiJson<{ id: string; label: string }[]>('/api/multiuser/users/options'),
    ]);
    grants.value = grantsData;
    restrictions.value = restrictionsData;
    userOptions.value = usersData;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.sharing.loadError')));
  } finally {
    loading.value = false;
  }
};

onMounted(load);

const openCreate = (): void => {
  editingId.value = null;
  formGrantee.value = '';
  formAccess.value = 'READ';
  formPlugins.value = new Set(grantablePlugins.value.map((p) => p.id));
  formSelections.value = {};
  showForm.value = true;
};

const openEdit = (grant: GrantPublic): void => {
  editingId.value = grant.id;
  formGrantee.value = grant.grantee.id;
  formAccess.value = grant.accessLevel;
  formPlugins.value = new Set(grant.allowedPluginIds);
  const selections: Record<string, Set<string>> = {};
  for (const descriptor of restrictions.value) {
    const ids =
      grant.resourceRestrictions[descriptor.pluginId]?.[
        descriptor.resourceKey
      ] ?? [];
    selections[restrictionKey(descriptor)] = new Set(ids);
  }
  formSelections.value = selections;
  showForm.value = true;
};

const togglePlugin = (pluginId: string, next: boolean): void => {
  const set = new Set(formPlugins.value);
  if (next) set.add(pluginId);
  else set.delete(pluginId);
  formPlugins.value = set;
};

const toggleResource = (key: string, id: string): void => {
  const set = new Set(formSelections.value[key] ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  formSelections.value = { ...formSelections.value, [key]: set };
};

const isResourcePicked = (key: string, id: string): boolean =>
  formSelections.value[key]?.has(id) === true;

const buildRestrictionsPayload = (): GrantResourceRestrictions => {
  const payload: GrantResourceRestrictions = {};
  for (const descriptor of visibleRestrictions.value) {
    const picked = formSelections.value[restrictionKey(descriptor)];
    if (!picked || picked.size === 0) continue;
    const byResource = payload[descriptor.pluginId] ?? {};
    byResource[descriptor.resourceKey] = Array.from(picked);
    payload[descriptor.pluginId] = byResource;
  }
  return payload;
};

const save = async (): Promise<void> => {
  saving.value = true;
  try {
    const body = {
      accessLevel: formAccess.value,
      allowedPluginIds: Array.from(formPlugins.value),
      resourceRestrictions: buildRestrictionsPayload(),
    };
    if (editingId.value) {
      await apiJson(`/api/multiuser/grants/${editingId.value}`, {
        method: 'PATCH',
        body,
      });
    } else {
      await apiJson('/api/multiuser/grants', {
        method: 'POST',
        body: { ...body, granteeUserId: formGrantee.value },
      });
    }
    toast.success(t('multiuser.sharing.saved'));
    showForm.value = false;
    await load();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.sharing.saveError')));
  } finally {
    saving.value = false;
  }
};

const remove = async (grant: GrantPublic): Promise<void> => {
  const ok = await confirm({
    message: t('multiuser.sharing.deleteConfirm', {
      name: grant.grantee.displayName ?? grant.grantee.username,
    }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await apiJson(`/api/multiuser/grants/${grant.id}`, { method: 'DELETE' });
    toast.success(t('multiuser.sharing.deleted'));
    await load();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.sharing.saveError')));
  }
};

const pluginName = (pluginId: string): string => {
  const plugin = pluginsStore.byId[pluginId];
  return plugin ? t(plugin.nameKey) : pluginId;
};

const restrictionSummary = (grant: GrantPublic): number =>
  Object.values(grant.resourceRestrictions).reduce(
    (total, byResource) =>
      total + Object.values(byResource).reduce((n, ids) => n + ids.length, 0),
    0,
  );
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('multiuser.sharing.title')"
      :subtitle="$t('multiuser.sharing.subtitle')"
      :icon="Share2"
    >
      <template #actions>
        <Button :icon-left="Plus" @click="openCreate">
          {{ $t('multiuser.sharing.add') }}
        </Button>
      </template>
    </PageHeader>

    <div v-if="loading" class="flex justify-center py-16">
      <Spinner :label="$t('common.loading')" />
    </div>

    <p
      v-else-if="grants.length === 0"
      class="glass-card rounded-2xl px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
    >
      {{ $t('multiuser.sharing.empty') }}
    </p>

    <div
      v-else
      class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
    >
      <div
        v-for="grant in grants"
        :key="grant.id"
        class="flex items-center gap-4 px-5 py-4"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-slate-900 dark:text-white">
              {{ grant.grantee.displayName ?? grant.grantee.username }}
            </span>
            <Badge
              :tone="grant.accessLevel === 'WRITE' ? 'success' : 'warning'"
            >
              {{
                grant.accessLevel === 'WRITE'
                  ? $t('multiuser.sharing.accessWrite')
                  : $t('multiuser.sharing.accessRead')
              }}
            </Badge>
            <Badge v-if="restrictionSummary(grant) > 0" tone="neutral">
              {{
                $t('multiuser.sharing.restricted', {
                  count: restrictionSummary(grant),
                })
              }}
            </Badge>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
            {{
              grant.allowedPluginIds.length
                ? grant.allowedPluginIds.map(pluginName).join(', ')
                : $t('multiuser.sharing.noPlugins')
            }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          :icon-left="Pencil"
          :aria-label="$t('multiuser.sharing.edit')"
          @click="openEdit(grant)"
        />
        <Button
          variant="danger"
          size="sm"
          :icon-left="Trash2"
          :aria-label="$t('multiuser.sharing.delete')"
          @click="remove(grant)"
        />
      </div>
    </div>

    <!-- Create / edit modal -->
    <Modal
      v-model="showForm"
      :title="
        editingId
          ? $t('multiuser.sharing.editTitle')
          : $t('multiuser.sharing.createTitle')
      "
      width="lg"
    >
      <form class="space-y-5" @submit.prevent="save">
        <div v-if="!editingId" class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.sharing.grantee') }}
          </label>
          <Select
            v-model="formGrantee"
            :options="granteeOptions"
            :placeholder="$t('multiuser.sharing.granteePlaceholder')"
            required
          />
        </div>

        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.sharing.accessLevel') }}
          </label>
          <Select v-model="formAccess" :options="accessOptions" />
        </div>

        <div class="space-y-2">
          <p class="text-xs font-bold text-slate-700 dark:text-slate-300">
            {{ $t('multiuser.sharing.allowedPlugins') }}
          </p>
          <div
            class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
          >
            <div
              v-for="plugin in grantablePlugins"
              :key="plugin.id"
              class="flex items-center justify-between px-4 py-2.5"
            >
              <span class="text-sm text-slate-700 dark:text-slate-200">
                {{ $t(plugin.nameKey) }}
              </span>
              <Switch
                :model-value="formPlugins.has(plugin.id)"
                :aria-label="$t(plugin.nameKey)"
                @update:model-value="(v: boolean) => togglePlugin(plugin.id, v)"
              />
            </div>
          </div>
        </div>

        <!-- Plugin-announced restriction sections; empty selection = no limit -->
        <div
          v-for="descriptor in visibleRestrictions"
          :key="restrictionKey(descriptor)"
          class="space-y-2"
        >
          <p class="text-xs font-bold text-slate-700 dark:text-slate-300">
            {{ $t(descriptor.labelKey) }}
          </p>
          <p class="text-xxs text-slate-500 dark:text-slate-400">
            {{ $t('multiuser.sharing.restrictionHint') }}
          </p>
          <div
            class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5 max-h-48 overflow-y-auto"
          >
            <label
              v-for="option in descriptor.options"
              :key="option.id"
              class="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
            >
              <input
                type="checkbox"
                class="w-4 h-4 rounded accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :checked="
                  isResourcePicked(restrictionKey(descriptor), option.id)
                "
                @change="toggleResource(restrictionKey(descriptor), option.id)"
              />
              <span class="truncate">{{ option.label }}</span>
            </label>
            <p
              v-if="descriptor.options.length === 0"
              class="px-4 py-3 text-xs text-slate-500 dark:text-slate-400"
            >
              {{ $t('multiuser.sharing.noOptions') }}
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" @click="showForm = false">
            {{ $t('common.cancel') }}
          </Button>
          <Button
            type="submit"
            :loading="saving"
            :disabled="!editingId && !formGrantee"
          >
            {{ $t('multiuser.sharing.save') }}
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
