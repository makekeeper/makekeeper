<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  apiJson,
  useConfirm,
  useResource,
  useRouteQuery,
  usePluginsStore,
  useToastStore,
  resolvePluginIcon,
  Button,
  EmptyState,
  PageHeader,
  Refreshable,
  Spinner,
} from '@makekeeper/frontend-core';
import type {
  DiskCleanupResult,
  DiskUsageReport,
} from '@makekeeper/plugin-contract';
import {
  HardDrive,
  RefreshCw,
  AlertTriangle,
  Trash2,
  FolderOpen,
} from '@lucide/vue';
import DiskBrowser from './DiskBrowser.vue';
import { useFormatBytes } from './use-format-bytes';

// Shortest time the dimmed-and-spinning state stays up. Long enough for the
// blur to finish its 200 ms transition and for the spinner to register as a
// spinner; short enough that a refresh does not feel like a page load. Both
// surfaces on this page share it so they never disagree about what "updating"
// looks like.
const MIN_REFRESH_MS = 800;

// Admin: where the disk is going (#120), plus the one cleanup that needs no
// retention policy — sweeping files no record claims. Nothing else is deletable
// here: since #113 the backend keeps the original of every uploaded image from
// every surface, and an original cannot be regenerated, so what (if anything)
// ages out is a separate decision this page exists to inform.
//
// Admin-only in multi-user mode (nav + route meta); in single-user mode the one
// user is the admin.

const { t } = useI18n();
const plugins = usePluginsStore();

// The dialog's open state is navigation state (§5.3): it rides in the URL, so
// Back closes the browser instead of leaving the page, and a drilled-into
// directory survives a reload.
const browsing = useRouteQuery('browse');

const report = useResource<DiskUsageReport>(
  (signal) => apiJson<DiskUsageReport>('/api/disk/usage', { signal }),
  {
    errorFallback: () => t('settings.disk.loadFailed'),
    // A refresh dims the figures in place instead of tearing them off screen —
    // see the overlay below.
    keepPreviousData: true,
    minLoadingMs: MIN_REFRESH_MS,
  },
);

// Scope ids are user ids, but naming users is the multiuser plugin's business —
// so the label is resolved only while it is enabled, and the raw id is shown
// otherwise (§5.10: gate on the plugin, never import it).
interface AdminUser {
  id: string;
  username: string;
  displayName?: string | null;
}

const users = useResource<AdminUser[]>(
  (signal) => apiJson<AdminUser[]>('/api/multiuser/admin/users', { signal }),
  { enabled: computed(() => plugins.isEnabled('multiuser')) },
);

const scopeLabel = (scopeId: string | null): string => {
  if (!scopeId) return t('settings.disk.scopeUnowned');
  const user = users.data.value?.find((u) => u.id === scopeId);
  return user ? (user.displayName ?? user.username) : scopeId;
};

const formatBytes = useFormatBytes();

const share = (bytes: number): number => {
  const total = report.data.value?.total.bytes ?? 0;
  return total > 0 ? Math.round((bytes / total) * 100) : 0;
};

interface CompositionRow {
  key: 'originals' | 'derivatives' | 'unreferenced' | 'unowned' | 'reserved';
  bytes: number;
  files: number;
  // Derivatives are regenerable, originals are not, and unreferenced bytes are
  // claimed by nothing — the ordering a cleanup would reverse.
  tone: string;
}

const composition = computed<CompositionRow[]>(() => {
  const data = report.data.value;
  if (!data) return [];
  return [
    { key: 'originals', ...data.originals, tone: 'bg-brand-500' },
    { key: 'derivatives', ...data.derivatives, tone: 'bg-emerald-500' },
    { key: 'unreferenced', ...data.unreferenced, tone: 'bg-amber-500' },
    // Only when there is something there: on most instances nothing else
    // writes into the uploads root, and permanent zero rows would be noise.
    ...(data.unowned.files > 0
      ? [{ key: 'unowned' as const, ...data.unowned, tone: 'bg-slate-400' }]
      : []),
    ...(data.reserved.files > 0
      ? [{ key: 'reserved' as const, ...data.reserved, tone: 'bg-slate-300' }]
      : []),
  ];
});

