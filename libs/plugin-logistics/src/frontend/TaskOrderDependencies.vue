<script setup lang="ts">
// The "delivery dependencies" editor of the task form, contributed by
// logistics into the projects plugin (#58): linking a task to orders and
// quick-creating an order are logistics functionality, so the whole section
// exists only while logistics is enabled. The selected links live in the host
// task (saved through the task PATCH as order-id references); this component
// edits that list via v-model and owns everything order-shaped: the project's
// order list (fetched from logistics' own endpoint) and inline order creation.
import { onMounted, ref } from 'vue';
import { Select, apiFetch, useToastStore } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Truck, Plus, Trash2, CheckCircle2, Circle } from '@lucide/vue';

export interface TaskOrderLink {
  orderId: string;
  storeName?: string;
  trackingNumber?: string;
  isDone?: boolean;
}

const props = defineProps<{
  projectId: string;
  modelValue: TaskOrderLink[];
  // The project BOM, for inline order lines: componentId + display name.
  projectComponents: { componentId: string; name: string }[];
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: TaskOrderLink[]): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

interface ProjectOrder {
  id: string;
  storeName: string;
  trackingNumber: string;
  projectId: string | null;
}

const projectOrders = ref<ProjectOrder[]>([]);

const fetchOrders = async (): Promise<void> => {
  try {
    const res = await apiFetch(
      `/api/logistics/orders?projectId=${encodeURIComponent(props.projectId)}`,
    );
    if (res.ok) projectOrders.value = await res.json();
  } catch {
    toast.error(t('logistics.errors.loadFailed'));
  }
};
onMounted(fetchOrders);

const addOrderId = ref('');

const handleAddTaskOrder = (): void => {
  if (!addOrderId.value) return;
  const existing = props.modelValue.find(
    (to) => to.orderId === addOrderId.value,
  );
  if (!existing) {
    const matched = projectOrders.value.find((o) => o.id === addOrderId.value);
    emit('update:modelValue', [
      ...props.modelValue,
      {
        orderId: addOrderId.value,
        storeName: matched?.storeName,
        trackingNumber: matched?.trackingNumber,
        isDone: false,
      },
    ]);
  }
  addOrderId.value = '';
};

const handleRemoveTaskOrder = (index: number): void => {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
};

const toggleDone = (index: number): void => {
  emit(
    'update:modelValue',
    props.modelValue.map((to, i) =>
      i === index ? { ...to, isDone: !to.isDone } : to,
    ),
  );
};

// Inline order creation
const isCreatingOrderInline = ref(false);
const inlineOrderStore = ref('');
const inlineOrderTracking = ref('');
const inlineOrderItems = ref<{ componentId: string; quantity: number }[]>([
  { componentId: '', quantity: 1 },
]);

const handleAddInlineOrderItem = (): void => {
  inlineOrderItems.value.push({ componentId: '', quantity: 1 });
};
const handleRemoveInlineOrderItem = (i: number): void => {
  inlineOrderItems.value.splice(i, 1);
};

const handleCreateOrderInline = async (): Promise<void> => {
  if (!inlineOrderStore.value.trim()) return;
  try {
    const items = inlineOrderItems.value
      .filter((i) => i.componentId)
      .map((i) => ({
        componentId: i.componentId,
        quantity: i.quantity,
        unitPrice: 0,
      }));

    const response = await apiFetch('/api/logistics/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName: inlineOrderStore.value.trim(),
        trackingNumber: inlineOrderTracking.value.trim(),
        trackingUrl: '',
        estimatedDelivery: undefined,
        totalCost: 0,
        projectId: props.projectId,
        items,
      }),
    });

    if (response.ok) {
      const newOrder = await response.json();
      await fetchOrders();
      emit('update:modelValue', [
        ...props.modelValue,
        {
          orderId: newOrder.id,
          storeName: newOrder.storeName,
          trackingNumber: newOrder.trackingNumber,
          isDone: false,
        },
      ]);
      inlineOrderStore.value = '';
      inlineOrderTracking.value = '';
      inlineOrderItems.value = [{ componentId: '', quantity: 1 }];
      isCreatingOrderInline.value = false;
    }
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
  }
};
</script>

