<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  apiErrorMessage,
  apiJson,
  useConfirm,
  useResource,
  useRouteQuery,
  useToastStore,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Refreshable,
  Spinner,
} from '@makekeeper/frontend-core';
import type {
  DiskBrowseEntry,
  DiskBrowseResult,
  DiskDeleteResult,
  DiskEntryKind,
} from '@makekeeper/plugin-contract';
import {
  ChevronRight,
  CornerLeftUp,
  FileIcon,
  Folder,
  FolderOpen,
  Trash2,
} from '@lucide/vue';
import { useFormatBytes } from './use-format-bytes';

// Browsing the uploads directory, one level at a time (#120).
//
// A flat list of orphans does not survive a real instance: a year of uploads is
// tens of thousands of files. The layout on disk is already a tree
// (<owner>/YYYY/MM/DD/), so each directory is shown ROLLED UP — one row saying
// "1,412 files, 3.1 GiB" — and only the level someone drills into is expanded.
//
// It opens as a DIALOG of fixed height rather than sitting on the page: inline,
// its height followed the number of files, so every drill-down shoved the
// sections below it up or down. A dialog also stops it competing with the three
// static summaries around it — as a panel among panels it read as a fourth
// summary, which is how the first cut of this failed.
//
// Selection works on paths, and the server re-derives what each path is when it
// deletes: a claimed or plugin-reserved file is refused there, not merely
// disabled here. The UI states the same rules so the outcome is never a
// surprise, but it is not what enforces them.

const props = defineProps<{
  modelValue: boolean;
  // Null until the report that carries it has loaded (the dialog can be opened
  // straight from the URL). The grace rule is then simply left unsaid rather
  // than stated from a number this component invented.
  graceHours: number | null;
  // Owned by the page, so the dialog and the page dim for the same beat.
  minRefreshMs: number;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'changed'): void;
}>();

const { t } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();

// Where we are is navigation state, so it lives in the URL (§5.3): a drill-down
// survives a reload, and Back walks out of the directory instead of leaving the
// page.
const path = useRouteQuery('dir');

const listing = useResource<DiskBrowseResult>(
  (signal) =>
    apiJson<DiskBrowseResult>(
      `/api/disk/browse?path=${encodeURIComponent(path.value)}`,
      { signal },
    ),
  {
    errorFallback: () => t('settings.disk.browser.loadFailed'),
    // Nothing is read until the dialog is open.
    enabled: computed(() => props.modelValue),
    // Drilling into a directory dims the current level rather than emptying the
    // dialog — otherwise every step down flashes a blank frame.
    keepPreviousData: true,
    minLoadingMs: props.minRefreshMs,
  },
);

watch(path, () => {
  if (props.modelValue) void listing.refetch();
});

// A selection does not survive a close: a pending deletion the user walked away
// from must not be sitting there waiting the next time they open the dialog.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) selected.value = new Map();
  },
);

// Selected paths with the size they carried when picked, so the footer and the
// confirm can state a total without re-reading a level the user has left.
const selected = ref(new Map<string, { bytes: number; files: number }>());

const selectedTotal = computed(() => {
  let bytes = 0;
  let files = 0;
  for (const entry of selected.value.values()) {
    bytes += entry.bytes;
    files += entry.files;
  }
  return { bytes, files };
});

const isSelected = (entry: DiskBrowseEntry): boolean =>
  selected.value.has(entry.path);

const setSelected = (entry: DiskBrowseEntry, picked: boolean): void => {
  const next = new Map(selected.value);
  if (picked)
    next.set(entry.path, {
      bytes: entry.deletableBytes,
      files: entry.deletableFiles,
    });
  else next.delete(entry.path);
  selected.value = next;
};

// Claimed and reserved rows cannot be picked at all; an orphan inside the grace
// window has nothing to delete yet, so picking it would promise nothing.
const canSelect = (entry: DiskBrowseEntry): boolean => entry.deletableFiles > 0;

const deletableHere = computed<boolean>(() =>
  (listing.data.value?.entries ?? []).some(canSelect),
);

const hasSelection = computed<boolean>(() => selected.value.size > 0);

const selectAllDeletable = (): void => {
  const next = new Map(selected.value);
  for (const entry of listing.data.value?.entries ?? []) {
    if (canSelect(entry)) {
      next.set(entry.path, {
        bytes: entry.deletableBytes,
        files: entry.deletableFiles,
      });
    }
  }
  selected.value = next;
};

const open = (entry: DiskBrowseEntry): void => {
  if (entry.isDirectory) path.value = entry.path;
};

const goUp = (): void => {
  const parent = listing.data.value?.parentPath;
  if (parent !== null && parent !== undefined) path.value = parent;
};

const crumbs = computed(() =>
  path.value
    .split('/')
    .filter(Boolean)
    .map((name, index, all) => ({
      name,
      path: all.slice(0, index + 1).join('/'),
    })),
);

