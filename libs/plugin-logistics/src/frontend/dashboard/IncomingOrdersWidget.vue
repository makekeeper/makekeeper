<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRight, PackageOpen } from '@lucide/vue';
import { Badge, EmptyState, Spinner } from '@makekeeper/frontend-core';
import {
  fetchIncomingOrders,
  type DashboardOrderSummary,
} from './logistics-dashboard-data';

// Dashboard panel: orders currently on their way, with status and the
// estimated delivery date, each linking to its order form.
const MAX_ITEMS = 5;

const { t, locale } = useI18n();
const loading = ref(true);
const failed = ref(false);
const orders = ref<DashboardOrderSummary[]>([]);

const shown = computed<DashboardOrderSummary[]>(() =>
  orders.value.slice(0, MAX_ITEMS),
);
const overflow = computed<number>(() =>
  Math.max(0, orders.value.length - MAX_ITEMS),
);

const etaText = (order: DashboardOrderSummary): string =>
  order.estimatedDelivery
    ? t('logistics.dashboard.eta', {
        date: new Date(order.estimatedDelivery).toLocaleDateString(
          locale.value,
        ),
      })
    : t('logistics.dashboard.noEta');

onMounted(async () => {
  try {
    orders.value = await fetchIncomingOrders();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div
    v-if="loading"
    class="glass-card rounded-2xl p-6 flex justify-center py-16"
  >
    <Spinner />
  </div>

  <div v-else-if="shown.length" class="glass-card rounded-2xl p-3">
    <ul class="divide-y divide-slate-200/50 dark:divide-white/5">
      <li v-for="order in shown" :key="order.id">
        <RouterLink
          :to="`/logistics/${order.id}/edit`"
          class="flex items-center justify-between gap-4 px-3 py-3 rounded-xl hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <div class="min-w-0">
            <span
              class="text-sm font-medium text-slate-900 dark:text-white block truncate"
            >
              {{ order.storeName || order.supplierName || '—' }}
            </span>
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{ etaText(order) }}
            </span>
          </div>
          <Badge
            :tone="order.status === 'SHIPPED' ? 'brand' : 'neutral'"
            class="shrink-0"
          >
            {{ t(`logistics.status.${order.status}`) }}
          </Badge>
        </RouterLink>
      </li>
    </ul>
    <RouterLink
      v-if="overflow > 0"
      to="/logistics"
      class="flex items-center justify-center gap-1.5 px-3 py-2.5 mt-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-xl"
    >
      {{ t('logistics.dashboard.more', { count: overflow }) }}
      <ArrowRight class="w-3.5 h-3.5" />
    </RouterLink>
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState
      :title="
        failed
          ? t('logistics.dashboard.loadFailed')
          : t('logistics.dashboard.noIncoming')
      "
      :description="failed ? '' : t('logistics.dashboard.noIncomingHint')"
      :icon="PackageOpen"
    />
  </div>
</template>
