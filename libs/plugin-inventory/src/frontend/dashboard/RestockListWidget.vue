<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRight, PackageCheck } from '@lucide/vue';
import { apiJson, EmptyState, Spinner } from '@makekeeper/frontend-core';

// Dashboard panel: the top of GET /api/components/restock — components whose
// free stock cannot cover their min threshold or unmet project demand, with
// the suggested buy quantity already computed server-side.
interface RestockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  shortfall: number;
}

const MAX_ITEMS = 5;

const { t } = useI18n();
const loading = ref(true);
const failed = ref(false);
const items = ref<RestockItem[]>([]);

const shown = computed<RestockItem[]>(() => items.value.slice(0, MAX_ITEMS));
const overflow = computed<number>(() =>
  Math.max(0, items.value.length - MAX_ITEMS),
);

onMounted(async () => {
  try {
    items.value = await apiJson<RestockItem[]>('/api/components/restock');
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
      <li v-for="item in shown" :key="item.id">
        <RouterLink
          :to="`/inventory/${item.id}/edit`"
          class="flex items-center justify-between gap-4 px-3 py-3 rounded-xl hover:bg-slate-100/70 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <div class="min-w-0">
            <span
              class="text-sm font-medium text-slate-900 dark:text-white block truncate"
            >
              {{ item.name }}
            </span>
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{
                t('inventory.dashboard.inStock', {
                  quantity: item.quantity,
                  unit: item.unit ?? '',
                })
              }}
            </span>
          </div>
          <span
            class="text-xs font-semibold text-amber-600 dark:text-amber-400 shrink-0"
          >
            {{ t('inventory.dashboard.buy', { quantity: item.shortfall }) }}
          </span>
        </RouterLink>
      </li>
    </ul>
    <RouterLink
      v-if="overflow > 0"
      to="/inventory"
      class="flex items-center justify-center gap-1.5 px-3 py-2.5 mt-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-xl"
    >
      {{ t('inventory.dashboard.more', { count: overflow }) }}
      <ArrowRight class="w-3.5 h-3.5" />
    </RouterLink>
  </div>

  <div v-else class="glass-card rounded-2xl">
    <EmptyState
      :title="
        failed
          ? t('inventory.dashboard.loadFailed')
          : t('inventory.dashboard.allStocked')
      "
      :description="failed ? '' : t('inventory.dashboard.allStockedHint')"
      :icon="PackageCheck"
    />
  </div>
</template>
