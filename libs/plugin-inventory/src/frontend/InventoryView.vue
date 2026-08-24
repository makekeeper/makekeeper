<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  Select,
  Button,
  Badge,
  Spinner,
  Modal,
  PageHeader,
  PageTabs,
  EmptyState,
  useConfirm,
  useToastStore,
  apiFetch,
  apiJson,
  buildTreeOptions,
  useResource,
  useRouteQuery,
  useUxMode,
  usePluginsStore,
  PluginSlot,
} from '@makekeeper/frontend-core';
import {
  formatCellAddress,
  formatObjectRef,
} from '@makekeeper/plugin-contract';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Search,
  Plus,
  AlertTriangle,
  FolderOpen,
  MapPin,
  Trash2,
  Edit2,
  Package,
  ShoppingCart,
  Lock,
  Layers,
} from '@lucide/vue';
import type { ItemCategoryDto } from '../categories';
import { INVENTORY_TABS } from './tabs';
import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  buildDescendantIndex,
  matchesCategoryFilter as matchesFilter,
} from './category-filter';

// Drafts a phone left behind (#201). Counted, not listed: this page is the
// inventory, and the batch has its own screen.
const intakeDraftCount = ref(0);

onMounted(async () => {
  try {
    intakeDraftCount.value = (
      await apiJson<{ id: string }[]>('/api/components/intake/drafts')
    ).length;
  } catch {
    // No count, no doorway — the drafts screen is still reachable by URL.
  }
});

interface ComponentItem {
  id: string;
  name: string;
  sku: string;
  categoryRef: { id: string; name: string } | null;
  storageId?: string | null;
  storageRow?: number | null;
  storageCol?: number | null;
  storage?: { id: string; name: string } | null;
  quantity: number;
  minQuantity: number;
  unit?: string;
  reservedTotal?: number;
  onOrder?: number;
  lastPrice?: number | null;
  lastCurrency?: string | null;
  description?: string;
  links?: string;
  customFields?: string;
  imageUrl?: string | null;
}

interface RestockItem extends ComponentItem {
  shortfall: number;
  unmetDemand: number;
}

const { t } = useI18n();
const router = useRouter();
const confirm = useConfirm();
const toast = useToastStore();

// UX-mode gating (#53): operation type + note are advanced surfaces; when
// hidden the modal sends only the amount and the backend defaults apply.
const { isFeatureVisible } = useUxMode();
const showStockOperations = computed(() =>
  isFeatureVisible('inventory.stockOperations'),
);
// Categories lens (#269): hides the vocabulary tab and the tree filter. A
// single remaining tab renders no strip at all — one tab is not navigation.
const showCategories = computed(() => isFeatureVisible('inventory.categories'));

// Structured placement label: storage name + optional grid cell (e.g. "A3").
const locationLabel = (item: ComponentItem): string => {
  const cell = formatCellAddress(
    item.storageRow ?? null,
    item.storageCol ?? null,
  );
  const name = item.storage?.name ?? '';
  return cell ? `${name} · ${cell}` : name;
};

// View switch (codes are technical identifiers; labels are i18n).
const VIEW_MODES = [
  { value: '', labelKey: 'inventory.views.all' },
  { value: 'low', labelKey: 'inventory.views.low' },
  { value: 'restock', labelKey: 'inventory.views.restock' },
] as const;

// Filters are route-driven (§5.3): they live in route.query, not local refs.
const searchQuery = useRouteQuery('q');
const selectedCategory = useRouteQuery('category', { default: ALL_CATEGORIES });
// View mode is route-driven: '' (all), 'low' (at/below min), 'restock' (buy list).
const viewMode = useRouteQuery('view');

const restockItems = ref<RestockItem[]>([]);
const loadingRestock = ref(false);