<template>
  <div class="space-y-4">
    <h3
      class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"
    >
      <Truck class="w-4 h-4 text-brand-500" />
      {{ t('taskForm.deliveryDependenciesTitle') }}
    </h3>

    <!-- List linked orders -->
    <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
      <div
        v-for="(to, index) in props.modelValue"
        :key="index"
        class="flex items-center gap-2.5 p-2.5 rounded-xl border text-xs transition-all duration-200"
        :class="
          to.isDone
            ? 'bg-emerald-50 dark:bg-emerald-500/8 border-emerald-200 dark:border-emerald-500/20'
            : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200/60 dark:border-white/5'
        "
      >
        <button
          type="button"
          @click="toggleDone(index)"
          class="shrink-0 transition-colors duration-150"
          :title="
            to.isDone
              ? t('taskForm.removeReceivedMark')
              : t('taskForm.markReceived')
          "
        >
          <CheckCircle2 v-if="to.isDone" class="w-4 h-4 text-emerald-500" />
          <Circle v-else class="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </button>
        <div class="flex-1 min-w-0">
          <span
            class="font-semibold block truncate transition-all duration-150"
            :class="
              to.isDone
                ? 'text-emerald-700 dark:text-emerald-400 line-through decoration-emerald-400/60'
                : 'text-slate-800 dark:text-slate-200'
            "
            >{{ to.storeName }}</span
          >
          <span
            class="text-xxs"
            :class="
              to.isDone
                ? 'text-emerald-600/70 dark:text-emerald-500/60'
                : 'text-slate-500'
            "
            >{{
              t('taskForm.trackingLabel', {
                tracking: to.trackingNumber || t('taskForm.noTracking'),
              })
            }}</span
          >
        </div>
        <button
          type="button"
          @click="handleRemoveTaskOrder(index)"
          class="p-1 text-slate-400 hover:text-red-500 rounded transition-all shrink-0"
        >
          <Trash2 class="w-3.5 h-3.5" />
        </button>
      </div>
      <div
        v-if="props.modelValue.length === 0"
        class="text-xs text-slate-500 py-4 text-center"
      >
        {{ t('taskForm.noLinkedOrders') }}
      </div>
    </div>

    <!-- Link/Create Order Inline Form -->
    <div v-if="!isCreatingOrderInline" class="space-y-2">
      <div class="flex gap-2">
        <Select
          v-model="addOrderId"
          :options="
            projectOrders.map((order) => ({
              value: order.id,
              label: `${order.storeName} (${order.trackingNumber || t('taskForm.noTracking')})`,
            }))
          "
          :placeholder="t('taskForm.selectOrderPlaceholder')"
          class="flex-1"
        />
        <button
          type="button"
          @click="handleAddTaskOrder"
          class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all shrink-0"
        >
          {{ t('taskForm.linkBtn') }}
        </button>
      </div>
      <button
        type="button"
        @click="isCreatingOrderInline = true"
        class="text-xxs font-bold text-brand-600 dark:text-brand-400 hover:underline"
      >
        {{ t('taskForm.createMissingOrderBtn') }}
      </button>
    </div>

    <!-- Create order inline form -->
    <div
      v-else
      class="p-4 bg-slate-50 dark:bg-white/[0.02] rounded-xl border border-slate-200 dark:border-white/5 space-y-3 animate-fade-in"
    >
      <div
        class="flex justify-between items-center pb-1.5 border-b border-slate-200 dark:border-white/5"
      >
        <span class="text-xxs font-bold text-slate-700 dark:text-slate-300">{{
          t('taskForm.quickOrderTitle')
        }}</span>
        <button
          type="button"
          @click="isCreatingOrderInline = false"
          class="text-xxs font-bold text-slate-500 hover:underline"
        >
          {{ t('taskForm.cancel') }}
        </button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <input
          v-model="inlineOrderStore"
          type="text"
          :placeholder="t('taskForm.quickStorePlaceholder')"
          class="w-full glass-input rounded-xl px-3 py-2 text-xs"
        />
        <input
          v-model="inlineOrderTracking"
          type="text"
          :placeholder="t('taskForm.quickTrackingPlaceholder')"
          class="w-full glass-input rounded-xl px-3 py-2 text-xs font-mono"
        />
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xxs font-bold text-slate-500">{{
            t('taskForm.orderItemsTitle')
          }}</span>
          <button
            type="button"
            @click="handleAddInlineOrderItem"
            class="flex items-center gap-0.5 text-xxs font-bold text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Plus class="w-3 h-3" /> {{ t('taskForm.addOrderItemBtn') }}
          </button>
        </div>

        <div
          v-for="(item, idx) in inlineOrderItems"
          :key="idx"
          class="flex gap-1.5 items-center"
        >
          <Select
            v-model="item.componentId"
            :options="
              props.projectComponents.map((pc) => ({
                value: pc.componentId,
                label: pc.name,
              }))
            "
            :placeholder="t('taskForm.itemPlaceholder')"
            class="flex-1 min-w-0"
          />
          <input
            v-model.number="item.quantity"
            type="number"
            min="1"
            class="w-14 text-center glass-input rounded-xl px-2 py-2 text-xs font-semibold"
          />
          <button
            v-if="inlineOrderItems.length > 1"
            type="button"
            @click="handleRemoveInlineOrderItem(idx)"
            class="p-1 text-slate-400 hover:text-red-500 rounded transition-all shrink-0"
          >
            <Trash2 class="w-3.5 h-3.5" />
          </button>
          <div v-else class="w-5 shrink-0" />
        </div>
      </div>

      <button
        type="button"
        @click="handleCreateOrderInline"
        class="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-xs transition-all"
      >
        {{ t('taskForm.quickCreateBtn') }}
      </button>
    </div>
  </div>
</template>