// Each row is named and iconed by the OWNING PLUGIN's own manifest, so a
// plugin never has to be listed here twice — and a disabled plugin still shows
// its bytes, because disabling it does not free them.
const owners = computed(() => {
  const data = report.data.value;
  if (!data) return [];
  return data.byOwner.map((owner) => {
    const manifest = owner.pluginId ? plugins.byId[owner.pluginId] : undefined;
    return {
      ...owner,
      icon: manifest?.icon ?? null,
      // An id with no manifest is a plugin that has since been removed: the id
      // itself is the most honest label left.
      label: manifest
        ? t(manifest.nameKey)
        : (owner.pluginId ?? t('settings.disk.ownerUndeclared')),
    };
  });
});

// Sweeping the files no record claims. Deletion is irreversible even when what
// it deletes is unreachable, so it goes through the shared confirm host — and
// the result is reported honestly: a sweep that skipped everything as too
// recent must not read as "freed 0 B, nothing to do".
const cleaning = ref(false);
const confirm = useConfirm();
const toast = useToastStore();

const purge = async (): Promise<void> => {
  const data = report.data.value;
  if (!data) return;
  // The dialog promises exactly what the sweep will do — the purgeable figure,
  // never the whole unreferenced total, and the kept remainder said out loud.
  const message = [
    t('settings.disk.cleanup.confirmMessage', {
      count: data.unreferencedPurgeable.files,
      size: formatBytes(data.unreferencedPurgeable.bytes),
    }),
    data.unreferencedRecent.files > 0
      ? t('settings.disk.cleanup.confirmKept', {
          count: data.unreferencedRecent.files,
          size: formatBytes(data.unreferencedRecent.bytes),
          hours: data.orphanGraceHours,
        })
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const ok = await confirm({
    title: t('settings.disk.cleanup.confirmTitle'),
    message,
    confirmLabel: t('settings.disk.cleanup.action'),
    tone: 'danger',
  });
  if (!ok) return;
  cleaning.value = true;
  try {
    const result = await apiJson<DiskCleanupResult>('/api/disk/unreferenced', {
      method: 'DELETE',
    });
    toast.success(
      t('settings.disk.cleanup.done', {
        count: result.deleted.files,
        size: formatBytes(result.deleted.bytes),
      }),
    );
    if (result.skippedRecent > 0) {
      toast.info(
        t('settings.disk.cleanup.skipped', { count: result.skippedRecent }),
      );
    }
    if (result.failed > 0) {
      toast.error(t('settings.disk.cleanup.failed', { count: result.failed }));
    }
    await report.refetch();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('settings.disk.cleanup.error')));
  } finally {
    cleaning.value = false;
  }
};
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      :title="$t('settings.disk.title')"
      :subtitle="$t('settings.disk.subtitle')"
      :icon="HardDrive"
    >
      <template #actions>
        <Button
          variant="secondary"
          :iconLeft="RefreshCw"
          :disabled="report.loading.value"
          @click="report.refetch()"
        >
          {{ $t('settings.disk.refresh') }}
        </Button>
      </template>
    </PageHeader>

    <div
      v-if="report.loading.value && !report.refreshing.value"
      class="flex justify-center py-16"
    >
      <Spinner />
    </div>

    <EmptyState
      v-else-if="report.error.value"
      :icon="AlertTriangle"
      :title="report.error.value"
    >
      <template #action>
        <Button
          variant="secondary"
          :iconLeft="RefreshCw"
          @click="report.refetch()"
        >
          {{ $t('settings.disk.refresh') }}
        </Button>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="report.data.value && report.data.value.total.files === 0"
      :icon="HardDrive"
      :title="$t('settings.disk.emptyTitle')"
      :description="$t('settings.disk.emptyHint')"
    />

    <!-- A refresh keeps the figures on screen and dims them (Refreshable): the
         numbers being replaced are the same numbers, so blanking the section
         would read as a navigation and make the page jump. -->
    <Refreshable
      v-else-if="report.data.value"
      :refreshing="report.refreshing.value"
    >
      <div class="space-y-8">
        <!-- Total, and what it is made of -->
        <section class="glass-card rounded-2xl p-6 space-y-5">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p
                class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                {{ $t('settings.disk.total') }}
              </p>
              <p class="text-3xl font-bold text-slate-900 dark:text-white">
                {{ formatBytes(report.data.value.total.bytes) }}
              </p>
            </div>
            <p class="min-w-0 text-xs text-slate-500 dark:text-slate-400">
              {{
                $t('settings.disk.files', {
                  count: report.data.value.total.files,
                })
              }}
              ·
              <code class="font-mono break-all">{{
                report.data.value.root
              }}</code>
            </p>
          </div>

          <!-- One bar, three parts: the shape of the retention question. Purely a
             restatement of the list below, so it is hidden from assistive tech
             rather than duplicating every figure as a colour-only signal. -->
          <div
            aria-hidden="true"
            class="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5"
          >
            <div
              v-for="part in composition"
              :key="part.key"
              :class="part.tone"
              :style="{ width: `${share(part.bytes)}%` }"
            />
          </div>

          <dl class="grid gap-4 sm:grid-cols-3">
            <div v-for="part in composition" :key="part.key" class="space-y-1">
              <dt
                class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
              >
                <span
                  aria-hidden="true"
                  :class="[part.tone, 'h-2.5 w-2.5 rounded-full']"
                />
                {{ $t(`settings.disk.composition.${part.key}`) }}
              </dt>
              <!-- The hint lives inside the <dd>: a `dl > div` may only hold
                 dt/dd elements, so a sibling <p> here is invalid markup. -->
              <dd class="space-y-1">
                <p class="text-lg font-semibold text-slate-900 dark:text-white">
                  {{ formatBytes(part.bytes) }}
                  <span
                    class="text-xs font-normal text-slate-500 dark:text-slate-400"
                  >
                    {{ $t('settings.disk.files', { count: part.files }) }}
                  </span>
                </p>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ $t(`settings.disk.compositionHint.${part.key}`) }}
                </p>
              </dd>
            </div>
          </dl>

          <p
            v-if="report.data.value.missingFiles > 0"
            class="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            {{
              $t('settings.disk.missingFiles', {
                count: report.data.value.missingFiles,
              })
            }}
          </p>

          <!-- Always here, both of them: browsing is how you find out what is on
             disk, so it must not depend on there being something to sweep, and
             a delete button that comes and goes teaches nobody where it lives.
             The sweep is disabled instead, with the line on the left saying why. -->
          <div
            class="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-white/10"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="space-y-1">
                <p class="text-xs text-slate-600 dark:text-slate-300">
                  {{
                    report.data.value.unreferencedPurgeable.files > 0
                      ? $t('settings.disk.cleanup.hint', {
                          count: report.data.value.unreferencedPurgeable.files,
                          size: formatBytes(
                            report.data.value.unreferencedPurgeable.bytes,
                          ),
                        })
                      : $t('settings.disk.cleanup.none')
                  }}
                </p>
                <p
                  v-if="report.data.value.unreferencedRecent.files > 0"
                  class="text-xs text-slate-500 dark:text-slate-400"
                >
                  {{
                    $t('settings.disk.cleanup.keptHint', {
                      count: report.data.value.unreferencedRecent.files,
                      hours: report.data.value.orphanGraceHours,
                    })
                  }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  :iconLeft="FolderOpen"
                  @click="browsing = '1'"
                >
                  {{ $t('settings.disk.browser.open') }}
                </Button>
                <Button
                  variant="danger"
                  :iconLeft="Trash2"
                  :loading="cleaning"
                  :disabled="
                    report.data.value.unreferencedPurgeable.files === 0
                  "
                  @click="purge()"
                >
                  {{ $t('settings.disk.cleanup.action') }}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <!-- Subtrees a plugin declared as its own. Short by nature — one line per
           area — so it stays on the page rather than behind a disclosure. -->
        <section
          v-if="report.data.value.reservedAreas.length > 0"
          class="space-y-2"
        >
          <h3 class="text-sm font-bold text-slate-900 dark:text-white">
            {{ $t('settings.disk.reserved.title') }}
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ $t('settings.disk.reserved.hint') }}
          </p>
          <ul class="space-y-1">
            <li
              v-for="area in report.data.value.reservedAreas"
              :key="area.path"
              class="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 text-xs dark:border-white/10"
            >
              <code class="min-w-0 flex-1 truncate font-mono">{{
                area.path
              }}</code>
              <span class="shrink-0 text-slate-500 dark:text-slate-400">
                {{
                  $t('settings.disk.reserved.owner', { plugin: area.pluginId })
                }}
              </span>
              <span
                class="w-20 shrink-0 text-right font-semibold text-slate-900 dark:text-white"
              >
                {{ formatBytes(area.bytes) }}
              </span>
            </li>
          </ul>
        </section>

        <!-- By owner -->
        <section class="space-y-3">
          <h3 class="text-sm font-bold text-slate-900 dark:text-white">
            {{ $t('settings.disk.byOwner') }}
          </h3>
          <!-- Column header: the two halves are the point of this table, and
             without naming them the pair of numbers is unreadable. -->
          <div
            class="flex items-center gap-3 px-4 text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            <span class="h-4 w-4 shrink-0" />
            <span class="min-w-0 flex-1">
              {{ $t('settings.disk.ownerColumns.plugin') }}
            </span>
            <span class="w-24 shrink-0 text-right">
              {{ $t('settings.disk.composition.originals') }}
            </span>
            <span class="w-24 shrink-0 text-right">
              {{ $t('settings.disk.composition.derivatives') }}
            </span>
          </div>
          <ul class="space-y-2">
            <li
              v-for="owner in owners"
              :key="owner.pluginId ?? 'undeclared'"
              class="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10"
            >
              <component
                :is="resolvePluginIcon(owner.icon)"
                class="h-4 w-4 shrink-0 text-slate-400"
              />
              <span
                class="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200"
              >
                {{ owner.label }}
              </span>
              <!-- Originals carry the weight: they are what cannot be
                 regenerated, so they read as the primary number. -->
              <span
                class="w-24 shrink-0 text-right text-sm font-semibold text-slate-900 dark:text-white"
              >
                {{ formatBytes(owner.originals.bytes) }}
              </span>
              <span
                class="w-24 shrink-0 text-right text-sm text-slate-500 dark:text-slate-400"
              >
                {{ formatBytes(owner.derivatives.bytes) }}
              </span>
            </li>
          </ul>
        </section>

        <!-- By scope -->
        <section v-if="report.data.value.byScope.length > 0" class="space-y-3">
          <h3 class="text-sm font-bold text-slate-900 dark:text-white">
            {{ $t('settings.disk.byScope') }}
          </h3>
          <ul class="space-y-2">
            <li
              v-for="scope in report.data.value.byScope"
              :key="scope.scopeId ?? 'unowned'"
              class="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10"
            >
              <span
                class="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200"
              >
                {{ scopeLabel(scope.scopeId) }}
              </span>
              <span class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {{ $t('settings.disk.files', { count: scope.files }) }}
              </span>
              <span
                class="w-24 shrink-0 text-right text-sm font-semibold text-slate-900 dark:text-white"
              >
                {{ formatBytes(scope.bytes) }}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </Refreshable>

    <DiskBrowser
      :minRefreshMs="MIN_REFRESH_MS"
      :modelValue="browsing === '1'"
      :graceHours="report.data.value?.orphanGraceHours ?? null"
      @update:modelValue="browsing = $event ? '1' : ''"
      @changed="report.refetch()"
    />
  </div>
</template>
