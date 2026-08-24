<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Select,
  Button,
  Badge,
  Spinner,
  Modal,
  PageHeader,
  Refreshable,
  SegmentedControl,
  apiFetch,
  useToastStore,
  useConfirm,
  useUxMode,
  usePluginsStore,
  type SegmentedOption,
} from '@makekeeper/frontend-core';
import { useRouter, useRoute, type LocationQueryValue } from 'vue-router';
import { useI18n } from 'vue-i18n';
import OrderImportModal from './OrderImportModal.vue';
import { orderStatusColor } from './order-status';
import {
  ShoppingBag,
  Plus,
  Truck,
  Copy,
  FileUp,
  CheckCircle,
  ExternalLink,
  Pencil,
  Trash2,
  RefreshCw,
  MapPin,
  Clock,
  Package,
  PackageCheck,
  Undo2,
  Download,
  Warehouse,
  ChevronDown,
  ChevronUp,
} from '@lucide/vue';

interface OrderItem {
  id: string;
  storeName: string;
  orderDate: string;
  status: 'CART' | 'ORDERED' | 'SHIPPED' | 'DELIVERED';
  trackingNumber: string;
  trackingUrl?: string;
  estimatedDelivery: string | null;
  totalCost: number;
  currency: string;
  supplierName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  storageId?: string | null;
  storageName?: string | null;
  lastTrackedAt?: string | null;
  itemsCount: number;
  trackingEventsCount: number;
  items: OrderLine[];
}

interface OrderLine {
  id: string;
  componentId: string;
  quantity: number;
  receivedQty: number;
  unitPrice: number | null;
  component: { name: string };
}

interface ReturnItem {
  id: string;
  componentId: string | null;
  quantity: number;
  status: string;
  reason: string | null;
  trackingNumber: string | null;
}

interface ProjectInfo {
  id: string;
  title: string;
  budgetPlanned: number | null;
  budgetCurrency: string | null;
}

interface TrackingEvent {
  id: string;
  status: string;
  location: string | null;
  eventTime: string;
}

interface ShoppingItem {
  componentId: string;
  name: string;
  qty: number;
  estimate: number;
}

const router = useRouter();
const route = useRoute();
const { t, locale } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
// Simple/advanced UX lens (#53) — hides advanced surfaces, never data.
const { isFeatureVisible } = useUxMode();
const showFullStatuses = computed(() =>
  isFeatureVisible('logistics.fullStatuses'),
);
const showReturns = computed(() => isFeatureVisible('logistics.returns'));
const showTracking = computed(() => isFeatureVisible('logistics.tracking'));
const showListFilters = computed(() =>
  isFeatureVisible('logistics.listFilters'),
);
const orders = ref<OrderItem[]>([]);
const shoppingList = ref<ShoppingItem[]>([]);
const projects = ref<ProjectInfo[]>([]);
const loading = ref(true);
const showImport = ref(false);
// Screenshot import runs on the chat plugin's vision capability (#58) — the
// entry point exists only while chat is enabled.
const pluginsStore = usePluginsStore();
const importAvailable = computed(
  () =>
    pluginsStore.isEnabled('chat') &&
    // Simple-by-default, demotable to pro (#269).
    isFeatureVisible('logistics.importFromImage'),
);

const queryStr = (
  value: LocationQueryValue | LocationQueryValue[] | undefined,
): string => (typeof value === 'string' ? value : '');

// Filters are route-driven (§5.3): they live in route.query, not local refs.
const searchQuery = computed<string>({
  get: () => queryStr(route.query.q),
  set: (value) => {
    router.replace({ query: { ...route.query, q: value || undefined } });
  },
});

const statusFilter = computed<string>({
  get: () => queryStr(route.query.status),
  set: (value) => {
    router.replace({ query: { ...route.query, status: value || undefined } });
  },
});

const projectFilter = computed<string>({
  get: () => queryStr(route.query.project),
  set: (value) => {
    router.replace({ query: { ...route.query, project: value || undefined } });
  },
});