// Colour alone must not carry the meaning, so every row also spells its kind
// out; the tone is there to make the page scannable, not to be the signal.
const KIND_TONE: Record<
  DiskEntryKind,
  'brand' | 'warning' | 'neutral' | 'success'
> = {
  claimed: 'brand',
  orphan: 'warning',
  unowned: 'neutral',
  reserved: 'success',
  mixed: 'neutral',
};

const formatBytes = useFormatBytes();

const deleting = ref(false);

const removeSelected = async (): Promise<void> => {
  const total = selectedTotal.value;
  const message = [
    t('settings.disk.browser.confirmMessage', {
      count: total.files,
      size: formatBytes(total.bytes),
    }),
    props.graceHours === null
      ? ''
      : t('settings.disk.browser.confirmRecent', { hours: props.graceHours }),
  ]
    .filter(Boolean)
    .join(' ');

  const ok = await confirm({
    title: t('settings.disk.browser.confirmTitle'),
    message,
    confirmLabel: t('settings.disk.browser.delete'),
    tone: 'danger',
  });
  if (!ok) return;

  deleting.value = true;
  try {
    const result = await apiJson<DiskDeleteResult>('/api/disk/delete', {
      method: 'POST',
      body: { paths: [...selected.value.keys()] },
    });
    toast.success(
      t('settings.disk.browser.deleted', {
        count: result.deleted.files,
        size: formatBytes(result.deleted.bytes),
      }),
    );
    // Every refusal is named: "deleted 3" and "deleted 3, kept 2 claimed" are
    // different outcomes, and the second one needs saying.
    const kept =
      result.skippedClaimed + result.skippedReserved + result.skippedRecent;
    if (kept > 0) {
      toast.info(
        t('settings.disk.browser.kept', {
          claimed: result.skippedClaimed,
          reserved: result.skippedReserved,
          recent: result.skippedRecent,
        }),
      );
    }
    if (result.failed > 0) {
      toast.error(t('settings.disk.browser.failed', { count: result.failed }));
    }
    selected.value = new Map();
    await listing.refetch();
    emit('changed');
  } catch (err) {
    toast.error(apiErrorMessage(err, t('settings.disk.browser.deleteFailed')));
  } finally {
    deleting.value = false;
  }
};
</script>

