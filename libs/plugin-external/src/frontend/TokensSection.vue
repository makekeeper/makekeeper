<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { KeyRound, Pencil, Trash2 } from '@lucide/vue';
import type { BadgeTone } from '@makekeeper/frontend-core';
import {
  Badge,
  Button,
  CopyField,
  Modal,
  SegmentedControl,
  Spinner,
  apiErrorMessage,
  apiJson,
  copyText,
  useConfirm,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  EXTERNAL_TOKEN_CEILINGS,
  type ExternalConnectionTokenView,
  type ExternalTokenCeiling,
} from '../external-types';
import SectionShell from './SectionShell.vue';

// The long-lived `mkt_` credentials an outside client — an MCP client, a
// script — authenticates with (#249). The install token is NOT here: it
// installs a plugin, so it lives with the rest of connecting one.
const { t, locale } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();

// The install token is NOT here (it installs a plugin, not a client), so this
// section says where it is instead of leaving an admin to hunt for it.
defineProps<{ connectTo: RouteLocationRaw }>();

// The row itself copies (CopyField) — this only acknowledges it.
const onTokenCopied = (): void => {
  toast.success(t('external.connectionTokens.copied'));
};

// Connection tokens.
const tokens = ref<ExternalConnectionTokenView[] | null>(null);
const busy = ref(false);

// Issue-flow state. The ceiling defaults to the safest reading; the clear
// token value exists only inside the issued modal, mirroring the install token.
const issueOpen = ref(false);
const label = ref('');
const ceiling = ref<ExternalTokenCeiling>('read-only');
const issuedOpen = ref(false);
const issuedValue = ref('');

// Inline rename: one row at a time is enough.
const renameId = ref<string | null>(null);
const renameValue = ref('');

const ceilingOptions = computed(() =>
  EXTERNAL_TOKEN_CEILINGS.map((value) => ({
    value,
    label: t(`external.connectionTokens.ceiling.${value}`),
  })),
);

const ceilingTone = (value: ExternalTokenCeiling): BadgeTone =>
  value === 'destructive'
    ? 'danger'
    : value === 'read-write'
      ? 'warning'
      : 'neutral';

const loadTokens = async (): Promise<void> => {
  try {
    tokens.value = await apiJson<ExternalConnectionTokenView[]>(
      '/api/external/admin/connection-tokens',
    );
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  }
};

onMounted(loadTokens);

// The section is kept alive between visits, so re-opening it must refetch: a
// token revoked in another tab would otherwise still be listed here. The first
// activation is the mount itself — that one already loaded.
let mountedOnce = false;
onActivated(() => {
  if (mountedOnce) void loadTokens();
  mountedOnce = true;
});

const openIssue = (): void => {
  label.value = '';
  ceiling.value = 'read-only';
  issueOpen.value = true;
};

const issueToken = async (): Promise<void> => {
  if (label.value.trim() === '') return;
  busy.value = true;
  try {
    const res = await apiJson<{ token: string }>(
      '/api/external/admin/connection-tokens',
      {
        method: 'POST',
        body: { label: label.value.trim(), ceiling: ceiling.value },
      },
    );
    issueOpen.value = false;
    issuedValue.value = res.token;
    issuedOpen.value = true;
    toast.success(t('external.connectionTokens.issued'));
    await loadTokens();
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  } finally {
    busy.value = false;
  }
};

const copyIssuedToken = async (): Promise<void> => {
  await copyText(issuedValue.value);
  onTokenCopied();
  issuedOpen.value = false;
};

const startRename = (row: ExternalConnectionTokenView): void => {
  renameId.value = row.id;
  renameValue.value = row.label;
};

const saveRename = async (): Promise<void> => {
  const id = renameId.value;
  if (!id || renameValue.value.trim() === '') return;
  busy.value = true;
  try {
    await apiJson(`/api/external/admin/connection-tokens/${id}`, {
      method: 'PATCH',
      body: { label: renameValue.value.trim() },
    });
    renameId.value = null;
    toast.success(t('external.connectionTokens.renamed'));
    await loadTokens();
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  } finally {
    busy.value = false;
  }
};