const filteredOrders = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const status = statusFilter.value;
  const project = projectFilter.value;
  return orders.value.filter((o) => {
    if (status && o.status !== status) return false;
    if (project && o.projectId !== project) return false;
    if (q) {
      const haystack = `${o.storeName} ${o.trackingNumber ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
});

const projectFilterOptions = computed(() => [
  {
    value: '',
    label: t('logistics.parcelTracking.filterAllProjects'),
    empty: true,
  },
  ...projects.value.map((p) => ({ value: p.id, label: p.title })),
]);

// Budget banner: spent-per-currency on the selected project vs its planned
// budget. Computed from the already-loaded orders — no extra request.
const budgetSummary = computed(() => {
  const projectId = projectFilter.value;
  if (!projectId) return null;
  const project = projects.value.find((p) => p.id === projectId);
  const spentByCurrency: Record<string, number> = {};
  for (const o of orders.value) {
    if (o.projectId !== projectId) continue;
    spentByCurrency[o.currency] =
      (spentByCurrency[o.currency] ?? 0) + o.totalCost;
  }
  const planned = project?.budgetPlanned ?? null;
  const plannedCurrency = project?.budgetCurrency ?? 'USD';
  const spentInPlanned = spentByCurrency[plannedCurrency] ?? 0;
  return {
    spentByCurrency,
    planned,
    plannedCurrency,
    over: planned !== null && spentInPlanned > planned,
  };
});

// Dates arrive as raw ISO strings; format them in the active locale here so the
// backend stays locale-agnostic. Null/invalid ETA falls back to the i18n label.
const formatDate = (iso: string | null): string => {
  if (!iso) return t('logistics.fallbacks.unknownDelivery');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return t('logistics.fallbacks.unknownDelivery');
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
    date,
  );
};

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

// Timeline splits an event's moment across two surfaces: the day is rendered
// once per group header, the time once per row (#245).
const formatDay = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
    date,
  );
};

// Days since the order was placed — shown for in-flight parcels. Long-in-transit
// orders (still not delivered after the threshold) get a highlight nudge.
const STALE_DAYS = 30;
const daysInTransit = (order: OrderItem): number => {
  const placed = new Date(order.orderDate).getTime();
  if (Number.isNaN(placed)) return 0;
  return Math.floor((Date.now() - placed) / 86_400_000);
};
const isStale = (order: OrderItem): boolean =>
  order.status !== 'DELIVERED' &&
  order.status !== 'CART' &&
  daysInTransit(order) > STALE_DAYS;

// Card bottom (#245): one mutually-exclusive section per order — contents OR
// the tracking timeline — behind a deselectable SegmentedControl; '' = closed.
type CardSection = '' | 'contents' | 'tracking';
const cardSection = ref<Record<string, CardSection>>({});
const sectionFor = (orderId: string): CardSection =>
  cardSection.value[orderId] ?? '';

const trackingEvents = ref<Record<string, TrackingEvent[]>>({});
const trackingBusy = ref<string | null>(null);

const loadTracking = async (orderId: string): Promise<void> => {
  try {
    const res = await apiFetch(`/api/logistics/orders/${orderId}/tracking`);
    if (res.ok) trackingEvents.value[orderId] = await res.json();
  } catch {
    // Timeline is best-effort; a load failure just shows no events.
  } finally {
    // The key doubles as the "first load finished" marker (the panel shows a
    // plain spinner until it exists) — settle it even on failure so an
    // unreachable backend degrades to the empty state, not an endless spinner.
    trackingEvents.value[orderId] ??= [];
  }
};

const setSection = async (
  orderId: string,
  section: CardSection,
): Promise<void> => {
  cardSection.value[orderId] = section;
  // Timeline is lazy-loaded on first open; contents ship with the list payload.
  if (section === 'tracking' && !trackingEvents.value[orderId])
    await loadTracking(orderId);
};

// The Tracking segment exists only for orders that can be tracked at all; its
// count comes with the list payload and is superseded by the freshly loaded
// timeline after a manual refresh pulls in new checkpoints.
const sectionOptions = (order: OrderItem): SegmentedOption<CardSection>[] => {
  const options: SegmentedOption<CardSection>[] = [
    {
      value: 'contents',
      label: t('logistics.card.tabContents'),
      icon: Package,
      badge: String(order.itemsCount),
    },
  ];
  if (showTracking.value && order.trackingNumber) {
    const events = trackingEvents.value[order.id];
    options.push({
      value: 'tracking',
      label: t('logistics.card.tabTracking'),
      icon: MapPin,
      // Loaded timeline wins; `||` (not `??`) so a failed load's settled `[]`
      // falls back to the payload count instead of showing a false zero.
      badge: String(events?.length || order.trackingEventsCount),
    });
  }
  return options;
};

// Collapsed timeline shows only the latest few events; the rest hide behind
// an explicit expander so a 19-checkpoint parcel doesn't fill two screens.
const TIMELINE_PREVIEW = 5;
const timelineExpanded = ref<Record<string, boolean>>({});
const toggleTimeline = (orderId: string): void => {
  timelineExpanded.value[orderId] = !timelineExpanded.value[orderId];
};

interface TimelineDay {
  label: string;
  events: TrackingEvent[];
}

const timelineDays = (orderId: string): TimelineDay[] => {
  const events = [...(trackingEvents.value[orderId] ?? [])].sort(
    (a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime(),
  );
  const shown = timelineExpanded.value[orderId]
    ? events
    : events.slice(0, TIMELINE_PREVIEW);
  const days: TimelineDay[] = [];
  for (const ev of shown) {
    const label = formatDay(ev.eventTime);
    const current = days[days.length - 1];
    if (current && current.label === label) current.events.push(ev);
    else days.push({ label, events: [ev] });
  }
  return days;
};

const hiddenEventsCount = (orderId: string): number =>
  Math.max(0, (trackingEvents.value[orderId] ?? []).length - TIMELINE_PREVIEW);

// Receive progress per line — drives the mini progress bar in Contents.
const receivedPercent = (line: OrderLine): string => {
  if (line.quantity <= 0) return '0%';
  const ratio = Math.min(1, line.receivedQty / line.quantity);
  return `${Math.round(ratio * 100)}%`;
};

// A provider poll can advance the order's status and lastTrackedAt — re-read
// just this card's list row instead of re-running the page-level fetch, so the
// view doesn't flash the global loading state (the spinning refresh icon via
// `trackingBusy` is the only wait indication).
const refreshOrderRow = async (orderId: string): Promise<void> => {
  try {
    const res = await apiFetch('/api/logistics/orders');
    if (!res.ok) return;
    const fresh: OrderItem[] = await res.json();
    const row = fresh.find((o) => o.id === orderId);
    const index = orders.value.findIndex((o) => o.id === orderId);
    if (row && index !== -1) orders.value[index] = row;
  } catch {
    // Best-effort: the card keeps its current data until the next full load.
  }
};

const refreshTracking = async (orderId: string) => {
  try {
    trackingBusy.value = orderId;
    const res = await apiFetch(
      `/api/logistics/orders/${orderId}/tracking/refresh`,
      {
        method: 'POST',
      },
    );
    if (res.ok) {
      await Promise.all([loadTracking(orderId), refreshOrderRow(orderId)]);
    } else {
      toast.error(t('logistics.errors.trackingRefreshFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.trackingRefreshFailed'));
  } finally {
    trackingBusy.value = null;
  }
};

// ── Receiving ───────────────────────────────────────────────────────────────

const receiveOrderRef = ref<OrderItem | null>(null);
const receiveLines = ref<
  {
    orderComponentId: string;
    name: string;
    quantity: number;
    receivedQty: number;
  }[]
>([]);

const openReceive = (order: OrderItem) => {
  receiveOrderRef.value = order;
  receiveLines.value = order.items.map((i) => ({
    orderComponentId: i.id,
    name: i.component.name,
    quantity: i.quantity,
    receivedQty: i.receivedQty,
  }));
};

const receiveAll = () => {
  receiveLines.value.forEach((l) => (l.receivedQty = l.quantity));
};

const saveReceive = async () => {
  if (!receiveOrderRef.value) return;
  try {
    const res = await apiFetch(
      `/api/logistics/orders/${receiveOrderRef.value.id}/receive`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: receiveLines.value.map((l) => ({
            orderComponentId: l.orderComponentId,
            receivedQty: l.receivedQty,
          })),
        }),
      },
    );
    if (res.ok) {
      toast.success(t('logistics.toasts.itemsReceived'));
      receiveOrderRef.value = null;
      await fetchLogisticsData();
    } else {
      toast.error(t('logistics.errors.receiveFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.receiveFailed'));
  }
};

// ── Returns ─────────────────────────────────────────────────────────────────

const returnsOrderRef = ref<OrderItem | null>(null);
const returnsList = ref<ReturnItem[]>([]);
const retComponentId = ref('');
const retQuantity = ref(1);
const retReason = ref('');
const retTracking = ref('');

const returnStatusOptions = computed(() => [
  { value: 'INITIATED', label: t('logistics.returns.statuses.INITIATED') },
  {
    value: 'SHIPPED_BACK',
    label: t('logistics.returns.statuses.SHIPPED_BACK'),
  },
  {
    value: 'REFUND_RECEIVED',
    label: t('logistics.returns.statuses.REFUND_RECEIVED'),
  },
]);

const returnComponentOptions = computed(() => [
  { value: '', label: t('logistics.returns.wholeOrder') },
  ...(returnsOrderRef.value?.items ?? []).map((i) => ({
    value: i.componentId,
    label: i.component.name,
  })),
]);

const loadReturns = async (orderId: string) => {
  const res = await apiFetch(`/api/logistics/orders/${orderId}/returns`);
  if (res.ok) returnsList.value = await res.json();
};

const openReturns = async (order: OrderItem) => {
  returnsOrderRef.value = order;
  retComponentId.value = '';
  retQuantity.value = 1;
  retReason.value = '';
  retTracking.value = '';
  returnsList.value = [];
  await loadReturns(order.id);
};

const submitReturn = async () => {
  if (!returnsOrderRef.value) return;
  try {
    const res = await apiFetch('/api/logistics/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: returnsOrderRef.value.id,
        componentId: retComponentId.value || undefined,
        quantity: retQuantity.value,
        reason: retReason.value || undefined,
        trackingNumber: retTracking.value || undefined,
      }),
    });
    if (res.ok) {
      toast.success(t('logistics.toasts.returnCreated'));
      retReason.value = '';
      retTracking.value = '';
      await loadReturns(returnsOrderRef.value.id);
      await fetchLogisticsData();
    } else {
      toast.error(t('logistics.errors.returnFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.returnFailed'));
  }
};

const changeReturnStatus = async (returnId: string, status: string) => {
  try {
    const res = await apiFetch(`/api/logistics/returns/${returnId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok && returnsOrderRef.value)
      await loadReturns(returnsOrderRef.value.id);
    else if (!res.ok) toast.error(t('logistics.errors.returnFailed'));
  } catch {
    toast.error(t('logistics.errors.returnFailed'));
  }
};

const fetchLogisticsData = async () => {
  try {
    loading.value = true;
    const [ordersRes, listRes, projectsRes] = await Promise.all([
      apiFetch('/api/logistics/orders'),
      apiFetch('/api/logistics/shopping-list'),
      apiFetch('/api/projects'),
    ]);

    if (ordersRes.ok && listRes.ok) {
      orders.value = await ordersRes.json();
      shoppingList.value = await listRes.json();
    } else {
      toast.error(t('logistics.errors.loadFailed'));
    }
    // Projects power the order filter + budget banner; non-fatal if absent.
    if (projectsRes.ok) projects.value = await projectsRes.json();
  } catch {
    toast.error(t('logistics.errors.loadFailed'));
  } finally {
    loading.value = false;
  }
};

const handleUpdateOrderStatus = async (orderId: string, status: string) => {
  try {
    const response = await apiFetch(`/api/logistics/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });
    if (response.ok) {
      await fetchLogisticsData();
    } else {
      toast.error(t('logistics.errors.statusUpdateFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.statusUpdateFailed'));
  }
};

const goEditOrder = (orderId: string) => {
  router.push(`/logistics/${orderId}/edit`);
};

// Seed a new order with the whole deficit list — OrderFormView reads
// ?items=[{componentId,quantity}] and prefills the rows (§F1 / #32).
const createOrderFromList = () => {
  const items = shoppingList.value.map((i) => ({
    componentId: i.componentId,
    quantity: i.qty,
  }));
  router.push({
    path: '/logistics/new',
    query: { items: JSON.stringify(items) },
  });
};

const copyShoppingList = async () => {
  const text = shoppingList.value.map((i) => `${i.name}\t${i.qty}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('logistics.toasts.listCopied'));
  } catch {
    toast.error(t('logistics.errors.loadFailed'));
  }
};

const exportShoppingListCsv = () => {
  const rows = [
    ['name', 'qty', 'estimate'],
    ...shoppingList.value.map((i) => [
      i.name,
      String(i.qty),
      String(i.estimate),
    ]),
  ];
  const csv = rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'shopping-list.csv';
  link.click();
  URL.revokeObjectURL(url);
};

const handleDeleteOrder = async (order: OrderItem) => {
  const ok = await confirm({
    message: t('logistics.confirm.deleteOrder', { store: order.storeName }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(`/api/logistics/orders/${order.id}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      toast.success(t('logistics.toasts.orderDeleted'));
      await fetchLogisticsData();
    } else {
      toast.error(t('logistics.errors.deleteFailed'));
    }
  } catch {
    toast.error(t('logistics.errors.deleteFailed'));
  }
};

const statusLabels = computed(() => ({
  CART: t('logistics.status.CART'),
  ORDERED: t('logistics.status.ORDERED'),
  SHIPPED: t('logistics.status.SHIPPED'),
  DELIVERED: t('logistics.status.DELIVERED'),
}));

const statusOptions = computed(() => [
  { value: 'CART', label: t('logistics.status.CART') },
  { value: 'ORDERED', label: t('logistics.status.ORDERED') },
  { value: 'SHIPPED', label: t('logistics.status.SHIPPED') },
  { value: 'DELIVERED', label: t('logistics.status.DELIVERED') },
]);

const statusFilterOptions = computed(() => [
  { value: '', label: t('logistics.parcelTracking.filterAll'), empty: true },
  ...statusOptions.value,
]);

// Simple mode collapses the lifecycle to ORDERED/DELIVERED; orders currently in
// a hidden status (CART, SHIPPED) keep a read-only representation instead.
const simpleStatusOptions = computed(() => [
  { value: 'ORDERED', label: t('logistics.status.ORDERED') },
  { value: 'DELIVERED', label: t('logistics.status.DELIVERED') },
]);

const statusBadgeTones = {
  CART: 'neutral',
  ORDERED: 'warning',
  SHIPPED: 'brand',
  DELIVERED: 'success',
} as const;

onMounted(() => {
  fetchLogisticsData();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('logistics.page.title')"
      :subtitle="t('logistics.page.subtitle')"
      :icon="Truck"
    />

    <div v-if="loading" class="flex justify-center items-center py-12">
      <Spinner />
    </div>
    <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
      <!-- Left Column: Shopping List -->
      <div class="space-y-6">
        <div class="space-y-3">
          <h2
            class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"
          >
            <ShoppingBag class="w-5 h-5 text-brand-500 dark:text-brand-400" />
            {{ t('logistics.shoppingList.title') }}
          </h2>
          <div v-if="shoppingList.length > 0" class="flex flex-wrap gap-2">
            <Button size="sm" :icon-left="Plus" @click="createOrderFromList">
              {{ t('logistics.shoppingList.createOrder') }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :icon-left="Copy"
              @click="copyShoppingList"
            >
              {{ t('logistics.shoppingList.copy') }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :icon-left="FileUp"
              @click="exportShoppingListCsv"
            >
              {{ t('logistics.shoppingList.exportCsv') }}
            </Button>
          </div>
        </div>

        <div class="space-y-3">
          <div
            v-for="item in shoppingList"
            :key="item.name"
            class="glass-card rounded-xl p-4 flex justify-between items-center hover:border-brand-500/20 transition-all border border-slate-200 dark:border-white/5"
          >
            <div class="space-y-0.5">
              <span
                class="text-sm font-semibold text-slate-900 dark:text-white block"
                >{{ item.name }}</span
              >
              <span class="text-xxs text-slate-500 dark:text-slate-400 block">{{
                t('logistics.shoppingList.needsQty', { qty: item.qty })
              }}</span>
            </div>
            <div class="text-right">
              <span
                class="text-xs font-bold text-slate-800 dark:text-slate-400 block"
                >≈ {{ item.estimate }}</span
              >
            </div>
          </div>

          <div
            v-if="shoppingList.length === 0"
            class="glass-card rounded-xl p-8 text-center text-slate-500 border border-slate-200 dark:border-white/5"
          >
            <CheckCircle class="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <span class="text-xs font-semibold block">{{
              t('logistics.shoppingList.warehouseEquipped')
            }}</span>
            <span class="text-xxs text-slate-400 block mt-0.5">{{
              t('logistics.shoppingList.allDeficitsClosed')
            }}</span>
          </div>
        </div>
      </div>

      <!-- Right 2 Columns: Order Tracking -->
      <div class="lg:col-span-2 space-y-6">
        <div class="flex items-center justify-between">
          <h2
            class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2"
          >
            <Truck class="w-5 h-5 text-brand-500 dark:text-brand-400" />
            {{ t('logistics.parcelTracking.title') }}
          </h2>
          <div class="flex gap-2">
            <Button
              v-if="importAvailable"
              size="sm"
              variant="secondary"
              :icon-left="Download"
              @click="showImport = true"
            >
              {{ t('logistics.import.button') }}
            </Button>
            <Button
              size="sm"
              :icon-left="Plus"
              @click="router.push('/logistics/new')"
            >
              {{ t('logistics.parcelTracking.addOrder') }}
            </Button>
          </div>
        </div>

        <!-- Filter toolbar (route-driven) -->
        <div v-if="showListFilters" class="flex flex-col sm:flex-row gap-3">
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="t('logistics.parcelTracking.searchPlaceholder')"
            class="flex-1 glass-input rounded-xl px-4 py-2 text-sm"
          />
          <div class="sm:w-44">
            <Select v-model="statusFilter" :options="statusFilterOptions" />
          </div>
          <div class="sm:w-44">
            <Select v-model="projectFilter" :options="projectFilterOptions" />
          </div>
        </div>

        <!-- Project budget banner (when filtered to a project) -->
        <div
          v-if="showListFilters && budgetSummary"
          class="glass-card rounded-xl p-4 border flex flex-wrap items-center justify-between gap-2"
          :class="
            budgetSummary.over
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-slate-200 dark:border-white/5'
          "
        >
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span class="font-semibold text-slate-700 dark:text-slate-300">
              {{ t('logistics.budget.spent') }}:
              <template
                v-for="(amount, cur) in budgetSummary.spentByCurrency"
                :key="cur"
              >
                {{ amount.toFixed(2) }} {{ cur }}&nbsp;
              </template>
            </span>
            <span v-if="budgetSummary.planned !== null" class="text-slate-500">
              {{ t('logistics.budget.planned') }}:
              {{ budgetSummary.planned.toFixed(2) }}
              {{ budgetSummary.plannedCurrency }}
            </span>
          </div>
          <span
            v-if="budgetSummary.over"
            class="text-xxs font-bold text-red-600 dark:text-red-400"
          >
            {{ t('logistics.budget.over') }}
          </span>
        </div>

        <!-- Orders List -->
        <div class="space-y-4">
          <div
            v-for="order in filteredOrders"
            :key="order.id"
            class="glass-card rounded-2xl p-5 hover:border-brand-500/20 transition-all border border-slate-200 dark:border-white/5 group"
          >
            <!-- Order Title Header -->
            <div
              class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-4 mb-4"
            >
              <div>
                <span class="text-xs text-slate-500 font-bold">{{
                  formatDate(order.orderDate)
                }}</span>
                <h3
                  class="text-sm font-bold text-slate-900 dark:text-white mt-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors"
                >
                  {{ order.storeName }}
                </h3>
                <span
                  v-if="
                    showTracking &&
                    order.status !== 'DELIVERED' &&
                    order.status !== 'CART'
                  "
                  class="text-xxs font-semibold mt-0.5 inline-block"
                  :class="
                    isStale(order)
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-500'
                  "
                >
                  {{
                    t('logistics.tracking.inTransitDays', {
                      days: daysInTransit(order),
                    })
                  }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <!-- Interactive Status Selector. Simple mode offers only the
                   ORDERED/DELIVERED lifecycle; orders sitting in a hidden
                   status (CART, SHIPPED) show a read-only badge instead. -->
                <Select
                  v-if="
                    showFullStatuses ||
                    order.status === 'ORDERED' ||
                    order.status === 'DELIVERED'
                  "
                  :model-value="order.status"
                  @change="handleUpdateOrderStatus(order.id, $event)"
                  :options="
                    showFullStatuses ? statusOptions : simpleStatusOptions
                  "
                  custom-trigger
                  trigger-class="px-2.5 py-1 text-xxs font-bold rounded-lg border focus:ring-0 cursor-pointer"
                  dropdown-class="min-w-[120px]"
                  align="end"
                  :class="orderStatusColor(order.status)"
                />
                <Badge v-else :tone="statusBadgeTones[order.status]">
                  {{ statusLabels[order.status] }}
                </Badge>
                <!-- One shape for the whole row of actions: same size, same
                     quiet box, only the destructive one turns red. The four
                     used to carry four different hover tints, which read as
                     four different kinds of control. -->
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('logistics.receive.open')"
                  :title="t('logistics.receive.open')"
                  :icon-left="PackageCheck"
                  @click="openReceive(order)"
                />
                <Button
                  v-if="showReturns"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('logistics.returns.title')"
                  :title="t('logistics.returns.title')"
                  :icon-left="Undo2"
                  @click="openReturns(order)"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('logistics.parcelTracking.edit')"
                  :title="t('logistics.parcelTracking.edit')"
                  :icon-left="Pencil"
                  @click="goEditOrder(order.id)"
                />
                <Button
                  variant="dangerGhost"
                  size="icon-sm"
                  :aria-label="t('logistics.parcelTracking.delete')"
                  :title="t('logistics.parcelTracking.delete')"
                  :icon-left="Trash2"
                  @click="handleDeleteOrder(order)"
                />
              </div>
            </div>

            <!-- Order Stats and Details -->
            <div
              class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-medium"
            >
              <!-- Tracking Number -->
              <div v-if="showTracking">
                <span
                  class="text-slate-500 text-xxs uppercase tracking-wider block"
                  >{{ t('logistics.parcelTracking.trackingNumber') }}</span
                >
                <span
                  class="font-mono text-slate-800 dark:text-slate-300 mt-1 block flex items-center gap-1.5"
                >
                  {{
                    order.trackingNumber ||
                    t('logistics.parcelTracking.noTrack')
                  }}
                  <a
                    v-if="order.trackingUrl"
                    :href="order.trackingUrl"
                    target="_blank"
                    class="text-brand-600 dark:text-brand-400 hover:text-slate-900 dark:hover:text-white"
                  >
                    <ExternalLink class="w-3 h-3" />
                  </a>
                </span>
              </div>

              <!-- Items -->
              <div>
                <span
                  class="text-slate-500 text-xxs uppercase tracking-wider block"
                  >{{ t('logistics.parcelTracking.itemsInOrder') }}</span
                >
                <span
                  class="text-slate-800 dark:text-slate-400 font-bold mt-1 block"
                  >{{
                    t('logistics.parcelTracking.itemsCount', {
                      count: order.itemsCount,
                    })
                  }}</span
                >
              </div>

              <!-- Cost -->
              <div>
                <span
                  class="text-slate-500 text-xxs uppercase tracking-wider block"
                  >{{ t('logistics.parcelTracking.cost') }}</span
                >
                <span
                  class="text-slate-800 dark:text-slate-400 font-bold mt-1 block"
                  >{{ order.totalCost.toFixed(2) }} {{ order.currency }}</span
                >
              </div>

              <!-- Estimated Delivery -->
              <div>
                <span
                  class="text-slate-500 text-xxs uppercase tracking-wider block"
                >
                  {{
                    order.status === 'DELIVERED'
                      ? t('logistics.parcelTracking.delivered')
                      : t('logistics.parcelTracking.expected')
                  }}
                </span>
                <span
                  class="text-slate-800 dark:text-slate-400 font-bold mt-1 block"
                  >{{ formatDate(order.estimatedDelivery) }}</span
                >
              </div>

              <!-- Destination storage (#51) -->
              <div v-if="order.storageName">
                <span
                  class="text-slate-500 text-xxs uppercase tracking-wider block"
                  >{{ t('logistics.card.destination') }}</span
                >
                <span
                  class="text-slate-800 dark:text-slate-400 font-bold mt-1 block flex items-center gap-1.5"
                >
                  <Warehouse
                    class="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 shrink-0"
                  />
                  {{ order.storageName }}
                </span>
              </div>
            </div>

            <!-- Card bottom (#245): Contents/Tracking segmented switch; the
                 refresh zone shares the row instead of a second control pile -->
            <div
              class="mt-4 pt-3 border-t border-slate-200 dark:border-white/5 flex flex-wrap items-center justify-between gap-3"
            >
              <SegmentedControl
                :model-value="sectionFor(order.id)"
                :options="sectionOptions(order)"
                :aria-label="t('logistics.card.sections')"
                deselect-value=""
                @update:model-value="setSection(order.id, $event)"
              />
              <div
                v-if="showTracking && order.trackingNumber"
                class="flex items-center gap-2"
              >
                <span
                  v-if="order.lastTrackedAt"
                  class="text-xxs text-slate-500 flex items-center gap-1 tabular-nums"
                >
                  <Clock class="w-3 h-3" />
                  {{ formatDateTime(order.lastTrackedAt) }}
                </span>
                <button
                  type="button"
                  :aria-label="t('logistics.tracking.refresh')"
                  :title="t('logistics.tracking.refresh')"
                  :disabled="trackingBusy === order.id"
                  class="p-1 rounded-lg text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-colors disabled:opacity-50"
                  @click="refreshTracking(order.id)"
                >
                  <RefreshCw
                    :class="[
                      'w-3.5 h-3.5',
                      trackingBusy === order.id ? 'animate-spin' : '',
                    ]"
                  />
                </button>
              </div>
            </div>

            <!-- Contents (#52) — data comes with the list payload -->
            <div
              v-if="sectionFor(order.id) === 'contents'"
              class="mt-3 space-y-1.5 animate-fade-in"
            >
              <div
                v-for="line in order.items"
                :key="line.id"
                class="flex items-center justify-between gap-3 text-xs rounded-xl px-3 py-2 bg-slate-50 dark:bg-white/[0.02] border border-slate-200/50 dark:border-white/5"
              >
                <span
                  class="text-slate-800 dark:text-slate-200 font-medium flex-1 truncate"
                  >{{ line.component.name }}</span
                >
                <span
                  class="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums"
                  >×{{ line.quantity }}</span
                >
                <span
                  class="text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums"
                  >{{ (line.unitPrice ?? 0).toFixed(2) }}
                  {{ order.currency }}</span
                >
                <span class="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    class="h-1 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                      :style="{ width: receivedPercent(line) }"
                    ></span>
                  </span>
                  <span
                    class="text-xxs font-bold tabular-nums"
                    :class="
                      line.receivedQty >= line.quantity
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                    "
                  >
                    {{
                      t('logistics.card.receivedOfOrdered', {
                        received: line.receivedQty,
                        ordered: line.quantity,
                      })
                    }}
                  </span>
                </span>
              </div>
            </div>

            <!-- Tracking timeline (#245): day-grouped, latest emphasized,
                 collapsed to the newest few events by default -->
            <div
              v-else-if="showTracking && sectionFor(order.id) === 'tracking'"
              class="mt-3 animate-fade-in"
            >
              <!-- First load has nothing to keep on screen — plain spinner.
                   Reloads keep the timeline visible under Refreshable (#126). -->
              <div
                v-if="!trackingEvents[order.id]"
                class="flex justify-center py-4"
              >
                <Spinner />
              </div>
              <Refreshable v-else :refreshing="trackingBusy === order.id">
                <template v-if="(trackingEvents[order.id] || []).length">
                  <div
                    v-for="(day, dayIndex) in timelineDays(order.id)"
                    :key="day.label"
                    :class="dayIndex > 0 ? 'mt-2.5' : ''"
                  >
                    <div
                      class="mb-1 flex items-center gap-2 text-xxs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
                    >
                      {{ day.label }}
                      <span
                        class="h-px flex-1 bg-slate-200 dark:bg-white/5"
                        aria-hidden="true"
                      ></span>
                    </div>
                    <div
                      v-for="(ev, evIndex) in day.events"
                      :key="ev.id"
                      class="grid grid-cols-[44px_14px_1fr] items-baseline gap-x-2"
                    >
                      <span
                        class="whitespace-nowrap text-right text-xxs leading-5 tabular-nums"
                        :class="
                          dayIndex === 0 && evIndex === 0
                            ? 'font-semibold text-slate-500 dark:text-slate-400'
                            : 'text-slate-400 dark:text-slate-500'
                        "
                        >{{ formatTime(ev.eventTime) }}</span
                      >
                      <span class="relative self-stretch" aria-hidden="true">
                        <span
                          v-if="evIndex > 0"
                          class="absolute left-1/2 top-0 h-[9px] w-px -translate-x-1/2 bg-slate-200 dark:bg-white/10"
                        ></span>
                        <span
                          v-if="evIndex < day.events.length - 1"
                          class="absolute bottom-0 left-1/2 top-[9px] w-px -translate-x-1/2 bg-slate-200 dark:bg-white/10"
                        ></span>
                        <span
                          class="absolute left-1/2 top-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                          :class="
                            dayIndex === 0 && evIndex === 0
                              ? 'h-[9px] w-[9px] bg-brand-500 ring-[3px] ring-brand-500/20'
                              : 'h-[7px] w-[7px] bg-slate-300 dark:bg-slate-600'
                          "
                        ></span>
                      </span>
                      <span
                        class="pb-0.5 text-xs leading-5"
                        :class="
                          dayIndex === 0 && evIndex === 0
                            ? 'font-semibold text-slate-900 dark:text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        "
                      >
                        {{ ev.status
                        }}<span
                          v-if="ev.location"
                          class="text-slate-400 dark:text-slate-500"
                        >
                          · {{ ev.location }}</span
                        ><span
                          v-if="dayIndex === 0 && evIndex === 0"
                          class="ml-2 rounded-full bg-brand-500/10 px-1.5 text-xxs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300"
                          >{{ t('logistics.tracking.latest') }}</span
                        >
                      </span>
                    </div>
                  </div>
                  <div
                    v-if="hiddenEventsCount(order.id) > 0"
                    class="mt-2 flex justify-center"
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded px-2 py-1 text-xxs font-bold text-brand-600 dark:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                      :aria-expanded="timelineExpanded[order.id] ?? false"
                      @click="toggleTimeline(order.id)"
                    >
                      <component
                        :is="
                          timelineExpanded[order.id] ? ChevronUp : ChevronDown
                        "
                        class="w-3 h-3"
                      />
                      {{
                        timelineExpanded[order.id]
                          ? t('logistics.tracking.showLatestOnly')
                          : t('logistics.tracking.showEarlier', {
                              count: hiddenEventsCount(order.id),
                            })
                      }}
                    </button>
                  </div>
                </template>
                <div v-else class="text-xxs text-slate-500">
                  {{ t('logistics.tracking.noEvents') }}
                </div>
              </Refreshable>
            </div>
          </div>

          <div
            v-if="filteredOrders.length === 0"
            class="glass-card rounded-2xl p-8 text-center text-slate-500 border border-slate-200 dark:border-white/5"
          >
            <Truck class="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <span class="text-xs font-semibold block">{{
              t('logistics.parcelTracking.noResults')
            }}</span>
          </div>
        </div>
      </div>

      <!-- Receive items modal -->
      <Modal
        :model-value="receiveOrderRef !== null"
        width="md"
        @update:model-value="receiveOrderRef = null"
      >
        <template #header>
          <h3
            class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
          >
            <PackageCheck class="w-4 h-4 text-emerald-500" />
            {{ t('logistics.receive.title') }}
          </h3>
        </template>
        <div class="space-y-3">
          <div
            v-for="line in receiveLines"
            :key="line.orderComponentId"
            class="flex items-center justify-between gap-3"
          >
            <span
              class="text-sm text-slate-800 dark:text-slate-200 flex-1 truncate"
              >{{ line.name }}</span
            >
            <span class="text-xxs text-slate-500">{{
              t('logistics.receive.receivedOf', {
                received: line.receivedQty,
                total: line.quantity,
              })
            }}</span>
            <input
              v-model.number="line.receivedQty"
              type="number"
              min="0"
              :max="line.quantity"
              class="w-20 glass-input rounded-xl px-3 py-2 text-xs text-center"
            />
          </div>
          <div class="flex justify-between pt-2">
            <Button variant="secondary" size="sm" @click="receiveAll">{{
              t('logistics.receive.receiveAll')
            }}</Button>
            <Button size="sm" @click="saveReceive">{{
              t('logistics.receive.save')
            }}</Button>
          </div>
        </div>
      </Modal>

      <!-- Returns modal -->
      <Modal
        v-if="showReturns"
        :model-value="returnsOrderRef !== null"
        width="md"
        @update:model-value="returnsOrderRef = null"
      >
        <template #header>
          <h3
            class="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5"
          >
            <Undo2 class="w-4 h-4 text-amber-500" />
            {{ t('logistics.returns.title') }}
          </h3>
        </template>
        <div class="space-y-4">
          <!-- Existing returns -->
          <div v-if="returnsList.length" class="space-y-2">
            <div
              v-for="ret in returnsList"
              :key="ret.id"
              class="flex items-center justify-between gap-2 text-xs glass-card rounded-xl p-2 border border-slate-200 dark:border-white/5"
            >
              <span class="text-slate-700 dark:text-slate-300"
                >×{{ ret.quantity
                }}<span v-if="ret.reason" class="text-slate-500">
                  · {{ ret.reason }}</span
                ></span
              >
              <div class="w-40">
                <Select
                  :model-value="ret.status"
                  :options="returnStatusOptions"
                  @change="changeReturnStatus(ret.id, $event)"
                />
              </div>
            </div>
          </div>
          <p v-else class="text-xs text-slate-500">
            {{ t('logistics.returns.empty') }}
          </p>

          <!-- New return -->
          <div
            class="border-t border-slate-200 dark:border-white/5 pt-3 space-y-3"
          >
            <div class="space-y-1.5">
              <label class="text-xxs font-bold text-slate-600 block">{{
                t('logistics.returns.component')
              }}</label>
              <Select
                v-model="retComponentId"
                :options="returnComponentOptions"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="text-xxs font-bold text-slate-600 block">{{
                  t('logistics.returns.quantity')
                }}</label>
                <input
                  v-model.number="retQuantity"
                  type="number"
                  min="1"
                  class="w-full glass-input rounded-xl px-3 py-2 text-xs"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xxs font-bold text-slate-600 block">{{
                  t('logistics.returns.trackingNumber')
                }}</label>
                <input
                  v-model="retTracking"
                  type="text"
                  class="w-full glass-input rounded-xl px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>
            <div class="space-y-1.5">
              <label class="text-xxs font-bold text-slate-600 block">{{
                t('logistics.returns.reason')
              }}</label>
              <input
                v-model="retReason"
                type="text"
                class="w-full glass-input rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div class="flex justify-end">
              <Button size="sm" @click="submitReturn">{{
                t('logistics.returns.submit')
              }}</Button>
            </div>
          </div>
        </div>
      </Modal>

      <!-- Import order from screenshot -->
      <OrderImportModal
        v-if="importAvailable"
        v-model="showImport"
        @created="fetchLogisticsData"
      />
    </div>
  </div>
</template>
