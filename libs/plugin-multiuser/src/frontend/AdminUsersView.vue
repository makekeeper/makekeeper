<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ApiError,
  apiDownload,
  apiErrorMessage,
  apiJson,
  Badge,
  Button,
  Modal,
  PageHeader,
  Spinner,
  useConfirm,
  usePluginsStore,
  useSessionStore,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { AdminUserSummary } from '@makekeeper/plugin-contract';
import {
  Ban,
  Upload,
  KeyRound,
  Shield,
  ShieldOff,
  Trash2,
  Unlock,
  Users,
} from '@lucide/vue';

// Admin-only directory with per-account management: role, block, password
// reset and delete. The admin never sees the data itself — only aggregates.
// Self-directed actions (delete/demote/block yourself) are disabled in the UI
// and refused by the backend, so an instance can't lock itself out.
const { t, te, locale } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const session = useSessionStore();
const plugins = usePluginsStore();

const users = ref<AdminUserSummary[]>([]);
const loading = ref(true);
const busyId = ref<string | null>(null);

const selfId = computed<string | null>(() => session.user?.id ?? null);
const exchangeEnabled = computed<boolean>(() => plugins.isEnabled('exchange'));

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    users.value = await apiJson<AdminUserSummary[]>(
      '/api/multiuser/admin/users',
    );
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.admin.loadError')));
  } finally {
    loading.value = false;
  }
};

onMounted(load);

// The per-model matrix was mostly zeros — noise. What an admin needs at a
// glance is whether an account holds ANY data (a non-empty account can only be
// force-deleted), so the matrix collapses to one total; the full breakdown
// stays available as a hover tooltip. Labels resolve from i18n, falling back to
// the raw model name.
const modelLabel = (model: string): string => {
  const key = `multiuser.admin.modelCounts.${model}`;
  return te(key) ? t(key) : model;
};

const totalItems = (user: AdminUserSummary): number =>
  Object.values(user.counts.models).reduce((sum, n) => sum + n, 0);

// Per-model breakdown for the Data cell's tooltip — non-zero models only.
const dataBreakdown = (user: AdminUserSummary): string =>
  Object.entries(user.counts.models)
    .filter(([, count]) => count > 0)
    .map(([model, count]) => `${modelLabel(model)}: ${count}`)
    .join('\n');

const totalShares = (user: AdminUserSummary): number =>
  user.counts.grantsGiven + user.counts.grantsReceived;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale.value);

const displayName = (user: AdminUserSummary): string =>
  user.displayName ?? user.username;

// Action labels double as the icon button's accessible name AND its hover
// tooltip (title), so the icon-only controls are self-explanatory.
const roleActionLabel = (user: AdminUserSummary): string =>
  user.isAdmin
    ? t('multiuser.admin.revokeAdmin')
    : t('multiuser.admin.makeAdmin');
const blockActionLabel = (user: AdminUserSummary): string =>
  user.isBlocked ? t('multiuser.admin.unblock') : t('multiuser.admin.block');

const removeUser = (id: string): void => {
  users.value = users.value.filter((u) => u.id !== id);
};

// One shape for every row action: mark the row busy, run the request, patch the
// affected row IN PLACE on success (the endpoints return only `{ ok: true }`,
// so the update is derived locally), toast the outcome. No full-table reload —
// a single action must not re-fetch every user.
const runRowAction = async (
  user: AdminUserSummary,
  request: () => Promise<unknown>,
  successKey: string,
  applyLocal: () => void,
): Promise<void> => {
  busyId.value = user.id;
  try {
    await request();
    applyLocal();
    toast.success(t(successKey));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.admin.actionError')));
  } finally {
    busyId.value = null;
  }
};

const toggleRole = (user: AdminUserSummary): Promise<void> =>
  runRowAction(
    user,
    () =>
      apiJson(`/api/multiuser/admin/users/${user.id}/role`, {
        method: 'PATCH',
        body: { isAdmin: !user.isAdmin },
      }),
    'multiuser.admin.roleChanged',
    () => {
      user.isAdmin = !user.isAdmin;
    },
  );

const toggleBlock = (user: AdminUserSummary): Promise<void> =>
  runRowAction(
    user,
    () =>
      apiJson(`/api/multiuser/admin/users/${user.id}/blocked`, {
        method: 'PATCH',
        body: { blocked: !user.isBlocked },
      }),
    'multiuser.admin.blockChanged',
    () => {
      user.isBlocked = !user.isBlocked;
    },
  );

