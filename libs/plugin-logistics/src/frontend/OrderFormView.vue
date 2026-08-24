<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Select,
  Button,
  Spinner,
  Modal,
  useToastStore,
  apiFetch,
  useUxMode,
  usePluginsStore,
  PluginSlot,
  useSlotContributions,
} from '@makekeeper/frontend-core';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Plus, Trash2, Save, Truck, ShoppingBag } from '@lucide/vue';
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const toast = useToastStore();
// Simple/advanced UX lens (#53) — hides advanced inputs; hidden fields keep
// their loaded values so saving in simple mode never clobbers data.
const { isFeatureVisible } = useUxMode();
const showTracking = computed(() => isFeatureVisible('logistics.tracking'));
const showSuppliers = computed(() => isFeatureVisible('logistics.suppliers'));
const showOrderExtras = computed(() =>
  isFeatureVisible('logistics.orderExtras'),
);
// "Save as draft" writes the CART status — the draft half of the full
// lifecycle. With full statuses hidden the list can neither show nor leave
// that status, so offering the button there strands the order (#269).
const showFullStatuses = computed(() =>
  isFeatureVisible('logistics.fullStatuses'),
);

// Frontend-local copy of the order lifecycle (the backend union lives behind the
// backend alias, which the SPA must not import across the NX boundary).
type OrderStatus = 'CART' | 'ORDERED' | 'SHIPPED' | 'DELIVERED';

// Same view backs "new" and "edit" — an :id param switches it to edit mode.
const isEdit = computed(() => typeof route.params.id === 'string');
const orderStatus = ref<OrderStatus>('ORDERED');

// Canonical ORef of the edited order, for the tag chips slot.
const orderTagRef = computed<string>(() =>
  typeof route.params.id === 'string'
    ? (formatObjectRef({
        pluginId: 'logistics',
        entityType: 'order',
        entityId: route.params.id,
      }) ?? '')
    : '',
);

// Prefill order rows from a `?items=[{componentId,quantity}]` query — used by the
// inventory restock list to seed a shopping order with the shortfall (#32 D3).
// Prices are filled from the loaded components; the user still picks the store.
const prefillItemsFromQuery = (): boolean => {
  const raw = route.query.items;
  if (typeof raw !== 'string') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) return false;
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;
  const rows = parsed.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const componentId = String(entry.componentId ?? '');
    if (!componentId) return [];
    const quantity = Number(entry.quantity) || 1;
    const comp = componentsList.value.find((c) => c.id === componentId);
    return [{ componentId, quantity, unitPrice: comp?.lastPrice || 0 }];
  });
  if (!rows.length) return false;
  newOrderItems.value = rows;
  recalcTotalCost();
  return true;
};

const loading = ref(false);
const componentsList = ref<any[]>([]);

const newOrderStore = ref('');
const newOrderTracking = ref('');
const newOrderTrackingUrl = ref('');
const newOrderDelivery = ref('');
const newOrderCost = ref(0);
const newOrderCurrency = ref('USD');
const newOrderSupplierId = ref('');
const newOrderProjectId = ref('');
const newOrderStorageId = ref('');
const newOrderItems = ref<
  { componentId: string; quantity: number; unitPrice: number }[]
>([]);

const projectsList = ref<{ id: string; title: string }[]>([]);
const projectOptions = computed(() => [
  { value: '', label: t('logistics.form.projectNone'), empty: true },
  ...projectsList.value.map((p) => ({ value: p.id, label: p.title })),
]);

// Destination storage (#51): the backend accepts only ROOT storages, so the
// picker offers just the top-level ones.
const storagesList = ref<
  { id: string; name: string; parentId: string | null }[]
>([]);
const storageOptions = computed(() => [
  { value: '', label: t('logistics.form.storageNone'), empty: true },
  ...storagesList.value
    .filter((s) => s.parentId === null)
    .map((s) => ({ value: s.id, label: s.name })),
]);

interface Supplier {
  id: string;
  name: string;
  url?: string | null;
  country?: string | null;
  trackingUrlTemplate?: string | null;
  notes?: string | null;
}
const suppliersList = ref<Supplier[]>([]);

const currencyOptions = ['USD', 'EUR', 'RUB', 'CNY', 'GBP'].map((c) => ({
  value: c,
  label: c,
}));

const supplierOptions = computed(() => [
  { value: '', label: t('logistics.form.supplierNone'), empty: true },
  ...suppliersList.value.map((s) => ({ value: s.id, label: s.name })),
]);

