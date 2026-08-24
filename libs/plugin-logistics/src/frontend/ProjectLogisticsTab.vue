<script setup lang="ts">
// The "Logistics" tab of the project detail view, contributed into the
// projects plugin's tab slot (#58): logistics functionality (a project's
// orders) rendered and fetched by its owner, so it exists only while the
// logistics plugin is enabled. Data comes from logistics' own list endpoint,
// filtered to the host project.
import { onMounted, ref } from 'vue';
import { apiFetch, useToastStore } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Truck, ExternalLink } from '@lucide/vue';
import { orderStatusColor } from './order-status';

const props = defineProps<{ projectId: string }>();

const { t, locale } = useI18n();
const toast = useToastStore();

interface ProjectOrder {
  id: string;
  storeName: string;
  orderDate: string | null;
  status: string;
  trackingNumber: string;
  trackingUrl: string;
  estimatedDelivery: string | null;
  totalCost: number;
  currency: string;
  itemsCount: number;
  projectId: string | null;
}

const relatedOrders = ref<ProjectOrder[]>([]);

const fetchOrders = async (): Promise<void> => {
  try {
    const res = await apiFetch(
      `/api/logistics/orders?projectId=${encodeURIComponent(props.projectId)}`,
    );
    if (res.ok) relatedOrders.value = await res.json();
  } catch {
    toast.error(t('logistics.errors.loadFailed'));
  }
};

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
    date,
  );
};

const orderStatusLabel = (status: string): string => {
  const key = `logistics.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

onMounted(fetchOrders);
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-base font-semibold text-slate-900 dark:text-white">
          {{ t('projectDetail.logisticsTitle') }}
        </h3>
        <p class="text-xs text-slate-500 mt-0.5">
          {{ t('projectDetail.logisticsSubtitle') }}
        </p>
      </div>
    </div>

    <div class="space-y-4">
      <div
        v-if="relatedOrders.length === 0"
        class="glass-card rounded-2xl p-12 text-center text-slate-500 border border-slate-200 dark:border-white/5"
      >
        <Truck
          class="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto mb-2 animate-bounce-slow"
        />
        <span class="text-sm font-semibold">{{
          t('projectDetail.noOrders')
        }}</span>
        <span class="text-xs block text-slate-400 mt-1">{{
          t('projectDetail.noOrdersHint')
        }}</span>
      </div>
      <div
        v-for="order in relatedOrders"
        :key="order.id"
        class="glass-card rounded-2xl p-5 hover:border-brand-500/20 transition-all border border-slate-200 dark:border-white/5 group"
      >
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-4 mb-4"
        >
          <div>
            <span
              class="text-xs text-slate-500 dark:text-slate-500 font-bold"
              >{{ formatDate(order.orderDate) ?? '—' }}</span
            >
            <h3
              class="text-sm font-bold text-slate-900 dark:text-white mt-0.5 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors"
            >
              {{ order.storeName }}
            </h3>
          </div>
          <span
            class="px-2 py-0.5 text-xxs font-bold rounded-md border"
            :class="orderStatusColor(order.status)"
          >
            {{ orderStatusLabel(order.status) }}
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-medium">
          <div>
            <span
              class="text-slate-500 text-xxs uppercase tracking-wider block"
              >{{ t('projectDetail.trackingNumber') }}</span
            >
            <span
              class="font-mono text-slate-800 dark:text-slate-300 mt-1 block flex items-center gap-1"
            >
              {{ order.trackingNumber }}
              <a
                v-if="order.trackingUrl"
                :href="order.trackingUrl"
                target="_blank"
                class="text-brand-600 dark:text-brand-400 hover:text-slate-900 dark:hover:text-white"
                ><ExternalLink class="w-3 h-3"
              /></a>
            </span>
          </div>
          <div>
            <span
              class="text-slate-500 text-xxs uppercase tracking-wider block"
              >{{ t('projectDetail.itemsCount') }}</span
            >
            <span
              class="text-slate-800 dark:text-slate-300 font-bold mt-1 block"
              >{{
                t('projectDetail.pcsCount', { count: order.itemsCount })
              }}</span
            >
          </div>
          <div>
            <span
              class="text-slate-500 text-xxs uppercase tracking-wider block"
              >{{ t('projectDetail.cost') }}</span
            >
            <span
              class="text-slate-800 dark:text-slate-300 font-bold mt-1 block"
              >{{ order.totalCost.toFixed(2) }} {{ order.currency }}</span
            >
          </div>
          <div>
            <span
              class="text-slate-500 text-xxs uppercase tracking-wider block"
              >{{ t('projectDetail.expected') }}</span
            >
            <span
              class="text-slate-800 dark:text-slate-300 font-bold mt-1 block"
              >{{
                formatDate(order.estimatedDelivery) ??
                t('projectDetail.unknownEta')
              }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
