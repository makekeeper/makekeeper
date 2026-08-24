<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import {
  Select,
  Button,
  Spinner,
  useToastStore,
  apiFetch,
  usePluginsStore,
  useUxMode,
} from '@makekeeper/frontend-core';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowLeft, Save, Plus, Cpu } from '@lucide/vue';
import { CURRENCY_OPTIONS, useCategoryOptions } from './shared';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToastStore();

const projectId = ref('');
const allComponentsList = ref<any[]>([]);
const selectedComponentId = ref('');
const linkNeededQty = ref(1);

// Inline component creation state
const isCreatingComponentInline = ref(false);
const inlineCompName = ref('');
const inlineCompSku = ref('');
// The category id (#205), not free text: the API takes a relation now.
const inlineCompCategoryId = ref('');
const { categoryOptions, loadCategories } = useCategoryOptions();
// The categories lens (#269): the inline create drops its picker together
// with inventory's own forms; the id stays '' so nothing is assigned.
const { isFeatureVisible } = useUxMode();
const showCategories = computed(() => isFeatureVisible('inventory.categories'));
const inlineCompPrice = ref(0);
const inlineCompCurrency = ref('USD');
const inlineCompQty = ref(0);
const inlineCompNeeded = ref(1);

const loading = ref(false);

const fetchComponents = async () => {
  try {
    loading.value = true;
    const response = await apiFetch('/api/components');
    if (response.ok) {
      allComponentsList.value = await response.json();
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  } finally {
    loading.value = false;
  }
};

const handleSave = async () => {
  try {
    let compId = selectedComponentId.value;
    let needed = linkNeededQty.value;

    if (isCreatingComponentInline.value) {
      // Only the name is required by the backend now; the rest is optional.
      if (!inlineCompName.value.trim()) return;

      const createRes = await apiFetch('/api/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inlineCompName.value.trim(),
          sku: inlineCompSku.value.trim(),
          categoryId: inlineCompCategoryId.value || null,
          quantity: inlineCompQty.value,
          minQuantity: 1,
          price: inlineCompPrice.value,
          currency: inlineCompCurrency.value,
        }),
      });

      if (!createRes.ok) {
        toast.error(t('linkComponent.createError'));
        return;
      }

      const newComp = await createRes.json();
      compId = newComp.id;
      needed = inlineCompNeeded.value;
    }

    if (!compId) return;

    const response = await apiFetch(
      `/api/projects/${projectId.value}/components`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentId: compId,
          neededQty: needed,
        }),
      },
    );

    if (response.ok) {
      router.push(`/projects/${projectId.value}`);
    } else {
      toast.error(t('projects.toasts.componentLinkFailed'));
    }
  } catch {
    toast.error(t('projects.toasts.componentLinkFailed'));
  }
};

onMounted(() => {
  projectId.value = route.params.id as string;
  // Linking browses the inventory catalog (#58): with inventory disabled this
  // deep link has nothing to offer — bounce back instead of firing dead fetches.
  if (!usePluginsStore().isEnabled('inventory')) {
    router.replace(`/projects/${projectId.value}`);
    return;
  }
  fetchComponents();
  void loadCategories();
});
</script>

<template>
  <div class="w-full space-y-6 animate-fade-in pb-12">
    <!-- Header Back Navigation -->
    <div class="flex items-center justify-between">
      <button
        @click="router.push(`/projects/${projectId}`)"
        class="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ $t('linkComponent.back') }}
      </button>
    </div>

    <!-- Main Card Form -->
    <div
      class="glass-card rounded-2xl p-6 md:p-8 space-y-6 border border-slate-200/60 dark:border-white/10 shadow-xl"
    >
      <div
        class="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-white/5"
      >
        <div
          class="p-2.5 bg-brand-500/10 text-brand-600 dark:text-brand-400 rounded-xl"
        >
          <Cpu class="w-6 h-6" />
        </div>
        <div>
          <h2 class="text-lg font-bold text-slate-900 dark:text-white">
            {{ $t('linkComponent.title') }}
          </h2>
          <p class="text-xs text-slate-500">
            {{ $t('linkComponent.subtitle') }}
          </p>
        </div>
      </div>

      <div v-if="loading" class="flex justify-center items-center py-12">
        <Spinner size="sm" />
      </div>

      <form v-else @submit.prevent="handleSave" class="space-y-6">
        <!-- Choose Existing component -->
        <div v-if="!isCreatingComponentInline" class="space-y-6">
          <div class="space-y-1.5">
            <div class="flex justify-between items-center">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300"
                >{{ $t('linkComponent.chooseLabel') }}</label
              >
              <button
                type="button"
                @click="isCreatingComponentInline = true"
                class="text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {{ $t('linkComponent.createNewBtn') }}
              </button>
            </div>
            <Select
              v-model="selectedComponentId"
              :options="
                allComponentsList.map((c) => ({
                  value: c.id,
                  label: t('linkComponent.componentOption', {
                    name: c.name,
                    sku: c.sku || t('linkComponent.noSku'),
                    quantity: c.quantity,
                  }),
                }))
              "
              :placeholder="$t('linkComponent.selectPlaceholder')"
              required
            />
          </div>

          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300"
              >{{ $t('linkComponent.neededQtyLabel') }}</label
            >
            <input
              v-model.number="linkNeededQty"
              type="number"
              min="1"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              required
            />
          </div>
        </div>

        <!-- Create Inline component -->
        <div v-else class="space-y-6 animate-fade-in">
          <div
            class="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-white/5"
          >
            <span
              class="text-sm font-bold text-slate-800 dark:text-slate-200"
              >{{ $t('linkComponent.createTitle') }}</span
            >
            <button
              type="button"
              @click="isCreatingComponentInline = false"
              class="text-xs font-bold text-slate-500 hover:underline"
            >
              {{ $t('linkComponent.selectFromCatalogBtn') }}
            </button>
          </div>

          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
              >{{ $t('linkComponent.nameLabel') }}</label
            >
            <input
              v-model="inlineCompName"
              type="text"
              :placeholder="$t('linkComponent.namePlaceholder')"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              required
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.skuLabel') }}</label
              >
              <input
                v-model="inlineCompSku"
                type="text"
                :placeholder="$t('linkComponent.skuPlaceholder')"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              />
            </div>
            <div v-if="showCategories" class="space-y-1.5">
              <label
                for="link-comp-category"
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.categoryLabel') }}</label
              >
              <Select
                id="link-comp-category"
                v-model="inlineCompCategoryId"
                :options="categoryOptions"
              />
            </div>
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.currencyLabel') }}</label
              >
              <Select
                v-model="inlineCompCurrency"
                :options="CURRENCY_OPTIONS"
              />
            </div>
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.priceLabel') }}</label
              >
              <input
                v-model.number="inlineCompPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                required
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.qtyInStockLabel') }}</label
              >
              <input
                v-model.number="inlineCompQty"
                type="number"
                min="0"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              />
            </div>
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >{{ $t('linkComponent.neededForProjectLabel') }}</label
              >
              <input
                v-model.number="inlineCompNeeded"
                type="number"
                min="1"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                required
              />
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div
          class="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-white/5"
        >
          <Button
            variant="secondary"
            @click="router.push(`/projects/${projectId}`)"
          >
            {{ $t('linkComponent.cancel') }}
          </Button>
          <Button type="submit" :icon-left="Plus">
            {{ $t('linkComponent.linkBtn') }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>