// New-supplier modal state.
const showSupplierModal = ref(false);
const supName = ref('');
const supUrl = ref('');
const supCountry = ref('');
const supTrackingTemplate = ref('');
const supNotes = ref('');

// Quick component creation goes through the inventory plugin's contribution
// (#53/#58): the trigger shows only while inventory contributes the modal.
const showQuickComponentModal = ref(false);
// The destination-storage picker is storages functionality (#58): hidden (and
// never fetched) while storages is disabled; a loaded storageId is preserved
// so saving never clobbers it.
const pluginsStore = usePluginsStore();
const storagesEnabled = computed(() => pluginsStore.isEnabled('storages'));
const quickCreateContributions = useSlotContributions(
  'logistics.order-form.quick-create',
);
const quickCreateAvailable = computed(
  () => quickCreateContributions.value.length > 0,
);
const quickCreateCtx = computed<Record<string, unknown>>(() => ({
  modelValue: showQuickComponentModal.value,
  'onUpdate:modelValue': (value: boolean) => {
    showQuickComponentModal.value = value;
  },
  onCreated: handleQuickCreated,
}));

const fetchComponents = async () => {
  try {
    const res = await apiFetch('/api/components');
    if (res.ok) {
      componentsList.value = await res.json();
    } else {
      toast.error(t('logistics.errors.componentsLoadFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.componentsLoadFailed'));
  }
};

const fetchSuppliers = async () => {
  try {
    const res = await apiFetch('/api/logistics/suppliers');
    if (res.ok) {
      suppliersList.value = await res.json();
    }
  } catch {
    // Suppliers are optional metadata; a load failure must not block the form.
  }
};

const fetchProjects = async () => {
  try {
    const res = await apiFetch('/api/projects');
    if (res.ok) {
      projectsList.value = await res.json();
    }
  } catch {
    // Project attribution is optional; ignore load failures.
  }
};

const fetchStorages = async () => {
  if (!storagesEnabled.value) return;
  try {
    const res = await apiFetch('/api/storages');
    if (res.ok) {
      storagesList.value = await res.json();
    }
  } catch {
    // The destination is optional; ignore load failures.
  }
};

// Picking a supplier fills the free-text store name when it's still empty.
const handleSupplierChange = () => {
  const supplier = suppliersList.value.find(
    (s) => s.id === newOrderSupplierId.value,
  );
  if (supplier && !newOrderStore.value.trim()) {
    newOrderStore.value = supplier.name;
  }
};

const handleCreateSupplier = async () => {
  if (!supName.value.trim()) return;
  try {
    loading.value = true;
    const res = await apiFetch('/api/logistics/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: supName.value.trim(),
        url: supUrl.value.trim() || undefined,
        country: supCountry.value.trim() || undefined,
        trackingUrlTemplate: supTrackingTemplate.value.trim() || undefined,
        notes: supNotes.value.trim() || undefined,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      await fetchSuppliers();
      newOrderSupplierId.value = created.id;
      handleSupplierChange();
      toast.success(t('logistics.toasts.supplierSaved'));
      supName.value = '';
      supUrl.value = '';
      supCountry.value = '';
      supTrackingTemplate.value = '';
      supNotes.value = '';
      showSupplierModal.value = false;
    } else {
      toast.error(t('logistics.errors.supplierSaveFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.supplierSaveFailed'));
  } finally {
    loading.value = false;
  }
};

const handleAddOrderItemRow = () => {
  newOrderItems.value.push({
    componentId: '',
    quantity: 1,
    unitPrice: 0,
  });
};

const handleRemoveOrderItemRow = (index: number) => {
  newOrderItems.value.splice(index, 1);
  recalcTotalCost();
};

const handleComponentChange = (index: number) => {
  const itemId = newOrderItems.value[index].componentId;
  const comp = componentsList.value.find((c) => c.id === itemId);
  if (comp) {
    newOrderItems.value[index].unitPrice = comp.lastPrice || 0;
  }
  recalcTotalCost();
};

const recalcTotalCost = () => {
  newOrderCost.value = Number(
    newOrderItems.value
      .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      .toFixed(2),
  );
};

// The shared modal already created the component — refresh the catalog and
// select it in a fresh order row (matches the old quick-modal behavior). Only
// the id is needed, so the contribution's payload is narrowed structurally —
// no type import from the inventory plugin.
const handleQuickCreated = async (created: { id: string }) => {
  await fetchComponents();
  newOrderItems.value.push({
    componentId: created.id,
    quantity: 1,
    unitPrice: 0,
  });
  recalcTotalCost();
};

const loadOrder = async () => {
  const id = route.params.id;
  if (typeof id !== 'string') return;
  try {
    const res = await apiFetch(`/api/logistics/orders/${id}`);
    if (res.ok) {
      const order = await res.json();
      newOrderStore.value = order.storeName;
      newOrderTracking.value = order.trackingNumber || '';
      newOrderTrackingUrl.value = order.trackingUrl || '';
      newOrderDelivery.value = order.estimatedDelivery || '';
      newOrderCost.value = order.totalCost || 0;
      newOrderCurrency.value = order.currency || 'USD';
      newOrderSupplierId.value = order.supplierId || '';
      newOrderProjectId.value = order.projectId || '';
      newOrderStorageId.value = order.storageId || '';
      orderStatus.value = order.status as OrderStatus;
      newOrderItems.value = (order.items ?? []).map(
        (i: { componentId: string; quantity: number; unitPrice: number }) => ({
          componentId: i.componentId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }),
      );
    } else {
      toast.error(t('logistics.errors.loadOrderFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.loadOrderFailed'));
  }
};

// statusOverride lets "Save as draft" (CART) / "Place order" (ORDERED) pick the
// status for a new order; editing keeps the order's current status by default.
const handleSaveOrder = async (statusOverride?: OrderStatus) => {
  if (!newOrderStore.value.trim() || newOrderItems.value.length === 0) return;

  if (newOrderItems.value.some((item) => !item.componentId)) {
    toast.error(t('logistics.form.selectComponentsAlert'));
    return;
  }

  const status = statusOverride ?? orderStatus.value;
  const id = route.params.id;
  const url = isEdit.value
    ? `/api/logistics/orders/${id}`
    : '/api/logistics/orders';
  const method = isEdit.value ? 'PUT' : 'POST';

  try {
    loading.value = true;
    const response = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storeName: newOrderStore.value.trim(),
        trackingNumber: newOrderTracking.value.trim(),
        trackingUrl: newOrderTrackingUrl.value.trim(),
        estimatedDelivery: newOrderDelivery.value || undefined,
        totalCost: newOrderCost.value,
        currency: newOrderCurrency.value,
        supplierId: newOrderSupplierId.value || undefined,
        projectId: newOrderProjectId.value || undefined,
        storageId: newOrderStorageId.value || undefined,
        status,
        items: newOrderItems.value,
      }),
    });

    if (response.ok) {
      toast.success(t('logistics.toasts.orderSaved'));
      router.push('/logistics');
    } else {
      toast.error(t('logistics.form.orderErrorAlert'));
    }
  } catch {
    toast.error(t('logistics.form.orderErrorAlert'));
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  await Promise.all([
    fetchComponents(),
    fetchSuppliers(),
    fetchProjects(),
    fetchStorages(),
  ]);
  if (isEdit.value) {
    await loadOrder();
  } else {
    // The projects BOM handoff deep-links here with the project preselected.
    const projectId = route.query.projectId;
    if (typeof projectId === 'string' && projectId) {
      newOrderProjectId.value = projectId;
    }
    if (!prefillItemsFromQuery()) {
      // Seed from the restock deep-link, else start with one empty row as before.
      handleAddOrderItemRow();
    }
  }
  loading.value = false;
});
</script>