// ── Reset password ──────────────────────────────────────────────────────────
const resetTarget = ref<AdminUserSummary | null>(null);
const resetPassword = ref('');
const resetSaving = ref(false);
const resetOpen = computed<boolean>({
  get: () => resetTarget.value !== null,
  set: (open) => {
    if (!open) resetTarget.value = null;
  },
});
const openReset = (user: AdminUserSummary): void => {
  resetPassword.value = '';
  resetTarget.value = user;
};
const submitReset = async (): Promise<void> => {
  if (!resetTarget.value) return;
  resetSaving.value = true;
  try {
    await apiJson(
      `/api/multiuser/admin/users/${resetTarget.value.id}/password`,
      {
        method: 'POST',
        body: { password: resetPassword.value },
      },
    );
    toast.success(t('multiuser.admin.passwordReset'));
    resetTarget.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.admin.actionError')));
  } finally {
    resetSaving.value = false;
  }
};

// Per-user scope backup — a plain admin action available on every row, no longer
// buried inside the force-delete flow. Tracks its own busy id so only the row
// being exported shows a spinner.
const backupBusyId = ref<string | null>(null);

const downloadBackup = async (user: AdminUserSummary): Promise<void> => {
  backupBusyId.value = user.id;
  try {
    await apiDownload(
      '/api/exchange/admin/export-scope',
      { method: 'POST', body: { scopeId: user.id } },
      'backup.mkx',
    );
    toast.success(t('multiuser.admin.backupDownloaded'));
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.admin.backupError')));
  } finally {
    backupBusyId.value = null;
  }
};

// ── Delete (with force) ───────────────────────────────────────────────────────
const forceTarget = ref<AdminUserSummary | null>(null);
const forceDeleting = ref(false);
const forceOpen = computed<boolean>({
  get: () => forceTarget.value !== null,
  set: (open) => {
    if (!open) forceTarget.value = null;
  },
});

const requestDelete = async (user: AdminUserSummary): Promise<void> => {
  const ok = await confirm({
    message: t('multiuser.admin.deleteConfirm', { name: displayName(user) }),
    tone: 'danger',
  });
  if (!ok) return;
  busyId.value = user.id;
  try {
    await apiJson(`/api/multiuser/admin/users/${user.id}`, {
      method: 'DELETE',
    });
    removeUser(user.id);
    toast.success(t('multiuser.admin.deleted'));
  } catch (err) {
    // The user still owns data — escalate to the force-delete dialog, which
    // offers a backup before the cascade.
    if (err instanceof ApiError && err.status === 409) {
      forceTarget.value = user;
    } else {
      toast.error(apiErrorMessage(err, t('multiuser.admin.actionError')));
    }
  } finally {
    busyId.value = null;
  }
};

