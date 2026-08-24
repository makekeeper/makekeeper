<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  Button,
  EmptyState,
  Modal,
  Select,
  Spinner,
  getErrorMessage,
  useConfirm,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderTree,
  GripVertical,
  Plus,
  Trash2,
} from '@lucide/vue';
import { useProjectGroupsStore } from './project-groups-store';
import {
  buildGroupTreeRows,
  type ProjectGroupDto,
  type ProjectGroupTreeRow,
} from '../project-groups';

// Where project groups are managed (#289): the projects plugin's own section of
// Settings → General, next to every other plugin's settings surface. The
// projects list header links here rather than owning a second screen of its own.
//
// This is a settings PANEL, so it renders bare content — the host draws the
// frame, the section title and the picker around it.
//
// The drag follows the category tree's pattern (#205): the row under the
// pointer splits into thirds — top inserts before, bottom after, the middle
// files the group inside. The parent Select in the create dialog and the
// Alt+↑/↓ handle are the keyboard paths to the same two moves.

const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();
const store = useProjectGroupsStore();

const loading = computed(() => store.loading && !store.loaded);
const failed = computed(() => store.failed && !store.loaded);

// A failed load must not read as "no groups yet": the page says so, and offers
// the retry the store deliberately does not perform on its own.
async function load(): Promise<void> {
  try {
    await store.refresh();
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

if (!store.loaded) void load();

// A drop rewrites the tree locally first, so the moved row lands where it was
// released with no round-trip flicker; the next fetch takes over again.
const localGroups = ref<ProjectGroupDto[] | null>(null);
const tree = computed<ProjectGroupDto[]>(
  () => localGroups.value ?? store.groups,
);

const childrenOf = computed<Map<string | null, ProjectGroupDto[]>>(() => {
  const map = new Map<string | null, ProjectGroupDto[]>();
  for (const group of tree.value) {
    const siblings = map.get(group.parentId) ?? [];
    siblings.push(group);
    map.set(group.parentId, siblings);
  }
  for (const siblings of map.values()) {
    siblings.sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  }
  return map;
});

// Collapsed branches: a viewing convenience, so component state rather than
// route state.
const collapsed = ref(new Set<string>());

function toggleCollapsed(id: string): void {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

type TreeRow = ProjectGroupTreeRow;

const rows = computed<TreeRow[]>(() =>
  buildGroupTreeRows(tree.value, collapsed.value),
);

async function reload(): Promise<void> {
  localGroups.value = null;
  await store.refresh();
}

// ── Rename, in place ───────────────────────────────────────────────────────
// Committed on blur and on Enter; Escape restores what the server holds.
const renameDraft = ref<Record<string, string>>({});

const nameOf = (group: ProjectGroupDto): string =>
  renameDraft.value[group.id] ?? group.name;

function onNameInput(group: ProjectGroupDto, event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  renameDraft.value = { ...renameDraft.value, [group.id]: input.value };
}

function cancelRename(group: ProjectGroupDto, event: KeyboardEvent): void {
  const { [group.id]: _dropped, ...rest } = renameDraft.value;
  renameDraft.value = rest;
  if (event.target instanceof HTMLElement) event.target.blur();
}

async function commitRename(group: ProjectGroupDto): Promise<void> {
  const draft = renameDraft.value[group.id];
  if (draft === undefined) return;
  const name = draft.trim();
  const { [group.id]: _dropped, ...rest } = renameDraft.value;
  renameDraft.value = rest;
  if (!name || name === group.name) return;
  try {
    await store.update(group.id, { name });
    toast.success(t('projects.groups.renamed'));
  } catch (err) {
    toast.error(getErrorMessage(err));
    await reload();
  }
}

function blurOnEnter(event: KeyboardEvent): void {
  if (event.target instanceof HTMLElement) event.target.blur();
}

// ── Create ─────────────────────────────────────────────────────────────────
const createOpen = ref(false);
const createName = ref('');
const createParentId = ref('');
const saving = ref(false);
const createNameInput = ref<HTMLInputElement | null>(null);

// The store owns the one tree walk; "no parent" is a real absence, so it is an
// `empty` row rather than a label pretending to be a place (§5.4).
const parentOptions = computed(() => [
  { value: '', label: t('projects.groups.noParent'), empty: true },
  ...store.options,
]);

function openCreate(parentId: string | null = null): void {
  createName.value = '';
  createParentId.value = parentId ?? '';
  createOpen.value = true;
  void nextTick(() => createNameInput.value?.focus());
}

async function createGroup(): Promise<void> {
  const name = createName.value.trim();
  if (!name || saving.value) return;
  saving.value = true;
  try {
    await store.create({ name, parentId: createParentId.value || null });
    createOpen.value = false;
    toast.success(t('projects.groups.created'));
  } catch (err) {
    toast.error(getErrorMessage(err));
  } finally {
    saving.value = false;
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────
// The confirmation names what moves and where — a folder disappearing must
// never look like it might take projects with it.
async function removeGroup(group: ProjectGroupDto): Promise<void> {
  let preview: Awaited<ReturnType<typeof store.deletePreview>>;
  try {
    preview = await store.deletePreview(group.id);
  } catch (err) {
    toast.error(getErrorMessage(err));
    return;
  }
  const destination = store.byId.get(preview.destinationId);
  const ok = await confirm({
    title: t('projects.groups.deleteTitle', { name: group.name }),
    message: t('projects.groups.deleteMessage', {
      projects: preview.projects,
      subgroups: preview.subgroups,
      destination: destination?.name ?? '',
    }),
    tone: 'danger',
    confirmLabel: t('projects.groups.deleteConfirm'),
  });
  if (!ok) return;
  try {
    await store.remove(group.id);
    toast.success(t('projects.groups.deleted'));
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

// ── Drag and drop ──────────────────────────────────────────────────────────
type DropZone = 'before' | 'after' | 'inside';

const draggedId = ref<string | null>(null);
const dropTarget = ref<{ id: string; zone: DropZone } | null>(null);

// The dragged node and its subtree — a drop there would re-file the branch
// into itself, which the server refuses anyway.
const dragForbidden = computed<Set<string>>(() => {
  const set = new Set<string>();
  if (!draggedId.value) return set;
  const collect = (id: string): void => {
    set.add(id);
    for (const child of childrenOf.value.get(id) ?? []) collect(child.id);
  };
  collect(draggedId.value);
  return set;
});

function clearDrag(): void {
  draggedId.value = null;
  dropTarget.value = null;
}

function onRowDragStart(event: DragEvent, row: TreeRow): void {
  draggedId.value = row.group.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Some engines refuse to start a drag with an empty store; the id is also
    // held in the ref because dragover may not read the payload.
    event.dataTransfer.setData('text/plain', row.group.id);
  }
}

function onRowDragOver(event: DragEvent, row: TreeRow): void {
  if (!draggedId.value) return;
  if (dragForbidden.value.has(row.group.id)) {
    dropTarget.value = null;
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const third = rect.height / 3;
  const zone: DropZone =
    y < third ? 'before' : y > rect.height - third ? 'after' : 'inside';
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = { id: row.group.id, zone };
}

function onTreeDragLeave(event: DragEvent): void {
  // Only when the pointer leaves the card itself — moving between rows fires
  // dragleave too, and clearing then would make the drop line flicker.
  const target = event.currentTarget;
  if (
    target instanceof HTMLElement &&
    !(
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    )
  ) {
    dropTarget.value = null;
  }
}

async function applyOrder(
  parentId: string | null,
  orderedIds: string[],
  movedId: string,
): Promise<void> {
  const positionById = new Map(orderedIds.map((id, index) => [id, index]));
  localGroups.value = tree.value.map((group) => {
    const position = positionById.get(group.id);
    if (group.id === movedId) {
      return { ...group, parentId, position: position ?? group.position };
    }
    return position === undefined ? group : { ...group, position };
  });
  try {
    await store.reorder({ parentId, orderedIds, movedId });
    localGroups.value = null;
  } catch (err) {
    // The server refused the move (cycle, name collision) — the optimistic
    // copy is now a lie.
    toast.error(getErrorMessage(err));
    await reload();
  }
}

async function onRowDrop(row: TreeRow): Promise<void> {
  const dragged = draggedId.value;
  const target = dropTarget.value;
  clearDrag();
  if (!dragged || !target || target.id !== row.group.id) return;

  const parentId = target.zone === 'inside' ? row.group.id : row.group.parentId;
  const siblings = (childrenOf.value.get(parentId) ?? [])
    .map((group) => group.id)
    .filter((id) => id !== dragged);
  let index = siblings.length;
  if (target.zone !== 'inside') {
    const at = siblings.indexOf(row.group.id);
    if (at !== -1) index = at + (target.zone === 'after' ? 1 : 0);
  }
  siblings.splice(index, 0, dragged);
  // A branch that just swallowed a node has to show it landing.
  if (target.zone === 'inside') {
    const next = new Set(collapsed.value);
    next.delete(row.group.id);
    collapsed.value = next;
  }
  await applyOrder(parentId, siblings, dragged);
}

// The keyboard equivalent of the drag: HTML5 drag-and-drop is pointer-only, so
// without this the sibling order is unreachable without a mouse.
async function moveGroup(row: TreeRow, delta: number): Promise<void> {
  const parentId = row.group.parentId;
  const siblings = (childrenOf.value.get(parentId) ?? []).map(
    (group) => group.id,
  );
  const from = siblings.indexOf(row.group.id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= siblings.length) return;
  siblings.splice(to, 0, ...siblings.splice(from, 1));
  await applyOrder(parentId, siblings, row.group.id);
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start justify-between gap-4">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('projects.groups.subtitle') }}
      </p>
      <Button size="sm" :icon-left="Plus" @click="openCreate()">
        {{ $t('projects.groups.add') }}
      </Button>
    </div>

    <Spinner v-if="loading" />

    <EmptyState
      v-else-if="failed"
      :icon="FolderTree"
      :title="$t('projects.groups.loadFailedTitle')"
      :description="$t('projects.groups.loadFailedDescription')"
    >
      <template #action>
        <Button variant="secondary" @click="load">
          {{ $t('projects.groups.retry') }}
        </Button>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="!rows.length"
      :icon="FolderTree"
      :title="$t('projects.groups.emptyTitle')"
      :description="$t('projects.groups.emptyDescription')"
    />

    <div v-else class="glass-card rounded-2xl p-2" @dragleave="onTreeDragLeave">
      <!-- The drop indicator stays an overlaid line rather than a border, so
           inserting between two rows never nudges the list. -->
      <ul class="space-y-0.5">
        <li
          v-for="row in rows"
          :key="row.group.id"
          class="group relative"
          draggable="true"
          @dragstart="onRowDragStart($event, row)"
          @dragend="clearDrag"
          @dragover="onRowDragOver($event, row)"
          @drop.prevent="onRowDrop(row)"
        >
          <!-- Drop indicator, overlaid so the rail below stays unbroken. -->
          <span
            v-if="
              dropTarget?.id === row.group.id && dropTarget?.zone !== 'inside'
            "
            class="absolute inset-x-0 h-0.5 bg-brand-500 dark:bg-brand-400"
            :class="dropTarget?.zone === 'before' ? 'top-0' : 'bottom-0'"
            aria-hidden="true"
          />
          <div class="flex items-stretch">
            <!-- No guide lines: the hierarchy is carried by the indent and by
                 the folder icon, which doubles as the open/closed state — the
                 file-manager reading of a tree. -->
            <span
              v-if="row.depth > 0"
              class="shrink-0"
              :style="{ width: `${row.depth * 1.25}rem` }"
              aria-hidden="true"
            />
            <div
              class="flex flex-1 min-w-0 items-center gap-1 rounded-xl pl-1 pr-2 py-1 transition-colors text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
              :class="[
                dropTarget?.id === row.group.id && dropTarget?.zone === 'inside'
                  ? 'bg-brand-500/10 ring-1 ring-brand-500/40'
                  : '',
                draggedId === row.group.id ? 'opacity-40' : '',
              ]"
            >
              <button
                v-if="row.hasChildren"
                type="button"
                class="shrink-0 rounded-xl p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-expanded="row.expanded"
                :aria-label="
                  row.expanded
                    ? $t('projects.groups.collapse')
                    : $t('projects.groups.expand')
                "
                @click.stop="toggleCollapsed(row.group.id)"
              >
                <ChevronRight
                  class="w-3.5 h-3.5 transition-transform"
                  :class="row.expanded ? 'rotate-90' : ''"
                />
              </button>
              <span v-else class="p-1 shrink-0" aria-hidden="true">
                <ChevronRight class="w-3.5 h-3.5 invisible" />
              </span>

              <component
                :is="row.hasChildren && row.expanded ? FolderOpen : Folder"
                class="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />

              <!-- Renaming happens where the name is (no second screen); the
                 input is the row. -->
              <input
                :value="nameOf(row.group)"
                type="text"
                maxlength="100"
                :aria-label="$t('projects.groups.nameLabel')"
                class="min-w-0 flex-1 bg-transparent rounded-xl px-2 py-1 text-sm border border-transparent hover:border-slate-200 dark:hover:border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :class="row.depth === 0 ? 'font-medium' : ''"
                @input="onNameInput(row.group, $event)"
                @keydown.enter.prevent="blurOnEnter"
                @keydown.esc.prevent="cancelRename(row.group, $event)"
                @blur="commitRename(row.group)"
              />

              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('projects.groups.addChild')"
                @click="openCreate(row.group.id)"
              >
                <Plus class="w-3.5 h-3.5" />
              </Button>
              <!-- General is the destination of everything a delete lifts, so it
                 has no delete action at all — not a disabled one. -->
              <Button
                v-if="!row.group.isDefault"
                variant="dangerGhost"
                size="icon-sm"
                :aria-label="$t('projects.groups.delete')"
                @click="removeGroup(row.group)"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </Button>
              <!-- A real button, not decoration: the drag is pointer-only, so
                 this is the keyboard path to the sibling order (Alt+↑/↓). -->
              <button
                type="button"
                class="shrink-0 cursor-grab rounded-xl p-0.5 text-slate-500 dark:text-slate-400 opacity-40 transition-opacity md:opacity-0 md:group-hover:opacity-40 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-label="$t('projects.groups.reorder')"
                @keydown.alt.up.prevent="moveGroup(row, -1)"
                @keydown.alt.down.prevent="moveGroup(row, 1)"
              >
                <GripVertical class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <Modal v-model="createOpen" :title="$t('projects.groups.add')">
      <div class="space-y-4">
        <div class="space-y-1.5">
          <label
            for="project-group-name"
            class="block text-sm text-slate-600 dark:text-slate-300"
          >
            {{ $t('projects.groups.nameLabel') }}
          </label>
          <input
            id="project-group-name"
            ref="createNameInput"
            v-model="createName"
            type="text"
            maxlength="100"
            class="w-full glass-input rounded-xl px-3 py-2 text-sm"
            @keydown.enter.prevent="createGroup"
          />
        </div>
        <div class="space-y-1.5">
          <label class="block text-sm text-slate-600 dark:text-slate-300">
            {{ $t('projects.groups.parentLabel') }}
          </label>
          <Select
            v-model="createParentId"
            :options="parentOptions"
            :aria-label="$t('projects.groups.parentLabel')"
          />
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="createOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button
          variant="primary"
          :disabled="saving || !createName.trim()"
          @click="createGroup"
        >
          {{ $t('common.save') }}
        </Button>
      </template>
    </Modal>
  </div>
</template>