const revokeToken = async (row: ExternalConnectionTokenView): Promise<void> => {
  const ok = await confirm({
    message: t('external.connectionTokens.revokeConfirm', { label: row.label }),
    tone: 'danger',
  });
  if (!ok) return;
  busy.value = true;
  try {
    await apiJson(`/api/external/admin/connection-tokens/${row.id}`, {
      method: 'DELETE',
    });
    toast.success(t('external.connectionTokens.revoked'));
    await loadTokens();
  } catch (err: unknown) {
    toast.error(apiErrorMessage(err, t('external.errors.failed')));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <SectionShell
    :title="t('external.sections.tokens.title')"
    :description="t('external.sections.tokens.description')"
  >
    <template #actions>
      <Button @click="openIssue">
        <KeyRound class="h-4 w-4" aria-hidden="true" />
        {{ t('external.connectionTokens.issue') }}
      </Button>
    </template>

    <div
      class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/5"
    >
      <h3 class="text-sm font-semibold text-slate-900 dark:text-white">
        {{ t('external.connectionTokens.title') }}
      </h3>
      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
        {{ t('external.connectionTokens.hint') }}
      </p>

      <div v-if="tokens === null" class="mt-4 flex justify-center py-6">
        <Spinner />
      </div>
      <template v-else>
        <p
          v-if="tokens.length === 0"
          class="mt-4 text-sm text-slate-600 dark:text-slate-300"
        >
          {{ t('external.connectionTokens.empty') }}
        </p>
        <ul v-else class="mt-4 space-y-2">
          <li
            v-for="row in tokens"
            :key="row.id"
            class="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
          >
            <template v-if="renameId === row.id">
              <input
                v-model="renameValue"
                :aria-label="t('external.connectionTokens.labelLabel')"
                class="glass-input min-w-0 flex-1 rounded-xl px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                @keyup.enter="saveRename"
                @keyup.escape="renameId = null"
              />
              <Button
                size="sm"
                :disabled="busy || renameValue.trim() === ''"
                @click="saveRename"
              >
                {{ t('common.save') }}
              </Button>
              <Button size="sm" variant="secondary" @click="renameId = null">
                {{ t('common.cancel') }}
              </Button>
            </template>
            <template v-else>
              <span
                class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                {{ row.label }}
              </span>
              <Badge :tone="ceilingTone(row.ceiling)">
                {{ t(`external.connectionTokens.ceiling.${row.ceiling}`) }}
              </Badge>
              <span
                class="hidden shrink-0 text-xxs text-slate-500 dark:text-slate-400 sm:block"
              >
                {{
                  t('external.connectionTokens.created', {
                    date: new Date(row.createdAt).toLocaleDateString(locale),
                  })
                }}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                :disabled="busy"
                :aria-label="t('external.connectionTokens.rename')"
                @click="startRename(row)"
              >
                <Pencil class="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="dangerGhost"
                :disabled="busy"
                :aria-label="t('external.connectionTokens.revoke')"
                @click="revokeToken(row)"
              >
                <Trash2 class="h-4 w-4" aria-hidden="true" />
              </Button>
            </template>
          </li>
        </ul>
      </template>
    </div>

    <!-- Where the OTHER token is. An admin who came here for the install token
         (the acceptance criteria of #262 expected it here) needs the way on,
         not a section that silently does not have it. -->
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ t('external.connectionTokens.installTokenElsewhere') }}
      </p>
      <Button variant="ghost" size="sm" :to="connectTo">
        {{ t('external.sections.connect.title') }}
      </Button>
    </div>

    <!-- Issue a connection token: label + ceiling, warning on destructive. -->
    <Modal v-model="issueOpen" :title="t('external.connectionTokens.issue')">
      <label
        for="conn-token-label"
        class="block text-sm text-slate-700 dark:text-slate-300"
      >
        {{ t('external.connectionTokens.labelLabel') }}
        <input
          id="conn-token-label"
          v-model="label"
          :placeholder="t('external.connectionTokens.labelPlaceholder')"
          class="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          @keyup.enter="issueToken"
        />
      </label>
      <div class="mt-4">
        <span class="block text-sm text-slate-700 dark:text-slate-300">
          {{ t('external.connectionTokens.ceilingLabel') }}
        </span>
        <div class="mt-1">
          <SegmentedControl
            :model-value="ceiling"
            :aria-label="t('external.connectionTokens.ceilingLabel')"
            size="sm"
            :options="ceilingOptions"
            @update:model-value="(v: ExternalTokenCeiling) => (ceiling = v)"
          />
        </div>
        <p class="mt-2 text-xs text-slate-600 dark:text-slate-300">
          {{ t(`external.connectionTokens.ceilingHint.${ceiling}`) }}
        </p>
        <p
          v-if="ceiling === 'destructive'"
          class="mt-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
        >
          {{ t('external.connectionTokens.destructiveWarning') }}
        </p>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="secondary" @click="issueOpen = false">
          {{ t('common.cancel') }}
        </Button>
        <Button
          :disabled="busy || label.trim() === ''"
          :variant="ceiling === 'destructive' ? 'danger' : 'primary'"
          @click="issueToken"
        >
          <Spinner v-if="busy" class="h-4 w-4" />
          {{ t('external.connectionTokens.issue') }}
        </Button>
      </div>
    </Modal>

    <!-- The issued connection token — shown exactly once. -->
    <Modal
      v-model="issuedOpen"
      :title="t('external.connectionTokens.issuedTitle')"
    >
      <p class="text-sm text-slate-600 dark:text-slate-300">
        {{ t('external.connectionTokens.issuedHint') }}
      </p>
      <CopyField
        class="mt-3"
        :value="issuedValue"
        :aria-label="t('external.connectionTokens.issuedTitle')"
        @copied="onTokenCopied"
      />
      <div class="mt-4 flex justify-end">
        <Button @click="copyIssuedToken">
          {{ t('external.connectionTokens.copyAndClose') }}
        </Button>
      </div>
    </Modal>
  </SectionShell>
</template>