// Server-side search (#33 E5): the query rides in ?q= so the base can grow
// without shipping every row; the server matches name/sku/description/category/
// customFields. Client-side filters (category/stock/tag) still narrow the
// returned set below. useResource owns the AbortController + stale-response
// ordering, so fast typing can no longer race an earlier response onto the
// list, and it refetches on agent writes and scope changes.
const componentsResource = useResource<ComponentItem[]>(
  (signal) => {
    const q = searchQuery.value.trim();
    const url = q
      ? `/api/components?q=${encodeURIComponent(q)}`
      : '/api/components';
    return apiJson<ComponentItem[]>(url, { signal });
  },
  {
    refetchOn: ['agent-data', 'scope'],
    errorFallback: () => t('inventory.errors.listLoadFailed'),
    toastOnError: true,
  },
);
const components = computed<ComponentItem[]>(
  () => componentsResource.data.value ?? [],
);
const loading = componentsResource.loading;

const fetchRestock = async (): Promise<void> => {
  try {
    loadingRestock.value = true;
    const response = await apiFetch('/api/components/restock');
    if (response.ok) {
      restockItems.value = await response.json();
    }
  } catch (error) {
    console.error('Error fetching restock list:', error);
  } finally {
    loadingRestock.value = false;
  }
};

// The filter offers the category TREE, not the flat set of names the current
// page happens to mention. Built from the vocabulary itself, because a category
// has a parent and the loaded rows do not carry one — and because the options
// must not reshuffle under the person every time the search narrows the list.
const categoryTree = useResource<ItemCategoryDto[]>(
  () => apiJson<ItemCategoryDto[]>('/api/item-categories'),
  { refetchOn: ['agent-data', 'scope'], keepPreviousData: true },
);

const categoryOptions = computed(() => [
  { value: ALL_CATEGORIES, label: t('inventory.all'), empty: true },
  { value: NO_CATEGORY, label: t('inventory.noCategory') },
  ...buildTreeOptions(
    (categoryTree.data.value ?? []).map((category) => ({
      value: category.id,
      label: category.name,
      parentValue: category.parentId,
      order: category.order,
    })),
  ),
]);

const descendantsOf = computed<Map<string, Set<string>>>(() =>
  buildDescendantIndex(categoryTree.data.value ?? []),
);

// A chosen branch matches everything under it; the rule itself lives in
// `category-filter.ts` so it can be tested without mounting this page.
const matchesCategoryFilter = (item: ComponentItem): boolean =>
  matchesFilter(
    item.categoryRef?.id ?? null,
    selectedCategory.value,
    descendantsOf.value,
  );

// Same search + category filter as the main list, applied to the restock view
// so the category selector stays visible (no layout shift) and stays meaningful.
const filteredRestockItems = computed(() => {
  const query = searchQuery.value.toLowerCase();
  return restockItems.value.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(query) ||
      (c.sku && c.sku.toLowerCase().includes(query));
    return matchesSearch && matchesCategoryFilter(c);
  });
});

// On-order figures and the order handoff are logistics functionality (#58) —
// their entry points exist only while the logistics plugin is enabled.
const pluginsStore = usePluginsStore();
const logisticsEnabled = computed(() => pluginsStore.isEnabled('logistics'));

// Deep-link into the logistics order form, seeding the shortfall as order rows.
const orderShortfall = (items: RestockItem[]): void => {
  const payload = items.map((item) => ({
    componentId: item.id,
    quantity: Math.max(1, Math.ceil(item.shortfall)),
  }));
  if (!payload.length) return;
  router.push({
    path: '/logistics/new',
    query: { items: JSON.stringify(payload) },
  });
};

// Entity ids matching the active tag filter, from the tags-plugin slot (null =
// no tag chosen or tags disabled). ANDed into the list filtering below.
const tagMatchIds = ref<Set<string> | null>(null);
const onTagMatches = (ids: string[] | null): void => {
  tagMatchIds.value = ids ? new Set(ids) : null;
};
const tagFilter = useRouteQuery('tag');

// Canonical ORef of a component, passed to the tag slots.
const componentRef = (id: string): string =>
  formatObjectRef({
    pluginId: 'inventory',
    entityType: 'component',
    entityId: id,
  }) ?? '';

