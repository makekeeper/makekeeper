<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import {
  Modal,
  Select,
  Button,
  Spinner,
  apiFetch,
  useToastStore,
  PluginSlot,
} from '@makekeeper/frontend-core';
import type { PhoneBridgeContext } from '@makekeeper/plugin-contract';
import { useI18n } from 'vue-i18n';
import { Download, Trash2 } from '@lucide/vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

type Step = 'input' | 'loading' | 'review';
const step = ref<Step>('input');

interface DraftItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  matchedComponentId: string | null;
  // The user's chosen target: a component id, or '' to create a new component.
  componentId: string;
}
const storeName = ref('');
const currency = ref('USD');
const trackingNumber = ref('');
const items = ref<DraftItem[]>([]);
const creating = ref(false);

const componentsList = ref<
  { id: string; name: string; sku: string | null; price: number | null }[]
>([]);

const currencyOptions = ['USD', 'EUR', 'RUB', 'CNY', 'GBP'].map((c) => ({
  value: c,
  label: c,
}));
const componentOptions = computed(() => [
  { value: '', label: t('logistics.import.createNew') },
  ...componentsList.value.map((c) => ({ value: c.id, label: c.name })),
]);

const captureContext = computed<PhoneBridgeContext>(() => ({
  kind: 'capture',
  contextLabel: t('logistics.import.captureLabel'),
}));

// Props for the capture plugin's phone-capture contribution (#58): the option
// renders only while capture is enabled; `onPhoto` receives the uploaded URL.
const captureCtx = computed<Record<string, unknown>>(() => ({
  context: captureContext.value,
  onPhoto: onCaptured,
}));

const close = () => emit('update:modelValue', false);

const fetchComponents = async () => {
  const res = await apiFetch('/api/components');
  if (res.ok) componentsList.value = await res.json();
};

const applyDraft = (draft: {
  storeName?: string;
  currency?: string;
  trackingNumber?: string;
  items?: Omit<DraftItem, 'componentId'>[];
}) => {
  storeName.value = draft.storeName || '';
  currency.value = draft.currency || 'USD';
  trackingNumber.value = draft.trackingNumber || '';
  items.value = (draft.items ?? []).map((i) => ({
    ...i,
    componentId: i.matchedComponentId ?? '',
  }));
  step.value = 'review';
};

const extract = async (body: { imageDataUrl?: string; imageUrl?: string }) => {
  step.value = 'loading';
  try {
    await fetchComponents();
    const res = await apiFetch('/api/logistics/orders/import-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      applyDraft(await res.json());
    } else {
      toast.error(t('logistics.errors.importFailed'));
      step.value = 'input';
    }
  } catch {
    toast.error(t('logistics.errors.importFailed'));
    step.value = 'input';
  }
};

// Downscale + re-encode to JPEG before upload: a full-res phone screenshot is
// several MB and trips the server body limit (413). Capping the longest edge to
// 1600px keeps the payload small while staying readable for the vision model.
const MAX_DIM = 1600;
const fileToScaledDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => resolve(dataUrl); // fall back to the original
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

const extractFile = async (file: File | null | undefined) => {
  if (!file || !file.type.startsWith('image/')) return;
  await extract({ imageDataUrl: await fileToScaledDataUrl(file) });
};

const onFile = async (event: Event) => {
  await extractFile((event.target as HTMLInputElement).files?.[0]);
};

const onPaste = async (event: ClipboardEvent) => {
  // Only handle paste while the picker is showing, and don't hijack text paste
  // in the review inputs.
  if (step.value !== 'input') return;
  const file = Array.from(event.clipboardData?.items ?? [])
    .find((i) => i.type.startsWith('image/'))
    ?.getAsFile();
  if (file) await extractFile(file);
};

const dragOver = ref(false);
const onDrop = async (event: DragEvent) => {
  dragOver.value = false;
  await extractFile(event.dataTransfer?.files?.[0]);
};

const onCaptured = (url: string) => {
  extract({ imageUrl: url });
};

// Paste fires on the document, not on a plain div — listen while the modal is
// open so Ctrl/Cmd+V works anywhere in it.
watch(
  () => props.modelValue,
  (open) => {
    if (open) document.addEventListener('paste', onPaste);
    else document.removeEventListener('paste', onPaste);
  },
);
onBeforeUnmount(() => document.removeEventListener('paste', onPaste));

const removeItem = (index: number) => items.value.splice(index, 1);

const createOrder = async () => {
  if (items.value.length === 0) return;
  try {
    creating.value = true;
    // Resolve each line to a component id: use the chosen one, or create a new
    // component from the extracted name/price when set to "create new".
    const resolved: {
      componentId: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    for (const item of items.value) {
      let componentId = item.componentId;
      if (!componentId) {
        const res = await apiFetch('/api/components', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name || t('logistics.import.unnamed'),
            sku: item.sku ?? '',
            quantity: 0,
            minQuantity: 0,
          }),
        });
        if (!res.ok) {
          toast.error(t('logistics.errors.importFailed'));
          return;
        }
        componentId = (await res.json()).id;
      }
      resolved.push({
        componentId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      });
    }

    const totalCost = resolved.reduce(
      (s, i) => s + i.quantity * i.unitPrice,
      0,
    );
    const orderRes = await apiFetch('/api/logistics/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName: storeName.value.trim() || t('logistics.import.unknownStore'),
        trackingNumber: trackingNumber.value.trim(),
        totalCost,
        currency: currency.value,
        items: resolved,
      }),
    });
    if (orderRes.ok) {
      toast.success(t('logistics.toasts.orderSaved'));
      emit('created');
      reset();
      close();
    } else {
      toast.error(t('logistics.errors.importFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.importFailed'));
  } finally {
    creating.value = false;
  }
};

