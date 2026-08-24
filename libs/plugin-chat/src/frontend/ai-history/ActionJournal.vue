<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import {
  Spinner,
  EmptyState,
  Badge,
  Switch,
  apiJson,
  useToastStore,
  resolveObjectRefRoute,
  requestChatSession,
} from '@makekeeper/frontend-core';
import { parseObjectRef } from '@makekeeper/plugin-contract';
import { History, ExternalLink } from '@lucide/vue';
import type {
  ProjectJournal,
  JournalEntry,
  JournalPermission,
  JournalStatus,
} from './types';

const props = defineProps<{ projectId: string }>();

const { t, locale } = useI18n();
const toast = useToastStore();

const journal = ref<ProjectJournal | null>(null);
const loading = ref(true);
const includeRead = ref(false);

const dateTime = (iso: string): string =>
  new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

const permissionTone: Record<
  JournalPermission,
  'read' | 'write' | 'destructive' | 'neutral'
> = {
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive',
  unknown: 'neutral',
};

const permissionLabel = (p: JournalPermission): string =>
  t(`projectDetail.ai.journal.permission.${p}`);

const statusLabel = (s: JournalStatus): string =>
  t(`projectDetail.ai.journal.status.${s}`);

const refLabel = (ref: string): string => {
  const parsed = parseObjectRef(ref);
  return parsed ? parsed.entityType : ref;
};

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    journal.value = await apiJson<ProjectJournal>(
      `/api/chat/projects/${props.projectId}/journal?includeRead=${includeRead.value}`,
    );
  } catch {
    toast.error(t('projectDetail.ai.journal.error'));
  } finally {
    loading.value = false;
  }
};

watch(includeRead, load);

const openSession = (entry: JournalEntry): void => {
  requestChatSession({
    sessionId: entry.sessionId,
    messageId: entry.messageId,
  });
};

const summaryChips = computed<{ key: JournalPermission; count: number }[]>(
  () => {
    const by = journal.value?.summary.byPermission;
    if (!by) return [];
    return (['WRITE', 'DESTRUCTIVE', 'READ', 'unknown'] as JournalPermission[])
      .map((key) => ({ key, count: by[key] }))
      .filter((c) => c.count > 0);
  },
);

onMounted(load);
defineExpose({ reload: load });
</script>

<template>
  <div
    class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 p-4 space-y-4"
  >
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('projectDetail.ai.journal.heading') }}
      </h3>
      <label
        class="flex items-center gap-2 text-xxs text-slate-500 dark:text-slate-400 cursor-pointer"
      >
        {{ t('projectDetail.ai.journal.showRead') }}
        <Switch
          v-model="includeRead"
          :aria-label="t('projectDetail.ai.journal.showRead')"
        />
      </label>
    </div>

    <div v-if="loading" class="flex justify-center py-8">
      <Spinner />
    </div>

    <template v-else-if="journal && journal.entries.length">
      <!-- Summary strip -->
      <div class="flex flex-wrap items-center gap-2">
        <Badge
          v-for="chip in summaryChips"
          :key="chip.key"
          :tone="permissionTone[chip.key]"
        >
          {{ permissionLabel(chip.key) }} · {{ chip.count }}
        </Badge>
        <span
          v-if="journal.summary.affectedRefs.length"
          class="text-xxs text-slate-400 dark:text-slate-500"
        >
          {{
            t('projectDetail.ai.journal.affected', {
              count: journal.summary.affectedRefs.length,
            })
          }}
        </span>
      </div>

      <!-- Entries -->
      <ul class="space-y-2">
        <li
          v-for="entry in journal.entries"
          :key="entry.messageId"
          class="rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/50 dark:bg-white/[0.02] px-3 py-2"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <Badge :tone="permissionTone[entry.permission]" uppercase>
              {{ permissionLabel(entry.permission) }}
            </Badge>
            <code class="text-sm text-slate-800 dark:text-slate-100">{{
              entry.toolName
            }}</code>
            <span
              v-if="entry.status !== 'executed'"
              class="text-xxs text-slate-400 dark:text-slate-500"
            >
              · {{ statusLabel(entry.status) }}
            </span>
            <button
              type="button"
              class="ml-auto p-1 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              :aria-label="t('projectDetail.ai.journal.openSession')"
              @click="openSession(entry)"
            >
              <ExternalLink class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-center gap-2 flex-wrap mt-1.5">
            <template v-for="ref in entry.refs" :key="ref">
              <RouterLink
                v-if="resolveObjectRefRoute(ref)"
                :to="resolveObjectRefRoute(ref)!"
                class="text-xxs px-1.5 py-0.5 rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400 hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {{ refLabel(ref) }}
              </RouterLink>
              <span
                v-else
                class="text-xxs px-1.5 py-0.5 rounded-md bg-slate-500/10 text-slate-500"
              >
                {{ refLabel(ref) }}
              </span>
            </template>
            <span class="text-xxs text-slate-400 dark:text-slate-500">
              {{ dateTime(entry.createdAt) }} ·
              {{
                entry.sessionTitle ?? t('projectDetail.ai.sessions.untitled')
              }}
            </span>
          </div>
        </li>
      </ul>
    </template>

    <EmptyState
      v-else
      :icon="History"
      :title="t('projectDetail.ai.journal.empty')"
    />
  </div>
</template>
