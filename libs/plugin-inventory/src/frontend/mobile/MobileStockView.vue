<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button,
  EmptyState,
  Spinner,
  apiJson,
  apiErrorMessage,
  useCameraScanner,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import { Search, ScanLine, X } from '@lucide/vue';

// Finding what is already on the shelf (#203).
//
// This is the human half of deduplication, not a convenience: without it the
// conveyor invites a second card for a part that is already stocked, and no
// amount of automatic SKU matching covers the parts whose packaging lost its
// barcode years ago.
//
// The query lives in the route, so a result list survives a back button, a
// refresh and a share — the same rule the desktop views follow.

interface ComponentItem {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit?: string | null;
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const query = ref('');
const results = ref<ComponentItem[]>([]);
const loading = ref(false);
const scanning = ref(false);

const {
  videoRef,
  failed: cameraFailed,
  start: startCamera,
  stop: stopCamera,
} = useCameraScanner((value) => {
  void resolveScanned(value);
});

const search = async (term: string): Promise<void> => {
  loading.value = true;
  try {
    results.value = await apiJson<ComponentItem[]>(
      `/api/components?q=${encodeURIComponent(term)}`,
    );
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.searchError')));
  } finally {
    loading.value = false;
  }
};

// Route-driven (§5.3): the query string is the state, and the watcher is the
// single place that reacts to it — typing only rewrites the URL.
watch(
  () => route.query.q,
  (value) => {
    query.value = typeof value === 'string' ? value : '';
    void search(query.value);
  },
  { immediate: true },
);

const submit = (): void => {
  void router.replace({ query: { ...route.query, q: query.value } });
};

// Drop the filter: the key leaves the URL entirely rather than staying on as an
// empty `?q=`, so a shared or reloaded link says "no search", not "a search for
// nothing". The watcher above does the rest — the field and the results both
// follow the route.
const clearSearch = (): void => {
  const next = { ...route.query };
  delete next.q;
  void router.replace({ query: next });
};

const openScanner = async (): Promise<void> => {
  scanning.value = true;
  await startCamera();
};

const closeScanner = (): void => {
  stopCamera();
  scanning.value = false;
};

// A scanned code goes straight to the part it names — the whole point of having
// labelled the shelf in the first place.
const resolveScanned = async (value: string): Promise<void> => {
  if (!scanning.value) return;
  closeScanner();
  try {
    const matches = await apiJson<ComponentItem[]>(
      `/api/components/by-sku?sku=${encodeURIComponent(value)}`,
    );
    if (matches.length === 1) {
      await router.push(`/m/inventory/item/${matches[0].id}`);
      return;
    }
    // Zero or several: fall back to showing it as a search, rather than
    // guessing which part the person meant.
    await router.replace({ query: { ...route.query, q: value } });
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.searchError')));
  }
};

onMounted(() => {
  if (typeof route.query.q !== 'string') void search('');
});

const unitLabel = (item: ComponentItem): string => item.unit?.trim() || '';

// An empty list means two different things, and saying the wrong one is a small
// lie the screen tells: with no term typed the query returns the whole shelf, so
// nothing back means nothing is stocked — not that a search failed.
const emptyTitle = computed<string>(() =>
  query.value.trim() === ''
    ? t('inventory.mobile.stockEmpty')
    : t('inventory.mobile.nothingFound'),
);
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- Titled by the shell's header, like every screen here. -->
    <form class="flex gap-2" @submit.prevent="submit">
      <div class="relative flex-1">
        <!-- Centred against the field rather than pinned a fixed distance from
             its top: the input grew a step when it went to `text-base` and a
             hardcoded `top-3` left the glass sitting high. -->
        <Search
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none"
        />
        <label class="sr-only" for="mobile-stock-search">
          {{ $t('inventory.mobile.searchLabel') }}
        </label>
        <!-- `pr-10` keeps the text clear of the reset button; `type="search"`
             is deliberately NOT relied on for it, since its native clear widget
             exists only on some engines and is styled by none of them. -->
        <input
          id="mobile-stock-search"
          v-model="query"
          type="search"
          class="w-full glass-input rounded-xl pl-9 pr-10 py-2.5 text-base"
          :placeholder="$t('inventory.mobile.searchPlaceholder')"
        />
        <!-- Only while there is a filter to drop. Clearing goes through the
             ROUTE, like every other change to this query (§5.3) — setting the
             field alone would leave the URL claiming a search that is over. -->
        <Button
          v-if="query !== ''"
          variant="ghost"
          size="icon-sm"
          class="absolute right-1 top-1/2 -translate-y-1/2"
          :icon-left="X"
          :aria-label="$t('inventory.mobile.clearSearch')"
          @click="clearSearch"
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        :icon-left="ScanLine"
        :aria-label="$t('inventory.mobile.scanToFind')"
        @click="openScanner"
      />
    </form>

    <div v-if="scanning" class="space-y-2">
      <div
        class="relative overflow-hidden rounded-2xl bg-slate-900 aspect-video"
      >
        <video
          ref="videoRef"
          class="w-full h-full object-cover"
          :aria-label="$t('inventory.mobile.cameraPreview')"
          muted
          playsinline
        ></video>
        <p
          v-if="cameraFailed"
          class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white"
        >
          {{ $t('inventory.mobile.cameraError') }}
        </p>
      </div>
      <Button variant="secondary" block :icon-left="X" @click="closeScanner">
        {{ $t('inventory.mobile.cancel') }}
      </Button>
    </div>

    <Spinner v-if="loading" />

    <EmptyState v-else-if="results.length === 0" :title="emptyTitle" />

    <ul v-else class="space-y-2">
      <li v-for="item in results" :key="item.id">
        <Button
          variant="secondary"
          block
          :to="`/m/inventory/item/${item.id}`"
          class="justify-between"
        >
          <span class="min-w-0 text-left">
            <span class="block font-medium truncate">{{ item.name }}</span>
            <span
              v-if="item.sku"
              class="block text-xs font-mono text-slate-500 dark:text-slate-400 truncate"
            >
              {{ item.sku }}
            </span>
          </span>
          <span class="shrink-0">
            {{ item.quantity }} {{ unitLabel(item) }}
          </span>
        </Button>
      </li>
    </ul>
  </div>
</template>
