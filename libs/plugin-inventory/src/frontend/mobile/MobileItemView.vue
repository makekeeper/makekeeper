<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Button,
  EmptyState,
  Select,
  Spinner,
  apiJson,
  apiErrorMessage,
  previewUrl,
  useMobileScreenChrome,
  useOfflineQueue,
  usePluginsStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Minus, Plus, MapPin } from '@lucide/vue';

// One part, in the hand (#203): correct the count, and say where it lives.
//
// Every write here is a DELTA carrying an idempotency key, which is what lets it
// go through the offline queue unchanged. An absolute "the count is now 43"
// would be wrong the moment it waited: it would silently undo whatever the
// desktop did while this phone was in a basement.

interface ComponentDetail {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit?: string | null;
  imageUrl?: string | null;
  storageId?: string | null;
  storageRow?: number | null;
  storageCol?: number | null;
}

interface StorageOption {
  id: string;
  name: string;
}

const { t } = useI18n();
const route = useRoute();
const toast = useToastStore();
const queue = useOfflineQueue();
const plugins = usePluginsStore();

const item = ref<ComponentDetail | null>(null);
const loading = ref(true);
const busy = ref(false);
const step = ref(1);

const storages = ref<StorageOption[]>([]);
const storageId = ref('');
const storageRow = ref<number | null>(null);
const storageCol = ref<number | null>(null);
const storagesEnabled = computed(() => plugins.isEnabled('storages'));
const storageOptions = computed(() => [
  { value: '', label: t('inventory.mobile.noStorage'), empty: true },
  ...storages.value.map((s) => ({ value: s.id, label: s.name })),
]);

const id = computed(() => String(route.params.id));

// The part names its own screen. Route meta cannot: the title is the record.
// Until it loads the bar shows nothing rather than a placeholder that would be
// replaced a moment later — the same jump the recognize button used to make.
// Title only — the way back is an ordinary route parent, declared in meta, and
// must PUSH like any navigation between two addresses.
useMobileScreenChrome(() => ({ title: item.value?.name ?? null }));

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const detail = await apiJson<ComponentDetail>(
      `/api/components/${id.value}`,
    );
    item.value = detail;
    storageId.value = detail.storageId ?? '';
    storageRow.value = detail.storageRow ?? null;
    storageCol.value = detail.storageCol ?? null;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.loadError')));
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await load();
  if (storagesEnabled.value) {
    try {
      storages.value = await apiJson<StorageOption[]>('/api/storages');
    } catch {
      // The placement picker just stays empty.
    }
  }
});

const adjust = async (amount: number): Promise<void> => {
  const current = item.value;
  if (!current || busy.value || amount === 0) return;
  busy.value = true;
  // One entry point (#202): sends now when it can, queues when it cannot, and
  // carries the same idempotency key either way — so an online request that
  // times out and is retried cannot double-count.
  try {
    const { state } = await queue.submit({
      label: current.name,
      path: `/api/components/${current.id}/adjust`,
      method: 'PATCH',
      body: { amount, type: amount > 0 ? 'PURCHASE' : 'USED' },
    });
    if (state === 'queued') {
      // Show the count the person just counted; the real value arrives with the
      // drain. Optimistic, and honest about it — the queue strip says pending.
      current.quantity += amount;
    } else {
      await load();
    }
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    busy.value = false;
  }
};

// Placement is an ordinary field edit, not a stock movement — no delta, no
// queue: where a part lives is not a number two people can race on.
const savePlacement = async (): Promise<void> => {
  const current = item.value;
  if (!current || busy.value) return;
  busy.value = true;
  try {
    await apiJson(`/api/components/${current.id}`, {
      method: 'PATCH',
      body: {
        storageId: storageId.value || null,
        storageRow: storageRow.value,
        storageCol: storageCol.value,
      },
    });
    toast.success(t('inventory.mobile.placementSaved'));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="p-4 space-y-4">
    <Spinner v-if="loading" />

    <template v-else-if="item">
      <!-- The name is the screen's title and lives in the shell's header, like
           every other title on this surface — it just is not a constant, so it
           is declared at runtime rather than in route meta. What stays here is
           what the bar is not for: the picture and the article number. -->
      <header v-if="item.imageUrl || item.sku" class="flex items-center gap-3">
        <!-- The cover at thumbnail size, not the original: a 64px box has no use
             for the full frame, and this screen is opened on the connection a
             phone has in a basement. -->
        <img
          v-if="item.imageUrl"
          :src="previewUrl(item.imageUrl, 'xs')"
          :alt="$t('inventory.mobile.photoAlt')"
          class="w-16 h-16 rounded-xl object-cover shrink-0"
        />
        <p
          v-if="item.sku"
          class="min-w-0 truncate text-xs font-mono text-slate-500 dark:text-slate-400"
        >
          {{ item.sku }}
        </p>
      </header>

      <section
        class="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-800 p-4 space-y-4"
      >
        <p class="text-center">
          <span class="text-3xl font-bold">{{ item.quantity }}</span>
          <span class="text-sm text-slate-500 dark:text-slate-400">
            {{ item.unit }}
          </span>
        </p>

        <div class="flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            :icon-left="Minus"
            :disabled="busy"
            :aria-label="$t('inventory.mobile.decrease')"
            @click="adjust(-step)"
          />
          <div class="flex-1 space-y-1">
            <label
              for="mobile-item-step"
              class="block text-xs text-center text-slate-500 dark:text-slate-400"
            >
              {{ $t('inventory.mobile.step') }}
            </label>
            <input
              id="mobile-item-step"
              v-model.number="step"
              type="number"
              min="1"
              inputmode="numeric"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base text-center"
            />
          </div>
          <Button
            variant="primary"
            size="icon"
            :icon-left="Plus"
            :disabled="busy"
            :aria-label="$t('inventory.mobile.increase')"
            @click="adjust(step)"
          />
        </div>
      </section>

      <section v-if="storagesEnabled" class="space-y-3">
        <h2 class="text-sm font-semibold flex items-center gap-2">
          <MapPin class="w-4 h-4" />
          {{ $t('inventory.mobile.placement') }}
        </h2>
        <div class="space-y-1">
          <label for="mobile-item-storage" class="block text-sm font-medium">
            {{ $t('inventory.mobile.storage') }}
          </label>
          <Select
            id="mobile-item-storage"
            v-model="storageId"
            :options="storageOptions"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="mobile-item-row" class="block text-sm font-medium">
              {{ $t('inventory.mobile.row') }}
            </label>
            <input
              id="mobile-item-row"
              v-model.number="storageRow"
              type="number"
              min="1"
              inputmode="numeric"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
            />
          </div>
          <div class="space-y-1">
            <label for="mobile-item-col" class="block text-sm font-medium">
              {{ $t('inventory.mobile.col') }}
            </label>
            <input
              id="mobile-item-col"
              v-model.number="storageCol"
              type="number"
              min="1"
              inputmode="numeric"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
            />
          </div>
        </div>
        <Button
          variant="secondary"
          block
          :loading="busy"
          @click="savePlacement"
        >
          {{ $t('inventory.mobile.savePlacement') }}
        </Button>
      </section>
    </template>

    <EmptyState v-else :title="$t('inventory.mobile.notFound')" />
  </div>
</template>
