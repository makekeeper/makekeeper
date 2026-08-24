<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Spinner,
  EmptyState,
  apiJson,
  apiFetch,
  useConfirm,
  useToastStore,
  requestChatSession,
  notifyChatSessionsChanged,
} from '@makekeeper/frontend-core';
import {
  MessageSquare,
  Search,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from '@lucide/vue';
import type {
  SessionListItem,
  PagedSessions,
  MessageSearchHit,
  MessageSearchResult,
} from './types';

const props = defineProps<{ projectId: string }>();

const { t, locale } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE = 300;

const query = ref('');
const offset = ref(0);
const loading = ref(false);

const sessions = ref<SessionListItem[]>([]);
const hits = ref<MessageSearchHit[]>([]);
const total = ref(0);

const editingId = ref<string | null>(null);
const editTitle = ref('');
let debounce: ReturnType<typeof setTimeout> | undefined;

const searching = computed<boolean>(() => query.value.trim().length > 0);

const dateTime = (iso: string): string =>
  new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

const pageCount = computed<number>(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);
const currentPage = computed<number>(
  () => Math.floor(offset.value / PAGE_SIZE) + 1,
);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    if (searching.value) {
      const result = await apiJson<MessageSearchResult>(
        `/api/chat/projects/${props.projectId}/messages/search?q=${encodeURIComponent(
          query.value.trim(),
        )}&limit=${PAGE_SIZE}&offset=${offset.value}`,
      );
      hits.value = result.hits;
      total.value = result.total;
    } else {
      const result = await apiJson<PagedSessions>(
        `/api/chat/projects/${props.projectId}/sessions/paged?limit=${PAGE_SIZE}&offset=${offset.value}`,
      );
      sessions.value = result.items;
      total.value = result.total;
    }
  } catch {
    toast.error(t('projectDetail.ai.history.loadError'));
  } finally {
    loading.value = false;
  }
};

const reset = (): void => {
  offset.value = 0;
  void load();
};

const onSearchInput = (): void => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(reset, SEARCH_DEBOUNCE);
};

const prev = (): void => {
  if (offset.value === 0) return;
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  void load();
};
const next = (): void => {
  if (currentPage.value >= pageCount.value) return;
  offset.value += PAGE_SIZE;
  void load();
};

const displayTitle = (title: string | null): string =>
  title ?? t('projectDetail.ai.sessions.untitled');

const openSession = (sessionId: string, messageId?: string): void => {
  requestChatSession({ sessionId, messageId });
};

const togglePin = async (s: SessionListItem): Promise<void> => {
  try {
    await apiJson(`/api/chat/sessions/${s.id}`, {
      method: 'PATCH',
      body: { pinned: !s.pinned },
    });
    await load();
    notifyChatSessionsChanged();
  } catch {
    toast.error(t('projectDetail.ai.sessions.updateError'));
  }
};

const startRename = (s: SessionListItem): void => {
  editingId.value = s.id;
  editTitle.value = s.title ?? '';
};
const cancelRename = (): void => {
  editingId.value = null;
  editTitle.value = '';
};
const saveRename = async (s: SessionListItem): Promise<void> => {
  try {
    await apiJson(`/api/chat/sessions/${s.id}`, {
      method: 'PATCH',
      body: { title: editTitle.value.trim() },
    });
    cancelRename();
    await load();
    notifyChatSessionsChanged();
  } catch {
    toast.error(t('projectDetail.ai.sessions.updateError'));
  }
};

const remove = async (s: SessionListItem): Promise<void> => {
  const ok = await confirm({
    title: t('projectDetail.ai.sessions.deleteTitle'),
    message: t('projectDetail.ai.sessions.deleteMessage', {
      title: displayTitle(s.title),
    }),
    tone: 'danger',
    confirmLabel: t('common.delete'),
  });
  if (!ok) return;
  const res = await apiFetch(`/api/chat/sessions/${s.id}`, {
    method: 'DELETE',
  }).catch(() => null);
  if (!res || !res.ok) {
    toast.error(t('projectDetail.ai.sessions.deleteError'));
    return;
  }
  toast.success(t('projectDetail.ai.sessions.deleted'));
  // Stepping onto an empty last page after a delete pulls back one page.
  if (sessions.value.length === 1 && offset.value >= PAGE_SIZE) {
    offset.value -= PAGE_SIZE;
  }
  await load();
  // Keep the sidebar chat list in sync, and reset it if this was its open chat.
  notifyChatSessionsChanged({ deletedSessionId: s.id });
};

onMounted(load);
onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce);
});
defineExpose({ reload: load });
</script>