const forceDelete = async (): Promise<void> => {
  if (!forceTarget.value) return;
  forceDeleting.value = true;
  try {
    const deletedId = forceTarget.value.id;
    await apiJson(`/api/multiuser/admin/users/${deletedId}?force=true`, {
      method: 'DELETE',
    });
    removeUser(deletedId);
    toast.success(t('multiuser.admin.deleted'));
    forceTarget.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('multiuser.admin.actionError')));
  } finally {
    forceDeleting.value = false;
  }
};
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('multiuser.admin.title')"
      :subtitle="$t('multiuser.admin.subtitle')"
      :icon="Users"
    />

    <div v-if="loading" class="flex justify-center py-16">
      <Spinner :label="$t('common.loading')" />
    </div>

    <div v-else class="glass-card rounded-2xl overflow-x-auto">
      <!-- table-fixed: column widths are pinned, so a badge appearing/vanishing
           in the User cell (admin/block toggle) never reflows the other columns. -->
      <table class="w-full text-sm table-fixed">
        <colgroup>
          <col />
          <col class="w-32" />
          <col class="w-20" />
          <col class="w-48" />
          <col class="w-56" />
        </colgroup>
        <thead>
          <tr
            class="text-left text-xxs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5"
          >
            <th class="px-5 py-3 font-bold">
              {{ $t('multiuser.admin.user') }}
            </th>
            <th class="px-4 py-3 font-bold">
              {{ $t('multiuser.admin.registered') }}
            </th>
            <th class="px-4 py-3 font-bold text-right">
              {{ $t('multiuser.admin.data') }}
            </th>
            <th class="px-4 py-3 font-bold text-right">
              {{ $t('multiuser.admin.shares') }}
            </th>
            <th class="px-4 py-3 font-bold text-right">
              {{ $t('multiuser.admin.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-white/5">
          <tr v-for="user in users" :key="user.id">
            <td class="px-5 py-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900 dark:text-white">
                  {{ user.displayName ?? user.username }}
                </span>
                <Badge v-if="user.isAdmin" tone="brand">
                  {{ $t('multiuser.admin.adminBadge') }}
                </Badge>
                <Badge v-if="user.isBlocked" tone="warning">
                  {{ $t('multiuser.admin.blockedBadge') }}
                </Badge>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ user.username }}
              </p>
            </td>
            <td class="px-4 py-3 text-slate-600 dark:text-slate-300">
              {{ formatDate(user.createdAt) }}
            </td>
            <td class="px-4 py-3 text-right tabular-nums">
              <span
                v-if="totalItems(user) > 0"
                :title="dataBreakdown(user)"
                class="font-bold text-slate-700 dark:text-slate-200 cursor-default"
              >
                {{ totalItems(user) }}
              </span>
              <span v-else class="text-slate-300 dark:text-slate-600">—</span>
            </td>
            <td class="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
              <span v-if="totalShares(user) > 0">
                {{
                  $t('multiuser.admin.sharesCell', {
                    given: user.counts.grantsGiven,
                    received: user.counts.grantsReceived,
                  })
                }}
              </span>
              <span v-else class="text-slate-300 dark:text-slate-600">—</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-1 flex-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  :icon-left="user.isAdmin ? ShieldOff : Shield"
                  :aria-label="roleActionLabel(user)"
                  :title="roleActionLabel(user)"
                  :disabled="busyId === user.id || user.id === selfId"
                  @click="toggleRole(user)"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  :icon-left="user.isBlocked ? Unlock : Ban"
                  :aria-label="blockActionLabel(user)"
                  :title="blockActionLabel(user)"
                  :disabled="busyId === user.id || user.id === selfId"
                  @click="toggleBlock(user)"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  :icon-left="KeyRound"
                  :aria-label="$t('multiuser.admin.resetPassword')"
                  :title="$t('multiuser.admin.resetPassword')"
                  :disabled="busyId === user.id"
                  @click="openReset(user)"
                />
                <Button
                  v-if="exchangeEnabled"
                  variant="ghost"
                  size="sm"
                  :icon-left="Upload"
                  :aria-label="$t('multiuser.admin.downloadBackup')"
                  :title="$t('multiuser.admin.downloadBackup')"
                  :loading="backupBusyId === user.id"
                  :disabled="backupBusyId === user.id"
                  @click="downloadBackup(user)"
                />
                <Button
                  variant="danger"
                  size="sm"
                  :icon-left="Trash2"
                  :aria-label="$t('multiuser.admin.delete')"
                  :title="$t('multiuser.admin.delete')"
                  :disabled="busyId === user.id || user.id === selfId"
                  @click="requestDelete(user)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Reset password -->
    <Modal
      v-model="resetOpen"
      :title="
        resetTarget
          ? $t('multiuser.admin.resetPasswordTitle', {
              name: displayName(resetTarget),
            })
          : ''
      "
      width="sm"
    >
      <form class="space-y-4" @submit.prevent="submitReset">
        <div class="space-y-1.5">
          <label
            for="mu-reset-password"
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
          >
            {{ $t('multiuser.admin.newPassword') }}
          </label>
          <input
            id="mu-reset-password"
            v-model="resetPassword"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('multiuser.admin.newPasswordHint') }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="secondary" type="button" @click="resetOpen = false">
            {{ $t('common.cancel') }}
          </Button>
          <Button type="submit" :loading="resetSaving">
            {{ $t('multiuser.admin.resetPassword') }}
          </Button>
        </div>
      </form>
    </Modal>

    <!-- Force delete -->
    <Modal
      v-model="forceOpen"
      :title="
        forceTarget
          ? $t('multiuser.admin.forceDeleteTitle', {
              name: displayName(forceTarget),
            })
          : ''
      "
      width="md"
    >
      <div class="space-y-5">
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('multiuser.admin.forceDeleteWarning') }}
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" type="button" @click="forceOpen = false">
            {{ $t('common.cancel') }}
          </Button>
          <Button
            variant="danger"
            :loading="forceDeleting"
            @click="forceDelete"
          >
            {{ $t('multiuser.admin.forceDelete') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