// Text search is server-side (#33 E5) — the fetched set is already q-filtered;
// this only applies the remaining client facets (category/stock/tag).
const filteredComponents = computed(() => {
  return components.value.filter((c) => {
    const matchesStock =
      viewMode.value !== 'low' ||
      (c.minQuantity > 0 && c.quantity <= c.minQuantity);
    const matchesTag = !tagMatchIds.value || tagMatchIds.value.has(c.id);
    return matchesCategoryFilter(c) && matchesStock && matchesTag;
  });
});

const getMovementTypeLabel = (type: string): string =>
  t(`inventory.movementTypes.${type}`, type);

const getCurrencySymbol = (code?: string): string => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    RUB: '₽',
    CNY: '¥',
    GBP: '£',
  };
  return symbols[code || 'USD'] || code || '$';
};

// Display a possibly-fractional quantity without float noise or trailing zeros.
const formatQty = (value: number): string =>
  String(parseFloat((value ?? 0).toFixed(3)));

const unitLabel = (code?: string): string =>
  t(`inventory.units.${code || 'pcs'}`, code || 'pcs');

// Manual movement types a user can record from the stock-change modal.
const MANUAL_MOVEMENT_TYPES = ['ADJUSTMENT', 'PURCHASE', 'USED', 'RETURN'];
const movementTypeOptions = computed(() =>
  MANUAL_MOVEMENT_TYPES.map((type) => ({
    value: type,
    label: getMovementTypeLabel(type),
  })),
);

// ── Stock-change modal (replaces the old ±1 stepper) ────────────────────────
const showStockModal = ref(false);
const stockTarget = ref<ComponentItem | null>(null);
const stockType = ref('ADJUSTMENT');
const stockAmount = ref<number>(0);
const stockNote = ref('');
const stockSubmitting = ref(false);

const stockResult = computed<number>(() =>
  Math.max(0, (stockTarget.value?.quantity ?? 0) + (stockAmount.value || 0)),
);

const openStockModal = (item: ComponentItem): void => {
  stockTarget.value = item;
  stockType.value = 'ADJUSTMENT';
  stockAmount.value = 0;
  stockNote.value = '';
  showStockModal.value = true;
};

const applyStock = async (): Promise<void> => {
  const target = stockTarget.value;
  if (!target || !stockAmount.value) {
    showStockModal.value = false;
    return;
  }
  stockSubmitting.value = true;
  try {
    const response = await apiFetch(`/api/components/${target.id}/adjust`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // With stock operations hidden, only the amount is sent — the backend's
      // default movement type applies and no note is recorded.
      body: JSON.stringify(
        showStockOperations.value
          ? {
              amount: stockAmount.value,
              type: stockType.value,
              note: stockNote.value.trim() || undefined,
            }
          : { amount: stockAmount.value },
      ),
    });
    if (response.ok) {
      const updated = await response.json();
      const item = components.value.find((c) => c.id === target.id);
      if (item) item.quantity = updated.quantity;
      showStockModal.value = false;
    } else {
      toast.error(t('inventory.stockModal.error'));
    }
  } catch (error) {
    toast.error(t('inventory.stockModal.error'));
    console.error('Error changing stock:', error);
  } finally {
    stockSubmitting.value = false;
  }
};