<template>
  <div
    class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 flex flex-col gap-4"
  >
    <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
      {{ t('projectDetail.ai.history.heading') }}
    </h3>

    <div class="relative">
      <Search
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
      />
      <input
        v-model="query"
        type="search"
        :placeholder="t('projectDetail.ai.history.searchPlaceholder')"
        :aria-label="t('projectDetail.ai.history.searchPlaceholder')"
        class="glass-input w-full rounded-xl pl-9 pr-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand-500/50"
        @input="onSearchInput"
      />
    </div>

    <div v-if="loading" class="flex justify-center py-8">
      <Spinner />
    </div>

    <!-- Search results -->
    <template v-else-if="searching">
      <EmptyState
        v-if="hits.length === 0"
        :icon="Search"
        :title="t('projectDetail.ai.search.empty')"
      />
      <ul v-else class="space-y-2">
        <li v-for="hit in hits" :key="hit.messageId">
          <button
            type="button"
            class="w-full text-left rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/50 dark:bg-white/[0.02] px-3 py-2 transition-colors hover:border-brand-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            @click="openSession(hit.sessionId, hit.messageId)"
          >
            <span class="block text-sm text-slate-700 dark:text-slate-200">{{
              hit.snippet
            }}</span>
            <span
              class="block text-xxs text-slate-400 dark:text-slate-500 mt-1"
            >
              {{ hit.sessionTitle ?? t('projectDetail.ai.sessions.untitled') }}
              ·
              {{ dateTime(hit.createdAt) }}
            </span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Session list -->
    <template v-else>
      <EmptyState
        v-if="sessions.length === 0"
        :icon="MessageSquare"
        :title="t('projectDetail.ai.sessions.empty')"
      />
      <ul v-else class="space-y-2">
        <li
          v-for="s in sessions"
          :key="s.id"
          class="group flex items-center gap-2 rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/50 dark:bg-white/[0.02] px-3 py-2 transition-colors hover:border-brand-500/40"
        >
          <template v-if="editingId === s.id">
            <input
              v-model="editTitle"
              type="text"
              :aria-label="t('projectDetail.ai.sessions.renameLabel')"
              class="glass-input flex-1 rounded-lg px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-brand-500/50"
              @keyup.enter="saveRename(s)"
              @keyup.esc="cancelRename"
            />
            <button
              type="button"
              class="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              :aria-label="t('common.save')"
              @click="saveRename(s)"
            >
              <Check class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-500/10 focus-visible:ring-2 focus-visible:ring-slate-500/50"
              :aria-label="t('common.cancel')"
              @click="cancelRename"
            >
              <X class="w-4 h-4" />
            </button>
          </template>

          <template v-else>
            <button
              type="button"
              class="flex-1 min-w-0 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              @click="openSession(s.id)"
            >
              <span class="flex items-center gap-1.5">
                <Pin v-if="s.pinned" class="w-3 h-3 shrink-0 text-brand-500" />
                <span
                  class="truncate text-sm text-slate-800 dark:text-slate-100"
                >
                  {{ displayTitle(s.title) }}
                </span>
              </span>
              <span
                class="block text-xxs text-slate-400 dark:text-slate-500 mt-0.5"
              >
                {{ dateTime(s.createdAt) }} ·
                {{
                  t('projectDetail.ai.sessions.messageCount', {
                    count: s.messageCount,
                  })
                }}
              </span>
            </button>

            <button
              type="button"
              class="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              :aria-label="
                s.pinned
                  ? t('projectDetail.ai.sessions.unpin')
                  : t('projectDetail.ai.sessions.pin')
              "
              @click="togglePin(s)"
            >
              <PinOff v-if="s.pinned" class="w-4 h-4" />
              <Pin v-else class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              :aria-label="t('projectDetail.ai.sessions.renameLabel')"
              @click="startRename(s)"
            >
              <Pencil class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500/50"
              :aria-label="t('common.delete')"
              @click="remove(s)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </template>
        </li>
      </ul>
    </template>

    <!-- Pager -->
    <div
      v-if="!loading && pageCount > 1"
      class="flex items-center justify-between pt-1 mt-auto"
    >
      <button
        type="button"
        class="p-1.5 rounded-lg text-slate-500 disabled:opacity-40 hover:bg-slate-500/10 focus-visible:ring-2 focus-visible:ring-brand-500/50"
        :disabled="currentPage <= 1"
        :aria-label="t('projectDetail.ai.history.prevPage')"
        @click="prev"
      >
        <ChevronLeft class="w-4 h-4" />
      </button>
      <span class="text-xxs text-slate-400 dark:text-slate-500">
        {{
          t('projectDetail.ai.history.pageOf', {
            page: currentPage,
            total: pageCount,
          })
        }}
      </span>
      <button
        type="button"
        class="p-1.5 rounded-lg text-slate-500 disabled:opacity-40 hover:bg-slate-500/10 focus-visible:ring-2 focus-visible:ring-brand-500/50"
        :disabled="currentPage >= pageCount"
        :aria-label="t('projectDetail.ai.history.nextPage')"
        @click="next"
      >
        <ChevronRight class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
