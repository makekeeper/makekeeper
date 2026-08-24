<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  Modal,
  Button,
  Select,
  apiFetch,
  apiJson,
  buildTreeOptions,
  getErrorMessage,
  useToastStore,
  usePluginsStore,
  useUxMode,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import type { ItemCategoryDto } from '../categories';

// The ONE quick-create surface for inventory components (#53). Replaces the
// divergent inline forms (order-form quick modal, import stub) so every "new
// part" flow asks the same minimal questions: name (required) plus optional
// category, quantity and storage. The full InventoryFormView stays the
// extended editor for everything else (sku, links, custom fields, …).

export interface QuickCreatedComponent {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  quantity: number;
  storageId: string | null;
}

interface StorageOption {
  id: string;
  name: string;
  parentId: string | null;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    // Seeds the name field (e.g. from a search box or an import line).
    initialName?: string;
  }>(),
  { initialName: '' },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created', component: QuickCreatedComponent): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const name = ref('');
const categoryId = ref('');
const categories = ref<ItemCategoryDto[]>([]);

// The categories lens (#269) — the quick form drops its picker together with
// the full form's; `categoryId` stays '' so nothing is silently assigned.
const { isFeatureVisible } = useUxMode();
const showCategories = computed(() => isFeatureVisible('inventory.categories'));

// The same tree the full form shows (#205) — a quick create that flattens the
// vocabulary would have people picking a different category here than there.
const categoryOptions = computed(() => [
  { value: '', label: t('inventory.form.noCategory'), empty: true },
  ...buildTreeOptions(
    categories.value.map((entry) => ({
      value: entry.id,
      label: entry.name,
      parentValue: entry.parentId,
      order: entry.order,
    })),
  ),
]);

// Loaded once the modal opens: a quick create should not pay for a vocabulary
// nobody is going to look at. `immediate` because a parent may mount this
// component already open — without it that instance never gets a picker.
watch(
  () => props.modelValue,
  async (open) => {
    if (!open || categories.value.length) return;
    try {
      categories.value = await apiJson<ItemCategoryDto[]>(
        '/api/item-categories',
      );
    } catch (err) {
      // An empty picker with no explanation reads as "there are no categories".
      categories.value = [];
      toast.error(getErrorMessage(err));
    }
  },
  { immediate: true },
);
const quantity = ref(0);
const storageId = ref('');
const saving = ref(false);

const storages = ref<StorageOption[]>([]);
const storagesLoaded = ref(false);
// The placement picker is storages functionality (#58) — hidden (and never
// fetched) while the storages plugin is disabled.
const pluginsStore = usePluginsStore();
const storagesEnabled = computed(() => pluginsStore.isEnabled('storages'));

const storageOptions = computed(() => [
  { value: '', label: t('inventory.quickCreate.noStorage'), empty: true },
  ...storages.value.map((s) => ({ value: s.id, label: s.name })),
]);

const fetchStorages = async (): Promise<void> => {
  if (!storagesEnabled.value || storagesLoaded.value) return;
  try {
    const res = await apiFetch('/api/storages');
    if (res.ok) {
      storages.value = await res.json();
      storagesLoaded.value = true;
    }
  } catch {
    // Non-critical — the picker just stays empty.
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = props.initialName;
      categoryId.value = '';
      quantity.value = 0;
      storageId.value = '';
      void fetchStorages();
    }
  },
);

const close = (): void => emit('update:modelValue', false);

const save = async (): Promise<void> => {
  if (!name.value.trim() || saving.value) return;
  saving.value = true;
  try {
    const res = await apiFetch('/api/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(),
        ...(categoryId.value ? { categoryId: categoryId.value } : {}),
        ...(quantity.value > 0 ? { quantity: quantity.value } : {}),
        ...(storageId.value ? { storageId: storageId.value } : {}),
      }),
    });
    if (!res.ok) {
      toast.error(t('inventory.quickCreate.error'));
      return;
    }
    const created: QuickCreatedComponent = await res.json();
    toast.success(t('inventory.quickCreate.success', { name: created.name }));
    emit('created', created);
    close();
  } catch {
    toast.error(t('inventory.quickCreate.error'));
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="$t('inventory.quickCreate.title')"
    width="md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="space-y-4" @submit.prevent="save">
      <div>
        <label
          for="quick-comp-name"
          class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
        >
          {{ $t('inventory.quickCreate.name') }}
        </label>
        <input
          id="quick-comp-name"
          v-model="name"
          type="text"
          required
          maxlength="200"
          class="glass-input w-full rounded-xl px-3 py-2 text-sm"
          :placeholder="$t('inventory.quickCreate.namePlaceholder')"
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div v-if="showCategories">
          <label
            for="quick-comp-category"
            class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
          >
            {{ $t('inventory.quickCreate.category') }}
          </label>
          <Select
            id="quick-comp-category"
            v-model="categoryId"
            :options="categoryOptions"
          />
        </div>
        <div>
          <label
            for="quick-comp-qty"
            class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
          >
            {{ $t('inventory.quickCreate.quantity') }}
          </label>
          <input
            id="quick-comp-qty"
            v-model.number="quantity"
            type="number"
            min="0"
            step="any"
            class="glass-input w-full rounded-xl px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div v-if="storagesEnabled">
        <label
          class="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
        >
          {{ $t('inventory.quickCreate.storage') }}
        </label>
        <Select v-model="storageId" :options="storageOptions" />
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="secondary" @click="close">
          {{ $t('inventory.quickCreate.cancel') }}
        </Button>
        <Button type="submit" :loading="saving" :disabled="!name.trim()">
          {{ $t('inventory.quickCreate.create') }}
        </Button>
      </div>
    </form>
  </Modal>
</template>