const reset = () => {
  step.value = 'input';
  storeName.value = '';
  trackingNumber.value = '';
  items.value = [];
};
</script>

<template>
  <Modal
    :model-value="props.modelValue"
    width="3xl"
    @update:model-value="close"
  >
    <template #header>
      <h3
        class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
      >
        <Download class="w-4 h-4 text-brand-500" />
        {{ t('logistics.import.title') }}
      </h3>
    </template>

    <!-- Step: choose an image -->
    <div v-if="step === 'input'" class="space-y-4">
      <p class="text-xs text-slate-500">{{ t('logistics.import.subtitle') }}</p>

      <!-- Drop zone (also accepts a click-to-choose file) -->
      <label
        class="block rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors"
        :class="
          dragOver
            ? 'border-brand-500 bg-brand-500/5'
            : 'border-slate-300 dark:border-white/10 hover:border-brand-500/40'
        "
        @dragover.prevent="dragOver = true"
        @dragenter.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <Download class="w-6 h-6 text-brand-500 mx-auto mb-2" />
        <span
          class="text-sm font-semibold text-slate-700 dark:text-slate-200 block"
          >{{ t('logistics.import.dropHere') }}</span
        >
        <span class="text-xxs text-slate-400 block mt-1">{{
          t('logistics.import.pasteHint')
        }}</span>
        <input type="file" accept="image/*" class="hidden" @change="onFile" />
      </label>

      <div class="flex flex-wrap gap-3">
        <PluginSlot name="logistics.order-import.capture" :ctx="captureCtx" />
      </div>
    </div>

    <!-- Step: extracting -->
    <div
      v-else-if="step === 'loading'"
      class="flex flex-col items-center gap-3 py-10"
    >
      <Spinner />
      <span class="text-xs text-slate-500">{{
        t('logistics.import.extracting')
      }}</span>
    </div>

    <!-- Step: review the draft -->
    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="space-y-1.5 sm:col-span-1">
          <label class="text-xxs font-bold text-slate-600 block">{{
            t('logistics.form.storeLabel')
          }}</label>
          <input
            v-model="storeName"
            type="text"
            class="w-full glass-input rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div class="space-y-1.5">
          <label class="text-xxs font-bold text-slate-600 block">{{
            t('logistics.form.currencyLabel')
          }}</label>
          <Select v-model="currency" :options="currencyOptions" />
        </div>
        <div class="space-y-1.5">
          <label class="text-xxs font-bold text-slate-600 block">{{
            t('logistics.form.trackingLabel')
          }}</label>
          <input
            v-model="trackingNumber"
            type="text"
            class="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div class="space-y-2 max-h-72 overflow-y-auto">
        <div
          v-for="(item, index) in items"
          :key="index"
          class="flex flex-col sm:flex-row sm:items-end gap-2 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200/50 dark:border-white/5"
        >
          <div class="flex-1 space-y-1 w-full">
            <input
              v-model="item.name"
              type="text"
              class="w-full glass-input rounded-lg px-3 py-2 text-sm"
            />
            <Select v-model="item.componentId" :options="componentOptions" />
          </div>
          <div class="w-24 space-y-1">
            <label class="text-xxs text-slate-500 block">{{
              t('logistics.form.quantityLabel')
            }}</label>
            <input
              v-model.number="item.quantity"
              type="number"
              min="1"
              step="1"
              class="w-full glass-input rounded-lg px-3 py-2 text-sm text-center"
            />
          </div>
          <div class="w-32 space-y-1">
            <label class="text-xxs text-slate-500 block"
              >{{ t('logistics.form.unitPriceLabel') }} ({{ currency }})</label
            >
            <input
              v-model.number="item.unitPrice"
              type="number"
              step="any"
              min="0"
              class="w-full glass-input rounded-lg px-3 py-2 text-sm text-center"
            />
          </div>
          <button
            type="button"
            :aria-label="t('logistics.parcelTracking.delete')"
            class="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            @click="removeItem(index)"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
        <p
          v-if="items.length === 0"
          class="text-xs text-slate-500 text-center py-4"
        >
          {{ t('logistics.import.noItems') }}
        </p>
      </div>

      <div class="flex justify-between pt-2">
        <Button variant="secondary" @click="reset">{{
          t('logistics.import.back')
        }}</Button>
        <Button :disabled="creating || items.length === 0" @click="createOrder">
          {{ t('logistics.import.create') }}
        </Button>
      </div>
    </div>
  </Modal>
</template>