const handleDeleteComponent = async (id: string): Promise<void> => {
  const ok = await confirm({
    message: t('inventory.deleteConfirm'),
    tone: 'danger',
  });
  if (!ok) return;

  try {
    const response = await apiFetch(`/api/components/${id}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      await componentsResource.refetch();
    } else {
      const err = await response.json();
      toast.error(err.message || t('inventory.deleteError'));
    }
  } catch (error) {
    toast.error(t('inventory.deleteError'));
    console.error('Error deleting component:', error);
  }
};

// Load the restock list lazily whenever the restock view is active.
watch(
  viewMode,
  (mode) => {
    if (mode === 'restock') fetchRestock();
  },
  { immediate: true },
);

// Debounced server-side refetch as the query changes (#33 E5) — one request
// settles after typing stops, not per keystroke.
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => componentsResource.refetch(), 300);
});
onUnmounted(() => {
  if (searchDebounce) clearTimeout(searchDebounce);
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('inventory.page.title')"
      :subtitle="t('inventory.page.subtitle')"
      :icon="Package"
    >
      <template #actions>
        <!-- Only when a phone actually left work here (#201): an empty batch
             needs no doorway. -->
        <Button
          v-if="intakeDraftCount > 0"
          variant="secondary"
          :icon-left="Layers"
          @click="router.push('/inventory/intake')"
        >
          {{ t('inventory.mobile.reviewShot', { count: intakeDraftCount }) }}
        </Button>
        <Button :icon-left="Plus" @click="router.push('/inventory/new')">
          {{ t('inventory.addComponent') }}
        </Button>
      </template>
    </PageHeader>

    <PageTabs
      v-if="showCategories"
      :tabs="INVENTORY_TABS"
      :ariaLabel="t('inventory.page.title')"
    />

    <!-- Search & filters -->
    <div
      class="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4"
    >
      <!-- Search -->
      <div class="relative flex-1 max-w-md">
        <Search class="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('inventory.searchPlaceholder')"
          class="w-full glass-input rounded-xl pl-11 pr-4 py-2.5 text-sm"
        />
      </div>

      <!-- Filters & Actions. Wraps: the category picker got wider for the
           category TREE, and a row that cannot wrap would push the page into a
           horizontal scroll at tablet widths instead. -->
      <div class="flex flex-wrap items-center gap-3">
        <!-- View switch: all / low stock / restock -->
        <div
          class="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-transparent"
        >
          <button
            v-for="m in VIEW_MODES"
            :key="m.value"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            :class="
              viewMode === m.value
                ? 'bg-white dark:bg-white/10 text-brand-600 dark:text-brand-300 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
            "
            @click="viewMode = m.value"
          >
            {{ t(m.labelKey) }}
          </button>
        </div>

        <!-- Category selector (also filters the restock list) -->
        <!-- Wider than the other filters on purpose: its options are a tree,
             so a nested name carries its indentation as well as itself. -->
        <Select
          v-if="showCategories"
          v-model="selectedCategory"
          :options="categoryOptions"
          trigger-class="min-w-[240px]"
        />

        <!-- Tag filter, contributed by the tags plugin when enabled -->
        <PluginSlot
          name="inventory.list.filters"
          :ctx="{
            pluginId: 'inventory',
            entityType: 'component',
            selectedTagId: tagFilter || null,
            onSelect: (id) => (tagFilter = id ?? ''),
            onMatches: onTagMatches,
          }"
        />
      </div>
    </div>

    <!-- Loading Indicator -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <Spinner />
    </div>

    <!-- Restock (shopping) list -->
    <div
      v-else-if="viewMode === 'restock'"
      class="glass-card rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5"
    >
      <div v-if="loadingRestock" class="flex justify-center items-center py-12">
        <Spinner />
      </div>
      <EmptyState
        v-else-if="restockItems.length === 0"
        class="py-12"
        :icon="ShoppingCart"
        :title="t('inventory.restockEmpty')"
      />
      <div v-else>
        <div
          class="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/5"
        >
          <span
            class="text-sm font-semibold text-slate-700 dark:text-slate-200"
          >
            {{
              t('inventory.restockCount', {
                count: filteredRestockItems.length,
              })
            }}
          </span>
          <Button
            v-if="logisticsEnabled"
            size="sm"
            :icon-left="ShoppingCart"
            :disabled="filteredRestockItems.length === 0"
            @click="orderShortfall(filteredRestockItems)"
          >
            {{ t('inventory.orderAll') }}
          </Button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr
                class="border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-white/[0.02] text-slate-500 dark:text-slate-400 text-xxs font-semibold uppercase tracking-wider"
              >
                <th class="px-6 py-4">{{ t('inventory.component') }}</th>
                <th class="px-6 py-4 text-center">
                  {{ t('inventory.inStock') }}
                </th>
                <th v-if="logisticsEnabled" class="px-6 py-4 text-center">
                  {{ t('inventory.onOrderCol') }}
                </th>
                <th class="px-6 py-4 text-center">
                  {{ t('inventory.toBuy') }}
                </th>
                <th class="px-6 py-4 text-right">
                  {{ t('inventory.actions') }}
                </th>
              </tr>
            </thead>
            <tbody
              class="divide-y divide-slate-200 dark:divide-white/5 text-sm"
            >
              <tr v-if="filteredRestockItems.length === 0">
                <td
                  :colspan="logisticsEnabled ? 5 : 4"
                  class="py-8 text-center text-slate-500 text-xs"
                >
                  {{ t('inventory.componentsNotFound') }}
                </td>
              </tr>
              <tr
                v-for="item in filteredRestockItems"
                :key="item.id"
                class="hover:bg-slate-100/30 dark:hover:bg-white/[0.02] transition-colors"
              >
                <td class="px-6 py-4">
                  <div class="flex flex-col">
                    <span class="font-medium text-slate-900 dark:text-white">{{
                      item.name
                    }}</span>
                    <span class="text-xxs text-slate-500 font-mono mt-0.5">{{
                      item.sku || t('inventory.noSku')
                    }}</span>
                  </div>
                </td>
                <td
                  class="px-6 py-4 text-center text-slate-600 dark:text-slate-300"
                >
                  {{ formatQty(item.quantity) }} {{ unitLabel(item.unit) }}
                </td>
                <td v-if="logisticsEnabled" class="px-6 py-4 text-center">
                  <span
                    v-if="(item.onOrder || 0) > 0"
                    class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xxs font-bold"
                    :title="
                      t('inventory.onOrder', {
                        qty: formatQty(item.onOrder || 0),
                      })
                    "
                  >
                    <ShoppingCart class="w-3 h-3" />
                    {{ formatQty(item.onOrder || 0) }}
                    {{ unitLabel(item.unit) }}
                  </span>
                  <span v-else class="text-slate-300 dark:text-slate-600"
                    >—</span
                  >
                </td>
                <td class="px-6 py-4 text-center">
                  <span class="font-bold text-amber-600 dark:text-amber-400">
                    +{{ formatQty(item.shortfall) }} {{ unitLabel(item.unit) }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right">
                  <Button
                    v-if="logisticsEnabled"
                    size="sm"
                    variant="secondary"
                    :icon-left="ShoppingCart"
                    @click="orderShortfall([item])"
                  >
                    {{ t('inventory.order') }}
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Table Card Container -->
    <div
      v-else
      class="glass-card rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr
              class="border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-white/[0.02] text-slate-500 dark:text-slate-400 text-xxs font-semibold uppercase tracking-wider"
            >
              <th class="px-6 py-4">{{ t('inventory.component') }}</th>
              <th class="px-6 py-4">{{ t('inventory.category') }}</th>
              <th class="px-6 py-4">{{ t('inventory.location') }}</th>
              <th class="px-6 py-4 text-right">
                {{ t('inventory.lastPaid') }}
              </th>
              <th class="px-6 py-4 text-center">
                {{ t('inventory.quantity') }}
              </th>
              <th class="px-6 py-4 text-center">{{ t('inventory.status') }}</th>
              <th class="px-6 py-4 text-right">{{ t('inventory.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-white/5 text-sm">
            <tr
              v-for="item in filteredComponents"
              :key="item.id"
              class="hover:bg-slate-100/30 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer"
              @click="router.push('/inventory/' + item.id + '/edit')"
            >
              <!-- Name & SKU -->
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <!-- Thumbnail (#73): photo when set, else a neutral icon tile -->
                  <img
                    v-if="item.imageUrl"
                    :src="item.imageUrl"
                    :alt="item.name"
                    class="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-white/5 shrink-0 bg-slate-50 dark:bg-white/[0.02]"
                  />
                  <div
                    v-else
                    class="w-10 h-10 rounded-lg border border-slate-200 dark:border-white/5 shrink-0 flex items-center justify-center bg-slate-50 dark:bg-white/[0.02] text-slate-400"
                  >
                    <Package class="w-4 h-4" />
                  </div>
                  <div class="flex flex-col gap-1 min-w-0">
                    <span
                      class="font-medium text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors"
                      >{{ item.name }}</span
                    >
                    <span class="text-xxs text-slate-500 font-mono">{{
                      item.sku || t('inventory.noSku')
                    }}</span>
                    <PluginSlot
                      name="inventory.row.badges"
                      :ctx="{ entityRef: componentRef(item.id), compact: true }"
                    />
                  </div>
                </div>
              </td>

              <!-- Category -->
              <td class="px-6 py-4">
                <!-- No category is now the normal state (#205); without the
                     guard the pill renders as an empty bordered box. -->
                <Badge v-if="item.categoryRef" variant="label">
                  {{ item.categoryRef.name }}
                </Badge>
                <span v-else class="text-xs text-slate-400 dark:text-slate-500">
                  {{ t('inventory.noCategory') }}
                </span>
              </td>

              <!-- Location (structured: storage name + optional grid cell) -->
              <td class="px-6 py-4 text-slate-600 dark:text-slate-400">
                <div
                  v-if="item.storageId && item.storage"
                  class="flex items-center gap-1.5 text-xs font-medium"
                >
                  <MapPin
                    class="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 shrink-0"
                  />
                  <span>{{ locationLabel(item) }}</span>
                </div>
                <Badge v-else tone="neutral" :uppercase="false">
                  {{ t('inventory.table.locationUnknownBadge') }}
                </Badge>
              </td>

              <!-- Last paid price (derived from order history, #50) -->
              <td
                class="px-6 py-4 text-right font-semibold text-slate-800 dark:text-slate-200"
              >
                <span v-if="item.lastPrice != null"
                  >{{ getCurrencySymbol(item.lastCurrency ?? undefined)
                  }}{{ item.lastPrice.toFixed(2) }}</span
                >
                <span v-else class="text-slate-400">—</span>
              </td>

              <!-- Quantity (opens stock-change modal) -->
              <td class="px-6 py-4">
                <div class="flex items-center justify-center">
                  <button
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    :class="
                      item.minQuantity > 0 && item.quantity <= item.minQuantity
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                        : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-transparent text-slate-900 dark:text-white hover:bg-brand-500/10 hover:border-brand-500/20'
                    "
                    :title="t('inventory.stockModal.title')"
                    :aria-label="t('inventory.stockModal.title')"
                    @click.stop="openStockModal(item)"
                  >
                    <Package
                      class="w-3.5 h-3.5"
                      :class="
                        item.minQuantity > 0 &&
                        item.quantity <= item.minQuantity
                          ? 'text-amber-500'
                          : 'text-brand-500'
                      "
                    />
                    <span class="font-bold text-sm">{{
                      formatQty(item.quantity)
                    }}</span>
                    <span class="text-xxs opacity-70">{{
                      unitLabel(item.unit)
                    }}</span>
                  </button>
                </div>
              </td>

              <!-- Status indicators (tags): low stock / on order / reserved -->
              <td class="px-6 py-4">
                <div class="flex items-center justify-center gap-1.5">
                  <span
                    v-if="
                      item.minQuantity > 0 && item.quantity <= item.minQuantity
                    "
                    class="inline-flex items-center text-amber-500 shrink-0"
                    :title="
                      t('inventory.lowStock', {
                        min: formatQty(item.minQuantity),
                      })
                    "
                    :aria-label="
                      t('inventory.lowStock', {
                        min: formatQty(item.minQuantity),
                      })
                    "
                  >
                    <AlertTriangle class="w-4 h-4" />
                  </span>

                  <span
                    v-if="(item.onOrder || 0) > 0"
                    class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xxs font-bold shrink-0"
                    :title="
                      t('inventory.onOrder', {
                        qty: formatQty(item.onOrder || 0),
                      })
                    "
                    :aria-label="
                      t('inventory.onOrder', {
                        qty: formatQty(item.onOrder || 0),
                      })
                    "
                  >
                    <ShoppingCart class="w-3 h-3" />
                    {{ formatQty(item.onOrder || 0) }}
                  </span>

                  <span
                    v-if="(item.reservedTotal || 0) > 0"
                    class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-200/70 dark:bg-white/10 text-slate-500 dark:text-slate-400 text-xxs font-bold shrink-0"
                    :title="
                      t('inventory.reserved', {
                        qty: formatQty(item.reservedTotal || 0),
                      })
                    "
                    :aria-label="
                      t('inventory.reserved', {
                        qty: formatQty(item.reservedTotal || 0),
                      })
                    "
                  >
                    <Lock class="w-3 h-3" />
                    {{ formatQty(item.reservedTotal || 0) }}
                  </span>

                  <span
                    v-if="
                      !(
                        item.minQuantity > 0 &&
                        item.quantity <= item.minQuantity
                      ) &&
                      !(item.onOrder || 0) &&
                      !(item.reservedTotal || 0)
                    "
                    class="text-slate-300 dark:text-slate-600 text-xs"
                    >—</span
                  >
                </div>
              </td>

              <!-- Actions (Edit / Delete) -->
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="t('inventory.editComponent')"
                    :title="t('inventory.editComponent')"
                    :icon-left="Edit2"
                    @click.stop="router.push('/inventory/' + item.id + '/edit')"
                  />
                  <Button
                    variant="dangerGhost"
                    size="icon-sm"
                    :aria-label="t('inventory.deleteFromWarehouse')"
                    :title="t('inventory.deleteFromWarehouse')"
                    :icon-left="Trash2"
                    @click.stop="handleDeleteComponent(item.id)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- Empty State -->
      <div
        v-if="filteredComponents.length === 0"
        class="flex flex-col items-center justify-center py-12 text-slate-500 gap-2"
      >
        <FolderOpen class="w-12 h-12 text-slate-600" />
        <span>{{ t('inventory.componentsNotFound') }}</span>
      </div>
    </div>

    <!-- Stock-change Modal -->
    <Modal
      v-model="showStockModal"
      width="sm"
      :title="t('inventory.stockModal.title')"
    >
      <form v-if="stockTarget" class="space-y-4" @submit.prevent="applyStock">
        <p class="text-sm font-semibold text-slate-900 dark:text-white">
          {{ stockTarget.name }}
        </p>

        <!-- Signed amount -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >
            {{ t('inventory.stockModal.amountLabel') }}
          </label>
          <input
            v-model.number="stockAmount"
            type="number"
            step="any"
            :placeholder="t('inventory.stockModal.amountPlaceholder')"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-semibold text-center"
          />
          <p class="text-xxs text-slate-500 text-center">
            {{ t('inventory.stockModal.currentStock') }}:
            {{ formatQty(stockTarget.quantity) }}
            {{ unitLabel(stockTarget.unit) }}
            →
            {{ t('inventory.stockModal.resultStock') }}:
            {{ formatQty(stockResult) }} {{ unitLabel(stockTarget.unit) }}
          </p>
        </div>

        <!-- Advanced: operation type + note, collapsed by default (single write
             path stays simple); entirely absent when the feature is hidden. -->
        <details
          v-if="showStockOperations"
          class="group rounded-xl border border-slate-200 dark:border-white/5"
        >
          <summary
            class="cursor-pointer select-none px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-colors"
          >
            {{ t('inventory.stockModal.moreOptions') }}
          </summary>
          <div class="px-4 pb-4 pt-1 space-y-4">
            <!-- Operation type -->
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
              >
                {{ t('inventory.stockModal.operation') }}
              </label>
              <Select v-model="stockType" :options="movementTypeOptions" />
            </div>

            <!-- Note -->
            <div class="space-y-1.5">
              <label
                class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
              >
                {{ t('inventory.stockModal.noteLabel') }}
              </label>
              <input
                v-model="stockNote"
                type="text"
                :placeholder="t('inventory.stockModal.notePlaceholder')"
                class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              />
            </div>
          </div>
        </details>

        <div class="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            type="button"
            @click="showStockModal = false"
          >
            {{ t('inventory.stockModal.cancel') }}
          </Button>
          <Button type="submit" :disabled="stockSubmitting || !stockAmount">
            {{ t('inventory.stockModal.apply') }}
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