<template>
  <Modal
    :modelValue="modelValue"
    :title="$t('settings.disk.browser.title')"
    width="3xl"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <!-- Fixed height on purpose: the list is the only part that grows, so it
         scrolls inside a stable frame instead of resizing the dialog under the
         pointer every time a directory is opened. -->
    <div class="flex h-[60vh] flex-col overflow-hidden">
      <!-- Path bar + the two selection controls. The dialog carries the title,
           so this strip is only about WHERE you are and what is picked. -->
      <header
        class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]"
      >
        <FolderOpen class="h-4 w-4 shrink-0 text-brand-500" />

        <nav
          class="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-xs"
          :aria-label="$t('settings.disk.browser.pathLabel')"
        >
          <button
            type="button"
            class="rounded-lg px-1.5 py-0.5 font-mono text-slate-600 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-300 dark:hover:bg-white/10"
            :aria-current="path === '' ? 'location' : undefined"
            @click="path = ''"
          >
            {{ $t('settings.disk.browser.root') }}
          </button>
          <template v-for="(crumb, index) in crumbs" :key="crumb.path">
            <ChevronRight class="h-3 w-3 shrink-0 text-slate-400" />
            <button
              type="button"
              class="min-w-0 max-w-full truncate rounded-lg px-1.5 py-0.5 font-mono transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-white/10"
              :class="
                index === crumbs.length - 1
                  ? 'font-semibold text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              "
              :aria-current="
                index === crumbs.length - 1 ? 'location' : undefined
              "
              @click="path = crumb.path"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>

        <!-- Both selection controls live here, away from the destructive button
               in the footer: "Clear" next to "Delete" is a misclick waiting to
               happen, and the two do opposite things. -->
        <div class="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="!deletableHere"
            @click="selectAllDeletable()"
          >
            {{ $t('settings.disk.browser.selectAll') }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="!hasSelection"
            @click="selected = new Map()"
          >
            {{ $t('settings.disk.browser.clear') }}
          </Button>
        </div>
      </header>

      <div
        v-if="listing.loading.value && !listing.refreshing.value"
        class="flex flex-1 items-center justify-center"
      >
        <Spinner />
      </div>

      <p
        v-else-if="listing.error.value"
        class="flex-1 px-4 py-6 text-center text-xs text-red-700 dark:text-red-300"
      >
        {{ listing.error.value }}
      </p>

      <Refreshable
        v-else-if="listing.data.value"
        :refreshing="listing.refreshing.value"
        class="flex min-h-0 flex-1 flex-col"
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <!-- Column header: without it the numbers on the right are unlabelled. -->
          <div
            class="flex shrink-0 items-center gap-3 border-b border-slate-200 px-2 py-2 text-xxs font-bold uppercase tracking-wide text-slate-400 dark:border-white/10 dark:text-slate-500"
          >
            <span class="w-4 shrink-0" />
            <span class="min-w-0 flex-1">
              {{ $t('settings.disk.browser.columnName') }}
            </span>
            <span class="w-24 shrink-0 text-right">
              {{ $t('settings.disk.browser.columnFiles') }}
            </span>
            <span class="w-24 shrink-0 text-right">
              {{ $t('settings.disk.browser.columnSize') }}
            </span>
          </div>

          <!-- The only scrolling part, so the dialog's height never depends on
             how many files a directory happens to hold. -->
          <ul
            class="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-white/5"
          >
            <li v-if="listing.data.value.parentPath !== null">
              <button
                type="button"
                class="flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 dark:hover:bg-white/[0.04]"
                @click="goUp()"
              >
                <span class="w-4 shrink-0" />
                <CornerLeftUp class="h-4 w-4 shrink-0 text-slate-400" />
                <span class="text-sm text-slate-500 dark:text-slate-400">
                  {{ $t('settings.disk.browser.up') }}
                </span>
              </button>
            </li>

            <li
              v-for="entry in listing.data.value.entries"
              :key="entry.path"
              class="flex items-center gap-3 px-2 py-2.5 transition-colors"
              :class="
                isSelected(entry)
                  ? 'bg-brand-500/5 dark:bg-brand-500/10'
                  : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
              "
            >
              <Checkbox
                :modelValue="isSelected(entry)"
                :disabled="!canSelect(entry)"
                :ariaLabel="
                  $t('settings.disk.browser.select', { name: entry.name })
                "
                @update:modelValue="(v: boolean) => setSelected(entry, v)"
              />

              <!-- A directory is a link into itself: the whole cell is the target,
                   with a chevron saying so. A file is inert text. -->
              <button
                v-if="entry.isDirectory"
                type="button"
                class="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                @click="open(entry)"
              >
                <Folder class="h-4 w-4 shrink-0 text-brand-500" />
                <span
                  class="truncate text-sm font-medium text-slate-900 group-hover:underline dark:text-white"
                >
                  {{ entry.name }}
                </span>
                <ChevronRight
                  class="h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 dark:text-slate-600"
                />
              </button>
              <span v-else class="flex min-w-0 flex-1 items-center gap-2">
                <FileIcon class="h-4 w-4 shrink-0 text-slate-400" />
                <span
                  class="truncate font-mono text-xs text-slate-600 dark:text-slate-300"
                >
                  {{ entry.name }}
                </span>
              </span>

              <Badge :tone="KIND_TONE[entry.kind]" :uppercase="false">
                {{
                  entry.kind === 'reserved' && entry.reservedBy
                    ? entry.reservedBy
                    : $t(`settings.disk.browser.kind.${entry.kind}`)
                }}
              </Badge>

              <span
                class="w-24 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400"
              >
                {{
                  entry.isDirectory
                    ? $t('settings.disk.files', { count: entry.files })
                    : ''
                }}
              </span>
              <span
                class="w-24 shrink-0 text-right text-sm tabular-nums text-slate-900 dark:text-white"
              >
                {{ formatBytes(entry.bytes) }}
              </span>
            </li>
          </ul>

          <!-- Said out loud, because "Select all" below acts on the rows that
             are here — not on the ones that were cut. -->
          <p
            v-if="listing.data.value.truncated"
            class="shrink-0 border-t border-amber-200 bg-amber-50 px-2 py-2 text-xxs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {{
              $t('settings.disk.browser.truncated', {
                count: listing.data.value.entries.length,
              })
            }}
          </p>

          <EmptyState
            v-if="listing.data.value.entries.length === 0"
            :icon="Folder"
            :title="$t('settings.disk.browser.empty')"
          />
        </div>
      </Refreshable>

      <!-- Always here, with the button disabled rather than hidden: a control that
             appears only once you have guessed the gesture teaches nobody, and a
             footer popping in and out shifts the rows under the pointer. It carries
             the ONLY destructive action, kept at the opposite end of the panel from
             "Clear" — the two are one misclick apart in meaning. Tinted only once
             something is selected, so the panel reads as calm until then. -->
      <footer
        class="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors"
        :class="
          hasSelection
            ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
            : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]'
        "
      >
        <p
          class="text-xs font-medium"
          :class="
            hasSelection
              ? 'text-amber-900 dark:text-amber-200'
              : 'text-slate-500 dark:text-slate-400'
          "
        >
          {{
            hasSelection
              ? $t('settings.disk.browser.selection', {
                  count: selectedTotal.files,
                  size: formatBytes(selectedTotal.bytes),
                })
              : $t('settings.disk.browser.noSelection')
          }}
        </p>
        <Button
          variant="danger"
          size="sm"
          :iconLeft="Trash2"
          :loading="deleting"
          :disabled="!hasSelection"
          @click="removeSelected()"
        >
          {{ $t('settings.disk.browser.delete') }}
        </Button>
      </footer>
    </div>
  </Modal>
</template>