<template>
  <div class="w-full space-y-6 animate-fade-in pb-12">
    <!-- Header Back Navigation -->
    <div class="flex items-center justify-between">
      <button
        @click="router.push('/logistics')"
        class="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ t('logistics.form.backToLogistics') }}
      </button>
    </div>

    <!-- Title and Subtitle -->
    <div>
      <h2 class="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
        {{
          isEdit
            ? t('logistics.form.editOrderTitle')
            : t('logistics.form.newOrderTitle')
        }}
      </h2>
      <p class="text-xs text-slate-500 mt-1">
        {{
          isEdit
            ? t('logistics.form.editSubtitle')
            : t('logistics.form.subtitle')
        }}
      </p>
      <!-- Tags (editable), contributed by the tags plugin on existing orders -->
      <div v-if="isEdit && orderTagRef" class="mt-3">
        <PluginSlot
          name="logistics.order-form.meta"
          :ctx="{ entityRef: orderTagRef, editable: true }"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <Spinner />
    </div>

    <!-- Order Form -->
    <form v-else @submit.prevent="handleSaveOrder()" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Store and Delivery Settings (left 1 col) -->
        <div class="lg:col-span-1 space-y-6">
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-6"
          >
            <h3
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <Truck class="w-4 h-4 text-brand-500" />
              {{ t('logistics.form.deliveryInfo') }}
            </h3>

            <div class="space-y-4">
              <div class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.storeLabel') }}</label
                >
                <input
                  v-model="newOrderStore"
                  type="text"
                  :placeholder="t('logistics.form.storePlaceholder')"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                  required
                />
              </div>

              <div v-if="showTracking" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.trackingLabel') }}</label
                >
                <input
                  v-model="newOrderTracking"
                  type="text"
                  :placeholder="t('logistics.form.trackingPlaceholder')"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-mono"
                />
              </div>

              <div v-if="showTracking" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.trackingUrlLabel') }}</label
                >
                <input
                  v-model="newOrderTrackingUrl"
                  type="url"
                  placeholder="https://..."
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div v-if="showTracking" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.deliveryDateLabel') }}</label
                >
                <input
                  v-model="newOrderDelivery"
                  type="date"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div
                v-if="showOrderExtras || showSuppliers"
                class="grid grid-cols-2 gap-4"
              >
                <div v-if="showOrderExtras" class="space-y-1.5">
                  <label
                    class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                    >{{ t('logistics.form.currencyLabel') }}</label
                  >
                  <Select
                    v-model="newOrderCurrency"
                    :options="currencyOptions"
                  />
                </div>
                <div v-if="showSuppliers" class="space-y-1.5">
                  <label
                    class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                    >{{ t('logistics.form.supplierLabel') }}</label
                  >
                  <Select
                    v-model="newOrderSupplierId"
                    :options="supplierOptions"
                    @change="handleSupplierChange"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.projectLabel') }}</label
                >
                <Select v-model="newOrderProjectId" :options="projectOptions" />
              </div>

              <div v-if="storagesEnabled" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('logistics.form.storageLabel') }}</label
                >
                <Select v-model="newOrderStorageId" :options="storageOptions" />
                <p class="text-xxs text-slate-500">
                  {{ t('logistics.form.storageHint') }}
                </p>
              </div>

              <button
                v-if="showSuppliers"
                type="button"
                class="text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
                @click="showSupplierModal = true"
              >
                + {{ t('logistics.form.addSupplier') }}
              </button>
            </div>
          </div>

          <!-- Price Indicator Widget -->
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 bg-gradient-to-tr from-brand-600/5 to-transparent space-y-2"
          >
            <span
              class="text-xxs uppercase tracking-wider font-bold text-slate-500 block"
              >{{ t('logistics.form.totalCostLabel') }}</span
            >
            <div
              class="text-3xl font-extrabold text-brand-600 dark:text-brand-400"
            >
              {{ newOrderCost.toFixed(2) }} {{ newOrderCurrency }}
            </div>
            <p class="text-xxs text-slate-500">
              {{ t('logistics.form.totalCostDesc') }}
            </p>
          </div>
        </div>

        <!-- Order Items (right 2 cols) -->
        <div class="lg:col-span-2 space-y-6">
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-6"
          >
            <div
              class="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <h3
                class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
              >
                <ShoppingBag class="w-4 h-4 text-brand-500" />
                {{ t('logistics.form.orderContent') }}
              </h3>

              <div class="flex gap-2">
                <Button
                  v-if="quickCreateAvailable"
                  variant="secondary"
                  size="sm"
                  :icon-left="Plus"
                  @click="showQuickComponentModal = true"
                >
                  {{ t('logistics.form.createComponent') }}
                </Button>
                <Button
                  size="sm"
                  :icon-left="Plus"
                  @click="handleAddOrderItemRow"
                >
                  {{ t('logistics.form.addItem') }}
                </Button>
              </div>
            </div>

            <!-- List of rows -->
            <div class="space-y-4">
              <div
                v-if="newOrderItems.length === 0"
                class="text-center py-12 text-slate-500"
              >
                <p class="text-sm">{{ t('logistics.form.noItems') }}</p>
                <button
                  type="button"
                  @click="handleAddOrderItemRow"
                  class="mt-2 text-xs font-bold text-brand-600 hover:underline"
                >
                  {{ t('logistics.form.addFirst') }}
                </button>
              </div>

              <div
                v-for="(item, index) in newOrderItems"
                :key="index"
                class="flex flex-col sm:flex-row items-end sm:items-center gap-4 p-4 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-200/50 dark:border-white/5"
              >
                <!-- Select Component -->
                <div class="flex-1 space-y-1 w-full">
                  <label class="text-xxs font-bold text-slate-600 block">{{
                    t('logistics.form.componentLabel')
                  }}</label>
                  <Select
                    v-model="item.componentId"
                    @change="handleComponentChange(index)"
                    :options="
                      componentsList.map((c) => ({
                        value: c.id,
                        label: `${c.name} (${c.sku || t('inventory.noSku')})`,
                      }))
                    "
                    :placeholder="t('logistics.form.componentPlaceholder')"
                    required
                  />
                </div>

                <!-- Quantity -->
                <div class="w-24 space-y-1">
                  <label class="text-xxs font-bold text-slate-600 block">{{
                    t('logistics.form.quantityLabel')
                  }}</label>
                  <input
                    v-model.number="item.quantity"
                    @input="recalcTotalCost"
                    type="number"
                    min="1"
                    class="w-full glass-input rounded-xl px-3 py-2 text-xs text-center font-semibold"
                    required
                  />
                </div>

                <!-- Price -->
                <div class="w-28 space-y-1">
                  <label class="text-xxs font-bold text-slate-600 block">{{
                    t('logistics.form.unitPriceLabel')
                  }}</label>
                  <input
                    v-model.number="item.unitPrice"
                    @input="recalcTotalCost"
                    type="number"
                    step="any"
                    min="0"
                    class="w-full glass-input rounded-xl px-3 py-2 text-xs text-center font-semibold"
                    required
                  />
                </div>

                <!-- Delete Action -->
                <button
                  type="button"
                  @click="handleRemoveOrderItemRow(index)"
                  class="p-2 bg-slate-100 dark:bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-500 rounded-xl border border-slate-200 dark:border-transparent transition-all sm:mt-5"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-3 pt-4">
        <Button variant="secondary" @click="router.push('/logistics')">
          {{ t('logistics.form.cancel') }}
        </Button>
        <Button
          v-if="!isEdit && showFullStatuses"
          variant="secondary"
          @click="handleSaveOrder('CART')"
        >
          {{ t('logistics.form.saveDraft') }}
        </Button>
        <Button type="submit" :icon-left="Save">
          {{
            isEdit
              ? t('logistics.form.saveChanges')
              : t('logistics.form.placeOrder')
          }}
        </Button>
      </div>
    </form>

    <!-- Quick component creation — contributed by the inventory plugin (#53/#58) -->
    <PluginSlot
      name="logistics.order-form.quick-create"
      :ctx="quickCreateCtx"
    />

    <!-- New Supplier Modal -->
    <Modal v-if="showSuppliers" v-model="showSupplierModal" width="md">
      <template #header>
        <h3
          class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
        >
          <Truck class="w-4 h-4 text-brand-500" />
          {{ t('logistics.form.supplierModalTitle') }}
        </h3>
      </template>

      <form class="space-y-4" @submit.prevent="handleCreateSupplier">
        <div class="space-y-1.5">
          <label class="text-xs font-bold text-slate-600 block">{{
            t('logistics.form.supplierName')
          }}</label>
          <input
            v-model="supName"
            type="text"
            placeholder="AliExpress"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            required
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-slate-600 block">{{
              t('logistics.form.supplierUrl')
            }}</label>
            <input
              v-model="supUrl"
              type="url"
              placeholder="https://..."
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-bold text-slate-600 block">{{
              t('logistics.form.supplierCountry')
            }}</label>
            <input
              v-model="supCountry"
              type="text"
              placeholder="CN"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-bold text-slate-600 block">{{
            t('logistics.form.supplierTrackingTemplate')
          }}</label>
          <input
            v-model="supTrackingTemplate"
            type="text"
            placeholder="https://t.17track.net/en#nums={tracking}"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-mono"
          />
          <p class="text-xxs text-slate-500">
            {{ t('logistics.form.supplierTrackingHint') }}
          </p>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-bold text-slate-600 block">{{
            t('logistics.form.supplierNotes')
          }}</label>
          <input
            v-model="supNotes"
            type="text"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <Button variant="secondary" @click="showSupplierModal = false">
            {{ t('logistics.form.cancel') }}
          </Button>
          <Button type="submit">{{ t('logistics.form.saveSupplier') }}</Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
