<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  PageTabs,
  PluginSlot,
  Select,
  Spinner,
  Switch,
  apiFetch,
  apiJson,
  buildTreeOptions,
  getErrorMessage,
  useConfirm,
  useResource,
  useRouteQuery,
  useToastStore,
} from '@makekeeper/frontend-core';
import {
  formatObjectRef,
  type SlotFieldCommit,
} from '@makekeeper/plugin-contract';
import { useI18n } from 'vue-i18n';
import {
  Asterisk,
  ChevronRight,
  FolderTree,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from '@lucide/vue';
import {
  CATEGORY_MAX_DEPTH,
  CATEGORY_PROPERTY_ENTITY,
  CATEGORY_PROPERTY_TYPES,
  type CategoryPropertyDto,
  type CategoryPropertyType,
  type EffectiveProperty,
  type ItemCategoryDto,
} from '../categories';
import { INVENTORY_TABS } from './tabs';

// The category vocabulary and the property set each category owns (#205).
// The category IS the template — that is why this screen edits properties in
// place on the tree instead of sending the person to a second "templates" page.

const { t } = useI18n();
const toast = useToastStore();
const confirm = useConfirm();

const categories = useResource<ItemCategoryDto[]>(
  () => apiJson<ItemCategoryDto[]>('/api/item-categories'),
  { refetchOn: ['agent-data', 'scope'], keepPreviousData: true },
);

// Route-driven, not component state (§5.3): the selected node survives a
// reload, is linkable, and is where an `mk://inventory/category/<id>` ref lands.
const selectedIdQuery = useRouteQuery('id', { default: '' });
const selectedId = computed<string | null>({
  get: () => selectedIdQuery.value || null,
  set: (value) => {
    selectedIdQuery.value = value ?? '';
  },
});
const hasSelection = computed(() => selectedId.value !== null);

// A drop rewrites the tree locally first, like the kanban board does: the moved
// row lands where it was released with no round-trip flicker. The copy lives
// until the next fetch answers — server truth then takes over again.
const localCategories = ref<ItemCategoryDto[] | null>(null);
watch(categories.data, () => {
  localCategories.value = null;
});
const tree = computed<ItemCategoryDto[]>(
  () => localCategories.value ?? categories.data.value ?? [],
);

const selected = computed<ItemCategoryDto | null>(
  () => tree.value.find((c) => c.id === selectedId.value) ?? null,
);

// Siblings grouped by parent, in display order. Sorted here rather than trusted
// from the server because the optimistic copy rewrites `order` locally.
const childrenOf = computed<Map<string | null, ItemCategoryDto[]>>(() => {
  const map = new Map<string | null, ItemCategoryDto[]>();
  for (const category of tree.value) {
    const siblings = map.get(category.parentId) ?? [];
    siblings.push(category);
    map.set(category.parentId, siblings);
  }
  for (const siblings of map.values()) {
    siblings.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  return map;
});

// Depth of every node regardless of what is collapsed — the drop rules need it
// even for rows that are not currently rendered.
const depthById = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  const walk = (parentId: string | null, depth: number): void => {
    for (const category of childrenOf.value.get(parentId) ?? []) {
      map.set(category.id, depth);
      if (depth + 1 < CATEGORY_MAX_DEPTH) walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return map;
});

// Collapsed branches. Local, not route state: which branches are folded is a
// viewing convenience, unlike the selection, which is a place worth linking to.
const collapsed = ref(new Set<string>());

function toggleCollapsed(id: string): void {
  if (collapsed.value.has(id)) collapsed.value.delete(id);
  else collapsed.value.add(id);
}

// Flattened depth-first so the tree renders as one list with indentation —
// simpler than nested components for a vocabulary of this size, and it keeps
// keyboard order the same as reading order.
interface TreeRow {
  category: ItemCategoryDto;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

const rows = computed<TreeRow[]>(() => {
  const out: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const category of childrenOf.value.get(parentId) ?? []) {
      const hasChildren = (childrenOf.value.get(category.id) ?? []).length > 0;
      const expanded = !collapsed.value.has(category.id);
      out.push({ category, depth, hasChildren, expanded });
      if (expanded && depth + 1 < CATEGORY_MAX_DEPTH)
        walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

// What the selected category's items actually carry, ancestors included. Fetched
// rather than derived so the inheritance rule lives in one place — the server.
// NOT `keepPreviousData`: this list belongs to ONE category. Holding the last
// answer while the next one loads shows the previous category's properties, and
// its count, under the newly selected category's name — a lie for as long as the
// request takes. A spinner is the honest state here.
const effective = useResource<EffectiveProperty[]>(
  () =>
    selectedId.value
      ? apiJson(`/api/item-categories/${selectedId.value}/effective-properties`)
      : Promise.resolve([]),
  { enabled: hasSelection },
);

// Selecting another category is a new fetch; `enabled` only gates the first one.
watch(selectedId, () => {
  void effective.refetch();
});

// The parent picker shows the same tree as the panel beside it. Descendants of
// the selected node are dropped, not just the node itself: re-filing a category
// under its own child is the one move the server refuses, and offering it here
// only teaches people that this control sometimes fails.
const parentOptions = computed(() => {
  const excluded = new Set<string>();
  if (selectedId.value) {
    const collect = (id: string): void => {
      excluded.add(id);
      for (const child of childrenOf.value.get(id) ?? []) collect(child.id);
    };
    collect(selectedId.value);
  }
  return [
    { value: '', label: t('inventory.categories.noParent'), empty: true },
    ...buildTreeOptions(
      tree.value
        .filter((c) => !excluded.has(c.id))
        .map((c) => ({
          value: c.id,
          label: c.name,
          parentValue: c.parentId,
          order: c.order,
        })),
    ),
  ];
});

// A property's canonical ORef — the only handle another plugin gets on it.
function propertyRef(propertyId: string): string {
  return (
    formatObjectRef({
      pluginId: 'inventory',
      entityType: CATEGORY_PROPERTY_ENTITY,
      entityId: propertyId,
    }) ?? ''
  );
}

async function reload(): Promise<void> {
  await categories.refetch();
  await effective.refetch();
}

// ── Category CRUD ──────────────────────────────────────────────────────────

const categoryModalOpen = ref(false);
const categoryName = ref('');
const categoryParentId = ref('');
const saving = ref(false);
const categoryNameInput = ref<HTMLInputElement | null>(null);

// The one thing the form needs. Guarding the button as well as the handler is
// the point: a Save that is enabled and does nothing reads as a broken app.
const canCreateCategory = computed(() => categoryName.value.trim() !== '');

function openCreate(): void {
  categoryName.value = '';
  categoryParentId.value = selectedId.value ?? '';
  categoryModalOpen.value = true;
  // The name is the only required field — start the caret in it.
  void nextTick(() => categoryNameInput.value?.focus());
}

async function createCategory(): Promise<void> {
  if (!canCreateCategory.value || saving.value) return;
  saving.value = true;
  try {
    const created = await apiJson<ItemCategoryDto>('/api/item-categories', {
      method: 'POST',
      // A plain object: apiFetch JSON-encodes it AND sets the Content-Type. A
      // pre-stringified body goes out without the header, the server parses an
      // empty DTO, and every write 400s — the bug that shipped this screen dead.
      body: {
        name: categoryName.value.trim(),
        parentId: categoryParentId.value || null,
      },
    });
    categoryModalOpen.value = false;
    await reload();
    selectedId.value = created.id;
    toast.success(t('inventory.categories.created'));
  } catch (err) {
    toast.error(getErrorMessage(err));
  } finally {
    saving.value = false;
  }
}

// Only the fields this screen can actually change — the switch and the parent
// picker — so a typo cannot send a field the server does not accept.
type CategoryPatch = Partial<
  Pick<ItemCategoryDto, 'name' | 'parentId' | 'inheritProperties'>
>;

async function patchCategory(patch: CategoryPatch): Promise<void> {
  if (!selected.value) return;
  try {
    await apiJson(`/api/item-categories/${selected.value.id}`, {
      method: 'PATCH',
      body: patch,
    });
    await reload();
  } catch (err) {
    toast.error(getErrorMessage(err));
    // The switch/select already moved optimistically — put the truth back.
    await reload();
  }
}

// The name edits in place on the panel; drafted so half a rename never fires a
// PATCH per keystroke, and Enter/blur commit the same way.
const nameDraft = ref('');
watch(
  selected,
  (value) => {
    nameDraft.value = value?.name ?? '';
  },
  { immediate: true },
);

async function commitRename(): Promise<void> {
  const name = nameDraft.value.trim();
  if (!selected.value) return;
  if (!name || name === selected.value.name) {
    nameDraft.value = selected.value.name;
    return;
  }
  await patchCategory({ name });
}

function blurOnEnter(event: KeyboardEvent): void {
  if (event.target instanceof HTMLElement) event.target.blur();
}

// ── Tree drag-and-drop ─────────────────────────────────────────────────────
// The kanban board's hand-rolled HTML5 pattern, extended to a tree: the row
// under the pointer splits into thirds — top edge inserts before it, bottom
// edge after it, the middle files the node inside it. The parent Select on the
// panel stays as the keyboard-reachable way to do the same move.

type DropZone = 'before' | 'after' | 'inside';

const draggedId = ref<string | null>(null);
const dropTarget = ref<{ id: string; zone: DropZone } | null>(null);

// The dragged node and everything under it — the rows a drop must not land on,
// or the subtree would be re-filed into itself.
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

// How many levels hang below this node — a subtree dropped deeper than the
// depth cap allows would put its leaves past what any chain walk reads.
function subtreeHeight(id: string): number {
  let height = 0;
  for (const child of childrenOf.value.get(id) ?? []) {
    height = Math.max(height, 1 + subtreeHeight(child.id));
  }
  return height;
}

function clearDrag(): void {
  draggedId.value = null;
  dropTarget.value = null;
}

function onRowDragStart(event: DragEvent, row: TreeRow): void {
  draggedId.value = row.category.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Some engines refuse to start a drag with an empty store; the id is also
    // kept in the ref because dragover is not allowed to read the payload.
    event.dataTransfer.setData('text/plain', row.category.id);
  }
}

function onRowDragOver(event: DragEvent, row: TreeRow): void {
  if (!draggedId.value) return;
  if (dragForbidden.value.has(row.category.id)) {
    dropTarget.value = null;
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const third = rect.height / 3;
  let zone: DropZone =
    y < third ? 'before' : y > rect.height - third ? 'after' : 'inside';
  const height = subtreeHeight(draggedId.value);
  const targetDepth = depthById.value.get(row.category.id) ?? 0;
  // Filing inside would push the dragged subtree past the depth cap — fall
  // back to placing it beside the row instead of refusing the drop outright.
  if (zone === 'inside' && targetDepth + 1 + height >= CATEGORY_MAX_DEPTH) {
    zone = y < rect.height / 2 ? 'before' : 'after';
  }
  if (targetDepth + height >= CATEGORY_MAX_DEPTH && zone !== 'inside') {
    dropTarget.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = { id: row.category.id, zone };
}

function onTreeDragLeave(event: DragEvent): void {
  // Only when the pointer actually leaves the tree card — moving between child
  // rows fires dragleave too, and clearing then would make the line flicker.
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

async function onRowDrop(row: TreeRow): Promise<void> {
  const dragged = draggedId.value;
  const target = dropTarget.value;
  clearDrag();
  if (!dragged || !target || target.id !== row.category.id) return;

  const parentId =
    target.zone === 'inside' ? row.category.id : row.category.parentId;
  const siblings = (childrenOf.value.get(parentId) ?? [])
    .map((c) => c.id)
    .filter((id) => id !== dragged);
  let index = siblings.length;
  if (target.zone !== 'inside') {
    const at = siblings.indexOf(row.category.id);
    if (at !== -1) index = at + (target.zone === 'after' ? 1 : 0);
  }
  siblings.splice(index, 0, dragged);

  const orderById = new Map(siblings.map((id, position) => [id, position]));
  localCategories.value = tree.value.map((c) => {
    const order = orderById.get(c.id);
    if (c.id === dragged) return { ...c, parentId, order: order ?? c.order };
    return order !== undefined ? { ...c, order } : c;
  });
  // A branch that just swallowed a node must show it landing.
  if (target.zone === 'inside') collapsed.value.delete(row.category.id);

  try {
    await apiJson('/api/item-categories/reorder', {
      method: 'PATCH',
      body: { parentId, orderedIds: siblings, movedId: dragged },
    });
    await reload();
  } catch (err) {
    // The server refused the move — cycle, collision — or the write failed;
    // either way the optimistic copy is now a lie.
    toast.error(getErrorMessage(err));
    await reload();
  }
}

// The keyboard equivalent of the drag. HTML5 drag-and-drop is pointer-only —
// it does not fire on touch and has no keyboard path at all — so without this
// the sibling ORDER is unreachable for anyone not using a mouse. Re-parenting
// already has the parent Select on the panel; this covers the rest.
async function moveCategory(row: TreeRow, delta: number): Promise<void> {
  const parentId = row.category.parentId;
  const siblings = (childrenOf.value.get(parentId) ?? []).map((c) => c.id);
  const from = siblings.indexOf(row.category.id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= siblings.length) return;
  siblings.splice(to, 0, ...siblings.splice(from, 1));

  const orderById = new Map(siblings.map((id, position) => [id, position]));
  localCategories.value = tree.value.map((c) => {
    const order = orderById.get(c.id);
    return order !== undefined ? { ...c, order } : c;
  });

  try {
    await apiJson('/api/item-categories/reorder', {
      method: 'PATCH',
      body: { parentId, orderedIds: siblings, movedId: row.category.id },
    });
    await reload();
  } catch (err) {
    toast.error(getErrorMessage(err));
    await reload();
  }
}

async function removeCategory(): Promise<void> {
  if (!selected.value) return;
  const ok = await confirm({
    message: t('inventory.categories.deleteConfirm', {
      name: selected.value.name,
    }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await apiFetch(`/api/item-categories/${selected.value.id}`, {
      method: 'DELETE',
    });
    selectedId.value = null;
    await reload();
    toast.success(t('inventory.categories.deleted'));
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

// ── Property CRUD ──────────────────────────────────────────────────────────

const propertyModalOpen = ref(false);
const editingPropertyId = ref<string | null>(null);
const propertyName = ref('');
const propertyType = ref<CategoryPropertyType>('text');
const propertyUnit = ref('');
const propertyRequired = ref(false);
const propertyOptions = ref('');

const typeOptions = computed(() =>
  CATEGORY_PROPERTY_TYPES.map((type) => ({
    value: type,
    label: t(`inventory.categories.types.${type}`),
  })),
);

const propertyNameInput = ref<HTMLInputElement | null>(null);

const parsedPropertyOptions = computed(() =>
  propertyOptions.value
    .split('\n')
    .map((option) => option.trim())
    .filter((option) => option !== ''),
);

// A `select` with no allowed values is a dropdown that opens onto nothing — an
// unusable field on every item form of this category, saved without complaint.
const canSaveProperty = computed(
  () =>
    propertyName.value.trim() !== '' &&
    (propertyType.value !== 'select' || parsedPropertyOptions.value.length > 0),
);

// Contributions rendered inside the property form hand back a function to run
// once the property exists, and the host calls it with the saved property's
// ORef. This is what lets somebody else's editable control live in a form for a
// property that has not been created yet — the alternative was making this
// screen carry a value it has no business knowing about.
//
// Rebuilt on every open: the Modal is `v-if`, so contributions remount each
// time and would otherwise register again on top of the last visit's functions.
const fieldCommits = ref<SlotFieldCommit[]>([]);
function registerFieldCommit(commit: SlotFieldCommit): void {
  fieldCommits.value.push(commit);
}

// Everything the property form tells its contributions. A computed, so the type
// picker changing mid-form reaches them: a control that only makes sense for
// some kinds of value has to see the kind change.
const propertyFormCtx = computed(() => ({
  fieldRef: editingPropertyId.value
    ? propertyRef(editingPropertyId.value)
    : null,
  valueKind: propertyType.value,
  onReady: registerFieldCommit,
}));

function openPropertyModal(propertyId: string | null): void {
  fieldCommits.value = [];
  editingPropertyId.value = propertyId;
  const existing = selected.value?.properties.find((p) => p.id === propertyId);
  propertyName.value = existing?.name ?? '';
  propertyType.value = existing?.type ?? 'text';
  propertyUnit.value = existing?.unit ?? '';
  propertyRequired.value = existing?.required ?? false;
  propertyOptions.value = (existing?.options ?? []).join('\n');
  propertyModalOpen.value = true;
  void nextTick(() => propertyNameInput.value?.focus());
}

async function saveProperty(): Promise<void> {
  if (!selected.value || !canSaveProperty.value || saving.value) return;
  saving.value = true;
  const body = {
    name: propertyName.value.trim(),
    type: propertyType.value,
    unit: propertyType.value === 'number' ? propertyUnit.value.trim() : null,
    required: propertyRequired.value,
    options: propertyType.value === 'select' ? parsedPropertyOptions.value : [],
  };
  try {
    let propertyId = editingPropertyId.value;
    if (propertyId) {
      await apiJson(`/api/item-categories/properties/${propertyId}`, {
        method: 'PATCH',
        body,
      });
    } else {
      // The id is captured, not discarded: it is the only thing a contribution
      // in this form can be given to write itself against.
      const created = await apiJson<CategoryPropertyDto>(
        `/api/item-categories/${selected.value.id}/properties`,
        { method: 'POST', body },
      );
      propertyId = created.id;
    }
    // Before closing, and after the property is real. A contribution that fails
    // reports it itself; the property is saved either way, which is why this
    // does not sit inside the catch below.
    const savedRef = propertyRef(propertyId);
    await Promise.all(fieldCommits.value.map((commit) => commit(savedRef)));
    propertyModalOpen.value = false;
    await reload();
  } catch (err) {
    // The collision rule speaks through this message — show it verbatim.
    toast.error(getErrorMessage(err));
  } finally {
    saving.value = false;
  }
}

async function removeProperty(propertyId: string, name: string): Promise<void> {
  const ok = await confirm({
    message: t('inventory.categories.deletePropertyConfirm', { name }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await apiFetch(`/api/item-categories/properties/${propertyId}`, {
      method: 'DELETE',
    });
    await reload();
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

// ── Property drag-and-drop ─────────────────────────────────────────────────
// Same mechanics as the tree, flat: only this category's OWN properties move —
// an inherited one renders under its owner's order and is reordered there.

const propDraggedId = ref<string | null>(null);
const propDropTarget = ref<{ id: string; zone: 'before' | 'after' } | null>(
  null,
);

const ownProperties = computed<EffectiveProperty[]>(() =>
  (effective.data.value ?? []).filter((property) => !property.inherited),
);

function onPropDragStart(event: DragEvent, property: EffectiveProperty): void {
  propDraggedId.value = property.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', property.id);
  }
}

function clearPropDrag(): void {
  propDraggedId.value = null;
  propDropTarget.value = null;
}

function onPropDragOver(event: DragEvent, property: EffectiveProperty): void {
  if (!propDraggedId.value) return;
  // Clear, don't just bail: leaving the marker where it was freezes the insert
  // line on the last valid row while the pointer sits over a row that refuses
  // the drop — the tree's handler already gets this right.
  if (property.inherited || property.id === propDraggedId.value) {
    propDropTarget.value = null;
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  propDropTarget.value = {
    id: property.id,
    zone: event.clientY - rect.top < rect.height / 2 ? 'before' : 'after',
  };
}

// Keyboard counterpart of the property drag, for the same reason as the tree's.
async function moveProperty(
  property: EffectiveProperty,
  delta: number,
): Promise<void> {
  if (!selected.value || property.inherited) return;
  const orderedIds = ownProperties.value.map((entry) => entry.id);
  const from = orderedIds.indexOf(property.id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= orderedIds.length) return;
  orderedIds.splice(to, 0, ...orderedIds.splice(from, 1));
  try {
    await apiJson(
      `/api/item-categories/${selected.value.id}/properties/reorder`,
      { method: 'PATCH', body: { orderedIds } },
    );
    await reload();
  } catch (err) {
    toast.error(getErrorMessage(err));
    await reload();
  }
}

async function onPropDrop(property: EffectiveProperty): Promise<void> {
  const dragged = propDraggedId.value;
  const target = propDropTarget.value;
  clearPropDrag();
  if (!dragged || !target || target.id !== property.id || !selected.value) {
    return;
  }
  const orderedIds = ownProperties.value
    .map((entry) => entry.id)
    .filter((id) => id !== dragged);
  const at = orderedIds.indexOf(property.id);
  orderedIds.splice(
    at === -1 ? orderedIds.length : at + (target.zone === 'after' ? 1 : 0),
    0,
    dragged,
  );
  try {
    await apiJson(
      `/api/item-categories/${selected.value.id}/properties/reorder`,
      { method: 'PATCH', body: { orderedIds } },
    );
    await reload();
  } catch (err) {
    toast.error(getErrorMessage(err));
    await reload();
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('inventory.categories.title')"
      :subtitle="$t('inventory.categories.subtitle')"
    >
      <template #actions>
        <Button variant="primary" @click="openCreate">
          <Plus class="w-4 h-4" />
          {{ $t('inventory.categories.add') }}
        </Button>
      </template>
    </PageHeader>

    <PageTabs :tabs="INVENTORY_TABS" :ariaLabel="$t('inventory.page.title')" />

    <!-- Only the FIRST load gets a spinner. Refetches after a write keep the
         previous data on screen (keepPreviousData), so swapping the grid for a
         spinner would blink the whole page on every edit. -->
    <Spinner v-if="categories.loading.value && !categories.data.value" />

    <EmptyState
      v-else-if="!rows.length"
      :icon="FolderTree"
      :title="$t('inventory.categories.emptyTitle')"
      :description="$t('inventory.categories.emptyDescription')"
    />

    <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <!-- The tree -->
      <div class="glass-card rounded-2xl p-2" @dragleave="onTreeDragLeave">
        <ul class="space-y-0.5">
          <li
            v-for="row in rows"
            :key="row.category.id"
            class="group border-y-2 border-transparent"
            :class="{
              'border-t-brand-500 dark:border-t-brand-400':
                dropTarget?.id === row.category.id &&
                dropTarget?.zone === 'before',
              'border-b-brand-500 dark:border-b-brand-400':
                dropTarget?.id === row.category.id &&
                dropTarget?.zone === 'after',
            }"
            draggable="true"
            @dragstart="onRowDragStart($event, row)"
            @dragend="clearDrag"
            @dragover="onRowDragOver($event, row)"
            @drop.prevent="onRowDrop(row)"
          >
            <div
              class="flex items-center gap-1 rounded-xl pr-2 py-1 transition-colors"
              :class="[
                row.category.id === selectedId
                  ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5',
                dropTarget?.id === row.category.id &&
                dropTarget?.zone === 'inside'
                  ? 'bg-brand-500/10 ring-1 ring-brand-500/40'
                  : '',
                draggedId === row.category.id ? 'opacity-40' : '',
              ]"
              :style="{ paddingLeft: `${row.depth * 1.25 + 0.25}rem` }"
            >
              <button
                v-if="row.hasChildren"
                type="button"
                class="shrink-0 rounded-xl p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-expanded="row.expanded"
                :aria-label="
                  row.expanded
                    ? $t('inventory.categories.collapse')
                    : $t('inventory.categories.expand')
                "
                @click.stop="toggleCollapsed(row.category.id)"
              >
                <ChevronRight
                  class="w-3.5 h-3.5 transition-transform"
                  :class="row.expanded ? 'rotate-90' : ''"
                />
              </button>
              <span v-else class="p-1 shrink-0" aria-hidden="true">
                <ChevronRight class="w-3.5 h-3.5 invisible" />
              </span>
              <button
                type="button"
                class="min-w-0 flex-1 flex items-center gap-2 rounded-xl px-1 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-current="
                  row.category.id === selectedId ? 'true' : undefined
                "
                @click="selectedId = row.category.id"
              >
                <span class="truncate">{{ row.category.name }}</span>
                <Badge
                  v-if="row.category.properties.length"
                  tone="neutral"
                  class="ml-auto"
                >
                  {{ row.category.properties.length }}
                </Badge>
              </button>
              <!-- A real button, not decoration: the drag is pointer-only, so
                   this is the handle's keyboard path (Alt+↑/↓). It also stays
                   visible below `md`, where there is no hover to reveal it and
                   HTML5 drag does not fire at all. -->
              <button
                type="button"
                class="shrink-0 cursor-grab rounded-xl p-0.5 text-slate-500 dark:text-slate-400 opacity-40 transition-opacity md:opacity-0 md:group-hover:opacity-40 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-label="$t('inventory.categories.reorder')"
                @keydown.alt.up.prevent="moveCategory(row, -1)"
                @keydown.alt.down.prevent="moveCategory(row, 1)"
              >
                <GripVertical class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        </ul>
        <p class="mt-2 px-2 pb-1 text-xxs text-slate-500 dark:text-slate-400">
          {{ $t('inventory.categories.treeHint') }}
        </p>
      </div>

      <!-- The selected category -->
      <div v-if="selected" class="glass-card rounded-2xl p-5 space-y-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">{{ selected.name }}</h2>
            <p
              v-if="!effective.loading.value"
              class="text-sm text-slate-500 dark:text-slate-400"
            >
              {{
                $t(
                  'inventory.categories.propertyCount',
                  effective.data.value?.length ?? 0,
                )
              }}
            </p>
          </div>
          <Button variant="danger" @click="removeCategory">
            <Trash2 class="w-4 h-4" />
            {{ $t('common.delete') }}
          </Button>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              :for="`cat-name-${selected.id}`"
              class="block text-sm font-medium mb-1"
            >
              {{ $t('inventory.categories.name') }}
            </label>
            <input
              :id="`cat-name-${selected.id}`"
              v-model="nameDraft"
              type="text"
              maxlength="64"
              class="glass-input w-full rounded-xl px-3 py-2"
              @blur="commitRename"
              @keydown.enter="blurOnEnter"
            />
          </div>
          <div>
            <label
              :for="`cat-parent-${selected.id}`"
              class="block text-sm font-medium mb-1"
            >
              {{ $t('inventory.categories.parent') }}
            </label>
            <Select
              :id="`cat-parent-${selected.id}`"
              :model-value="selected.parentId ?? ''"
              :options="parentOptions"
              @update:model-value="
                (value) => patchCategory({ parentId: value || null })
              "
            />
          </div>
          <div class="flex items-start gap-3">
            <Switch
              :id="`cat-inherit-${selected.id}`"
              :model-value="selected.inheritProperties"
              @update:model-value="
                (value) => patchCategory({ inheritProperties: value })
              "
            />
            <label :for="`cat-inherit-${selected.id}`" class="cursor-pointer">
              <span class="block text-sm font-medium">
                {{ $t('inventory.categories.inherit') }}
              </span>
              <span class="block text-xxs text-slate-500 dark:text-slate-400">
                {{ $t('inventory.categories.inheritHint') }}
              </span>
            </label>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">
              {{ $t('inventory.categories.properties') }}
            </h3>
            <Button variant="ghost" @click="openPropertyModal(null)">
              <Plus class="w-4 h-4" />
              {{ $t('inventory.categories.addProperty') }}
            </Button>
          </div>

          <Spinner v-if="effective.loading.value" />

          <p
            v-else-if="!effective.data.value?.length"
            class="text-sm text-slate-500 dark:text-slate-400"
          >
            {{ $t('inventory.categories.noProperties') }}
          </p>

          <ul v-else class="divide-y divide-slate-200 dark:divide-white/5">
            <li
              v-for="property in effective.data.value"
              :key="property.id"
              class="group flex items-center gap-3 py-2 border-y-2 border-transparent"
              :class="{
                'border-t-brand-500 dark:border-t-brand-400':
                  propDropTarget?.id === property.id &&
                  propDropTarget?.zone === 'before',
                'border-b-brand-500 dark:border-b-brand-400':
                  propDropTarget?.id === property.id &&
                  propDropTarget?.zone === 'after',
                'opacity-40': propDraggedId === property.id,
              }"
              :draggable="!property.inherited"
              @dragstart="onPropDragStart($event, property)"
              @dragend="clearPropDrag"
              @dragover="onPropDragOver($event, property)"
              @drop.prevent="onPropDrop(property)"
            >
              <span v-if="property.inherited" class="shrink-0 p-0.5">
                <GripVertical
                  class="w-3.5 h-3.5 invisible"
                  aria-hidden="true"
                />
              </span>
              <button
                v-else
                type="button"
                class="shrink-0 cursor-grab rounded-xl p-0.5 text-slate-500 dark:text-slate-400 opacity-40 transition-opacity md:opacity-0 md:group-hover:opacity-40 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :aria-label="$t('inventory.categories.reorder')"
                @keydown.alt.up.prevent="moveProperty(property, -1)"
                @keydown.alt.down.prevent="moveProperty(property, 1)"
              >
                <GripVertical class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm truncate">{{ property.name }}</span>
                  <!-- Expected: this screen's own marker, in the same row as
                       any a plugin adds, because to the reader they are the
                       same kind of fact about the field. Amber ties it to the
                       "not filled in" badge the item form shows for exactly
                       these properties. -->
                  <Asterisk
                    v-if="property.required"
                    class="w-3.5 h-3.5 shrink-0 text-amber-500 dark:text-amber-400"
                    :aria-label="$t('inventory.categories.required')"
                  />
                  <!-- Markers other plugins put on this field. This screen
                       states which field it is and what it holds, and knows
                       nothing about what shows up here — disable that plugin
                       and the marker goes with it, no condition needed. -->
                  <PluginSlot
                    name="inventory.category-property.badges"
                    :ctx="{
                      fieldRef: propertyRef(property.id),
                      valueKind: property.type,
                    }"
                  />
                </div>
                <p class="text-xxs text-slate-500 dark:text-slate-400">
                  {{ $t(`inventory.categories.types.${property.type}`) }}
                  <template v-if="property.unit"
                    >· {{ property.unit }}</template
                  >
                </p>
              </div>
              <Badge v-if="property.inherited" tone="neutral" class="ml-auto">
                {{ property.ownerCategoryName }}
              </Badge>
              <div v-else class="ml-auto flex items-center gap-1">
                <!-- Two icon buttons of the same size, muted until hovered —
                     the row-action shape the item list and the order cards
                     already use. A text Edit beside a 44px icon Delete made
                     the destructive action the loudest thing in the row. -->
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="$t('common.edit')"
                  :title="$t('common.edit')"
                  :icon-left="Pencil"
                  @click="openPropertyModal(property.id)"
                />
                <Button
                  variant="dangerGhost"
                  size="icon-sm"
                  :aria-label="$t('common.delete')"
                  :title="$t('common.delete')"
                  :icon-left="Trash2"
                  @click="removeProperty(property.id, property.name)"
                />
              </div>
            </li>
          </ul>
        </div>
      </div>

      <EmptyState
        v-else
        :icon="FolderTree"
        :title="$t('inventory.categories.pickTitle')"
        :description="$t('inventory.categories.pickDescription')"
      />
    </div>

    <!-- New category -->
    <Modal v-model="categoryModalOpen" :title="$t('inventory.categories.add')">
      <div class="space-y-4">
        <div>
          <label for="new-cat-name" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.name') }}
          </label>
          <input
            id="new-cat-name"
            ref="categoryNameInput"
            v-model="categoryName"
            type="text"
            maxlength="64"
            class="glass-input w-full rounded-xl px-3 py-2"
            @keydown.enter.prevent="createCategory"
          />
        </div>
        <div>
          <label for="new-cat-parent" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.parent') }}
          </label>
          <Select
            id="new-cat-parent"
            v-model="categoryParentId"
            :options="parentOptions"
          />
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="categoryModalOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button
          variant="primary"
          :disabled="saving || !canCreateCategory"
          @click="createCategory"
        >
          {{ $t('common.save') }}
        </Button>
      </template>
    </Modal>

    <!-- Property editor -->
    <Modal
      v-model="propertyModalOpen"
      :title="
        editingPropertyId
          ? $t('inventory.categories.editProperty')
          : $t('inventory.categories.addProperty')
      "
    >
      <div class="space-y-4">
        <div>
          <label for="prop-name" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.name') }}
          </label>
          <input
            id="prop-name"
            ref="propertyNameInput"
            v-model="propertyName"
            type="text"
            maxlength="64"
            class="glass-input w-full rounded-xl px-3 py-2"
            @keydown.enter.prevent="saveProperty"
          />
        </div>

        <div>
          <label for="prop-type" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.type') }}
          </label>
          <Select
            id="prop-type"
            v-model="propertyType"
            :options="typeOptions"
          />
        </div>

        <div v-if="propertyType === 'number'">
          <label for="prop-unit" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.unit') }}
          </label>
          <input
            id="prop-unit"
            v-model="propertyUnit"
            type="text"
            maxlength="16"
            class="glass-input w-full rounded-xl px-3 py-2"
          />
          <p class="mt-1 text-xxs text-slate-500 dark:text-slate-400">
            {{ $t('inventory.categories.unitHint') }}
          </p>
        </div>

        <div v-if="propertyType === 'select'">
          <label for="prop-options" class="block text-sm font-medium mb-1">
            {{ $t('inventory.categories.options') }}
          </label>
          <textarea
            id="prop-options"
            v-model="propertyOptions"
            rows="5"
            class="glass-input w-full rounded-xl px-3 py-2"
          ></textarea>
          <p
            class="mt-1 text-xxs"
            :class="
              parsedPropertyOptions.length
                ? 'text-slate-500 dark:text-slate-400'
                : 'text-amber-600 dark:text-amber-400'
            "
          >
            {{
              parsedPropertyOptions.length
                ? $t('inventory.categories.optionsHint')
                : $t('inventory.categories.optionsRequired')
            }}
          </p>
        </div>

        <div class="flex items-start gap-3">
          <Switch id="prop-required" v-model="propertyRequired" />
          <label for="prop-required" class="cursor-pointer">
            <span class="block text-sm font-medium">
              {{ $t('inventory.categories.required') }}
            </span>
            <span class="block text-xxs text-slate-500 dark:text-slate-400">
              {{ $t('inventory.categories.requiredHint') }}
            </span>
          </label>
        </div>

        <!-- What other plugins do with this field's values. They persist
             themselves through `onReady`, once this form has actually saved the
             property — so their controls follow this modal's Save and Cancel
             without this screen storing anything of theirs. -->
        <PluginSlot
          name="inventory.category-property.form"
          :ctx="propertyFormCtx"
        />
      </div>
      <template #footer>
        <Button variant="ghost" @click="propertyModalOpen = false">
          {{ $t('common.cancel') }}
        </Button>
        <Button
          variant="primary"
          :disabled="saving || !canSaveProperty"
          @click="saveProperty"
        >
          {{ $t('common.save') }}
        </Button>
      </template>
    </Modal>
  </div>
</template>
