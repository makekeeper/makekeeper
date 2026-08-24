<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  Select,
  Badge,
  Button,
  Spinner,
  Switch,
  Modal,
  useConfirm,
  useToastStore,
  useAgentDataChanged,
  useUxMode,
  setPageContextSummary,
  setPageContextRefs,
  apiFetch,
  PageHeader,
  PluginSlot,
} from '@makekeeper/frontend-core';
import {
  formatCellAddress,
  formatObjectRef,
  type StorageCellActionsSlotCtx,
} from '@makekeeper/plugin-contract';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Box,
  Folder,
  FolderPlus,
  Plus,
  Edit2,
  Trash2,
  MapPin,
  Layers,
  Search,
  Cpu,
  ChevronRight,
  ChevronDown,
  Archive,
  ArrowRight,
  Sparkles,
  Info,
  Grid,
} from '@lucide/vue';

interface GridSpan {
  id: string;
  startRow: number;
  startCol: number;
  rowSpan: number;
  colSpan: number;
}

interface StorageItem {
  id: string;
  name: string;
  parentId: string | null;
  location?: string;
  componentsCount: number;
  gridRows?: number | null;
  gridCols?: number | null;
  parentRow?: number | null;
  parentCol?: number | null;
  gridSpans?: string | null;
}

interface ComponentItem {
  id: string;
  name: string;
  sku: string;
  // The category is a relation now (#205), not a string on the row; `null` for
  // an item nobody has filed yet.
  categoryRef: { id: string; name: string } | null;
  location: string;
  quantity: number;
  minQuantity: number;
  price: number;
  currency?: string;
  storageId?: string | null;
  storageRow?: number | null;
  storageCol?: number | null;
}

interface GridCellItem {
  id: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  isMergedStart: boolean;
  componentsCount: number;
  storagesCount: number;
  address: string;
  spanId?: string;
}

const storages = ref<StorageItem[]>([]);
const allComponents = ref<ComponentItem[]>([]);
const selectedStorageId = ref<string>('');
const selectedStorageComponents = ref<ComponentItem[]>([]);
const loadingStorages = ref(true);
const loadingComponents = ref(false);
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();
const { isFeatureVisible } = useUxMode();

// UX-mode gates (display lens only — data keeps rendering, editing UI hides).
// Merged cells (gridSpans) still render when grid editing is hidden; saved
// zone / parent-cell values are kept in the save payload when the fields hide.
const gridEditingVisible = computed(() =>
  isFeatureVisible('storages.gridEditing'),
);
const advancedFieldsVisible = computed(() =>
  isFeatureVisible('storages.advancedFields'),
);
// The contents table's category column follows inventory's categories lens
// (#269): with the vocabulary hidden there, a column of its values here would
// name a concept the rest of the UI no longer shows.
const categoriesVisible = computed(() =>
  isFeatureVisible('inventory.categories'),
);

const expandedStorages = ref<Record<string, boolean>>({});

// Dialog State
const showAddEditModal = ref(false);
const isEditMode = ref(false);
const editingStorageId = ref('');
const storageName = ref('');
const storageLocation = ref('');
const storageParentId = ref<string>('');

// Grid options inside dialog (for storage being edited/created)
const isGridToggle = ref(false);
const gridRows = ref(5);
const gridCols = ref(5);

// Parent grid coordinate options (for placing storage inside a parent's cell)
const storageParentRow = ref<number | null>(null);
const storageParentCol = ref<number | null>(null);

// Visual cell filter coordinate for active storage view
const selectedCellFilter = ref<{ r: number; c: number } | null>(null);

// Tag filter for the storage tree (storages.list.filters slot, contributed by
// the tags plugin). Route-driven: the chosen tag lives in `?tag=<id>`; the slot
// reports the matching storage ids back via onMatches (null = no tag chosen or
// tags disabled — the tree is unfiltered).
const tagMatchIds = ref<Set<string> | null>(null);
const onTagMatches = (ids: string[] | null): void => {
  tagMatchIds.value = ids ? new Set(ids) : null;
};
const tagFilter = computed<string>({
  get: () => (typeof route.query.tag === 'string' ? route.query.tag : ''),
  set: (value) => {
    void router.replace({
      query: { ...route.query, tag: value || undefined },
    });
  },
});

// Storages visible under the active tag filter: every match plus its ancestor
// chain, so matches stay reachable inside an intact tree. Null = no filter.
const tagVisibleIds = computed<Set<string> | null>(() => {
  const matches = tagMatchIds.value;
  if (!matches) return null;
  const byId = new Map(storages.value.map((s) => [s.id, s]));
  const visible = new Set<string>();
  for (const storage of storages.value) {
    if (!matches.has(storage.id)) continue;
    let current: StorageItem | undefined = storage;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return visible;
});

// Merge cells mode options
const mergeMode = ref(false);
const selectedCellsForMerge = ref<{ r: number; c: number }[]>([]);

// If grid editing gets hidden (mode switch / override) while merge mode is on,
// drop out of it so no editing surface stays half-active behind a hidden toggle.
watch(gridEditingVisible, (visible) => {
  if (!visible && mergeMode.value) {
    mergeMode.value = false;
    selectedCellsForMerge.value = [];
  }
});

const fetchStorages = async () => {
  try {
    loadingStorages.value = true;
    const res = await apiFetch('/api/storages');
    if (res.ok) {
      storages.value = await res.json();

      if (storages.value.length > 0) {
        if (!selectedStorageId.value) {
          const firstId = storages.value[0].id;
          goToStorage(firstId);
        } else {
          // Keep the active node (and its ancestor chain) visible + expanded —
          // covers deep-link / reload and post-agent-refresh, where the selection
          // was restored from the route before the tree data arrived.
          expandParentHierarchy(selectedStorageId.value);
          expandedStorages.value[selectedStorageId.value] = true;
        }
      }
    }
  } catch (error) {
    console.error('Error fetching storages:', error);
  } finally {
    loadingStorages.value = false;
  }
};

const fetchAllComponents = async () => {
  try {
    const res = await apiFetch('/api/components');
    if (res.ok) {
      allComponents.value = await res.json();
    }
  } catch (error) {
    console.error('Error fetching all components:', error);
  }
};

// The route (query: storageId / row / col) is the single source of truth for the
// open storage and cell — so a reload/deep-link restores the view and the AI chat
// receives the exact selection via collectPageContext. These helpers only write the
// route; `syncFromRoute` reflects it back into local state and loads the data.
const goToStorage = (id: string): void => {
  // Selecting a storage keeps the active tag filter (`?tag`) in the route.
  router
    .replace({ query: { storageId: id, tag: route.query.tag } })
    .catch(() => undefined);
};

const goToStorageCell = (id: string, r: number, c: number): void => {
  router
    .replace({
      query: {
        storageId: id,
        row: String(r),
        col: String(c),
        tag: route.query.tag,
      },
    })
    .catch(() => undefined);
};

const loadSelectedStorageComponents = async (id: string): Promise<void> => {
  try {
    loadingComponents.value = true;
    const res = await apiFetch(`/api/storages/${id}/components`);
    if (res.ok) {
      selectedStorageComponents.value = await res.json();
    }
  } catch (error) {
    console.error('Error fetching storage components:', error);
  } finally {
    loadingComponents.value = false;
  }
};

// Handed to the `storages.cell.actions` contributors (#79): a contributor that
// placed something into the open cell calls this so the listing catches up,
// without the host learning anything about what was placed.
const reloadCellContents = (): void => {
  if (selectedStorageId.value) {
    void loadSelectedStorageComponents(selectedStorageId.value);
  }
};

// Tree click: only navigate + toggle local expansion. First selection expands the
// node; a repeat click toggles its subtree. The load happens in syncFromRoute.
const selectStorage = (id: string): void => {
  const isAlreadySelected = selectedStorageId.value === id;
  expandedStorages.value[id] = isAlreadySelected
    ? !expandedStorages.value[id]
    : true;
  goToStorage(id);
};

// Reflect the route into local state. Only refetches components when the storage
// actually changes, so a post-edit refresh keeps the current cell open and the tree
// expanded (route unchanged → no reset).
const syncFromRoute = async (): Promise<void> => {
  const { storageId, row, col } = route.query;
  const id = typeof storageId === 'string' ? storageId : '';
  const r = typeof row === 'string' ? Number(row) : Number.NaN;
  const c = typeof col === 'string' ? Number(col) : Number.NaN;
  const cell = Number.isInteger(r) && Number.isInteger(c) ? { r, c } : null;

  if (!id) {
    selectedStorageId.value = '';
    selectedStorageComponents.value = [];
    selectedCellFilter.value = null;
    return;
  }

  if (id !== selectedStorageId.value) {
    selectedStorageId.value = id;
    mergeMode.value = false;
    clearMergeSelection();
    expandParentHierarchy(id);
    expandedStorages.value[id] = true;
    await loadSelectedStorageComponents(id);
  }
  selectedCellFilter.value = cell;
};

const expandParentHierarchy = (id: string) => {
  const current = storages.value.find((s) => s.id === id);
  if (current && current.parentId) {
    expandedStorages.value[current.parentId] = true;
    expandParentHierarchy(current.parentId);
  }
};

const toggleExpand = (id: string) => {
  expandedStorages.value[id] = !expandedStorages.value[id];
};

const buildTree = (parentId: string | null, depth = 0): any[] => {
  const result: any[] = [];
  const visible = tagVisibleIds.value;
  const levelItems = storages.value.filter(
    (s) => s.parentId === parentId && (!visible || visible.has(s.id)),
  );
  for (const item of levelItems) {
    const hasChildren = storages.value.some((s) => s.parentId === item.id);
    // While the tag filter is active the tree is force-expanded so every match
    // is visible regardless of the stored collapse state.
    const isExpanded = visible ? true : !!expandedStorages.value[item.id];
    result.push({
      ...item,
      depth,
      hasChildren,
      isExpanded,
    });
    if (isExpanded) {
      result.push(...buildTree(item.id, depth + 1));
    }
  }
  return result;
};

const treeStorages = computed(() => buildTree(null));

const selectedStorage = computed(() => {
  return storages.value.find((s) => s.id === selectedStorageId.value) || null;
});

const getStoragePath = (id: string | null): string => {
  if (!id) return '';
  const current = storages.value.find((s) => s.id === id);
  if (!current) return '';
  if (current.parentId) {
    return getStoragePath(current.parentId) + ' / ' + current.name;
  }
  return current.name;
};

const getStoragePathWithCoords = (id: string | null): string => {
  if (!id) return '';
  const current = storages.value.find((s) => s.id === id);
  if (!current) return '';

  let suffix = '';
  if (current.parentRow !== null && current.parentCol !== null) {
    suffix = ` (${getCellAddress(current.parentRow, current.parentCol)})`;
  }

  if (current.parentId) {
    return (
      getStoragePathWithCoords(current.parentId) + ' / ' + current.name + suffix
    );
  }
  return current.name + suffix;
};

interface BreadcrumbItem {
  id: string;
  name: string;
  coords: string | null;
}

const getStorageBreadcrumbs = (id: string | null): BreadcrumbItem[] => {
  if (!id) return [];
  const current = storages.value.find((s) => s.id === id);
  if (!current) return [];

  const item: BreadcrumbItem = {
    id: current.id,
    name: current.name,
    coords:
      current.parentRow !== null && current.parentCol !== null
        ? getCellAddress(current.parentRow, current.parentCol)
        : null,
  };

  if (current.parentId) {
    return [...getStorageBreadcrumbs(current.parentId), item];
  }
  return [item];
};

// Address of the currently open grid cell (e.g. "B1"), or null when none is open.
const selectedCellAddress = computed<string | null>(() =>
  selectedCellFilter.value
    ? getCellAddress(selectedCellFilter.value.r, selectedCellFilter.value.c)
    : null,
);

// Full "/"-joined path to the selected storage, each nested crumb tagged with its
// cell coordinate, e.g. "Office / Working Table (A2)". Reused for the AI context.
const selectedStoragePath = computed<string>(() =>
  getStorageBreadcrumbs(selectedStorageId.value)
    .map((cr) => (cr.coords ? `${cr.name} (${cr.coords})` : cr.name))
    .join(' / '),
);

// Precise, named description of the current selection for the AI chat page context
// (issue #15) — carries the human path, the open cell address + coordinates, and
// the storageId so the agent can act on the exact cell instead of guessing.
const pageContextSummary = computed<string | null>(() => {
  if (!selectedStorage.value) return null;
  const path = selectedStoragePath.value;
  const storageId = selectedStorageId.value;
  if (selectedCellFilter.value && selectedCellAddress.value) {
    return t('storages.context.cell', {
      path,
      cell: selectedCellAddress.value,
      row: selectedCellFilter.value.r,
      col: selectedCellFilter.value.c,
      storageId,
    });
  }
  return t('storages.context.storage', { path, storageId });
});

// Machine-parseable counterpart to the summary (issue #16): the same selection as a
// canonical ORef — "mk://storages/storage/<id>" plus the open cell as a "#B1"
// fragment. The agent gets an exact, ownership-tagged handle instead of re-parsing
// ids out of the prose summary. null (not []) when nothing is selected.
const pageContextRefs = computed<string[] | null>(() => {
  const storageId = selectedStorageId.value;
  if (!selectedStorage.value || !storageId) return null;
  const ref = formatObjectRef({
    pluginId: 'storages',
    entityType: 'storage',
    entityId: storageId,
    ...(selectedCellAddress.value
      ? { fragment: selectedCellAddress.value }
      : {}),
  });
  return ref ? [ref] : null;
});

// Canonical ORefs for the tag chip slots: the storage itself, and (when a cell
// is open) that cell as a "#B1" fragment. Empty string when nothing applies.
const storageTagRef = computed<string>(() =>
  selectedStorageId.value
    ? (formatObjectRef({
        pluginId: 'storages',
        entityType: 'storage',
        entityId: selectedStorageId.value,
      }) ?? '')
    : '',
);
const cellTagRef = computed<string>(() =>
  selectedStorageId.value && selectedCellAddress.value
    ? (formatObjectRef({
        pluginId: 'storages',
        entityType: 'storage',
        entityId: selectedStorageId.value,
        fragment: selectedCellAddress.value,
      }) ?? '')
    : '',
);

// The ctx for `storages.cell.actions` (#79), built in one typed place instead of
// as an object literal in the template: it is a published contract, and typing
// it here is what stops the host and its contributors from drifting apart.
// Null while no cell is open — the slot is then not rendered at all.
const cellActionsCtx = computed<StorageCellActionsSlotCtx | null>(() => {
  const cell = selectedCellFilter.value;
  const address = selectedCellAddress.value;
  if (!cellTagRef.value || !cell || !address) return null;
  return {
    storageId: selectedStorageId.value,
    row: cell.r,
    col: cell.c,
    cellAddress: address,
    cellRef: cellTagRef.value,
    onChanged: reloadCellContents,
  };
});

// Single source for the "add a component into this storage cell" navigation — the
// inventory new-component route with the cell prefilled. Kept in one place so the
// storage→inventory path (issue #16's second independent encoding) is built once
// instead of reconstructed by hand at each call site.
const openNewComponentForCell = (
  storageId: string,
  row: number,
  col: number,
): void => {
  router.push(`/inventory/new?storageId=${storageId}&row=${row}&col=${col}`);
};

const isCellOnSelectedPath = (
  storageId: string,
  r: number,
  c: number,
): boolean => {
  if (!selectedStorageId.value) return false;

  let currentId: string | null = selectedStorageId.value;
  while (currentId) {
    const current = storages.value.find((item) => item.id === currentId);
    if (!current) break;

    if (
      current.parentId === storageId &&
      current.parentRow === r &&
      current.parentCol === c
    ) {
      return true;
    }

    currentId = current.parentId;
  }

  return false;
};

const selectedParentDetails = computed(() => {
  return storages.value.find((s) => s.id === storageParentId.value) || null;
});

const isParentStorageGrid = computed(() => {
  return !!(
    selectedParentDetails.value?.gridRows &&
    selectedParentDetails.value?.gridCols
  );
});

const parentRowOptions = computed(() => {
  if (!selectedParentDetails.value?.gridRows) return [];
  return Array.from(
    { length: selectedParentDetails.value.gridRows },
    (_, i) => ({
      value: i,
      label: t('storages.row', { num: i + 1 }),
    }),
  );
});

const parentColOptions = computed(() => {
  if (!selectedParentDetails.value?.gridCols) return [];
  return Array.from(
    { length: selectedParentDetails.value.gridCols },
    (_, i) => ({
      value: i,
      label: t('storages.column', { char: String.fromCharCode(65 + i) }),
    }),
  );
});

watch(storageParentId, (newId) => {
  const s = storages.value.find((item) => item.id === newId);
  if (s && s.gridRows && s.gridCols) {
    if (
      storageParentRow.value === null ||
      storageParentRow.value === undefined
    ) {
      storageParentRow.value = 0;
    }
    if (
      storageParentCol.value === null ||
      storageParentCol.value === undefined
    ) {
      storageParentCol.value = 0;
    }
  } else {
    storageParentRow.value = null;
    storageParentCol.value = null;
  }
});

const openAddModal = (parentId = '') => {
  isEditMode.value = false;
  editingStorageId.value = '';
  storageName.value = '';
  storageLocation.value = '';
  storageParentId.value = parentId;
  storageParentRow.value = null;
  storageParentCol.value = null;
  isGridToggle.value = false;
  gridRows.value = 5;
  gridCols.value = 5;
  showAddEditModal.value = true;
};

const openAddModalWithCell = (parentId: string, r: number, c: number) => {
  isEditMode.value = false;
  editingStorageId.value = '';
  storageName.value = '';
  storageLocation.value = '';
  storageParentId.value = parentId;
  storageParentRow.value = r;
  storageParentCol.value = c;
  isGridToggle.value = false;
  gridRows.value = 5;
  gridCols.value = 5;
  showAddEditModal.value = true;
};

const openEditModal = (s: StorageItem) => {
  isEditMode.value = true;
  editingStorageId.value = s.id;
  storageName.value = s.name;
  storageLocation.value = s.location || '';
  storageParentId.value = s.parentId || '';
  storageParentRow.value = s.parentRow !== undefined ? s.parentRow : null;
  storageParentCol.value = s.parentCol !== undefined ? s.parentCol : null;
  isGridToggle.value = !!(s.gridRows && s.gridCols);
  gridRows.value = s.gridRows || 5;
  gridCols.value = s.gridCols || 5;
  showAddEditModal.value = true;
};

const handleSaveStorage = async () => {
  if (!storageName.value.trim()) return;

  const payload = {
    name: storageName.value.trim(),
    location: storageLocation.value.trim(),
    parentId: storageParentId.value || null,
    gridRows: isGridToggle.value ? Number(gridRows.value) : null,
    gridCols: isGridToggle.value ? Number(gridCols.value) : null,
    parentRow:
      isParentStorageGrid.value &&
      storageParentRow.value !== null &&
      storageParentRow.value !== undefined
        ? Number(storageParentRow.value)
        : null,
    parentCol:
      isParentStorageGrid.value &&
      storageParentCol.value !== null &&
      storageParentCol.value !== undefined
        ? Number(storageParentCol.value)
        : null,
  };

  try {
    const url = isEditMode.value
      ? `/api/storages/${editingStorageId.value}`
      : '/api/storages';
    const method = isEditMode.value ? 'PATCH' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      showAddEditModal.value = false;
      await fetchStorages();
      await fetchAllComponents();
      if (!isEditMode.value) {
        const newStorage = await response.json();
        selectStorage(newStorage.id);
      } else if (selectedStorageId.value === editingStorageId.value) {
        // Refresh data only — keep the current cell open and the tree expanded.
        await loadSelectedStorageComponents(selectedStorageId.value);
      }
    }
  } catch (error) {
    console.error('Error saving storage:', error);
  }
};

const handleDeleteStorage = async (s: StorageItem) => {
  const ok = await confirm({
    message: t('storages.deleteConfirm', { name: s.name }),
    tone: 'danger',
  });
  if (!ok) return;

  try {
    const response = await apiFetch(`/api/storages/${s.id}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      if (selectedStorageId.value === s.id) {
        selectedStorageId.value = '';
        selectedStorageComponents.value = [];
        selectedCellFilter.value = null;
        router.replace({ query: {} }).catch(() => undefined);
      }
      await fetchStorages();
      await fetchAllComponents();
    }
  } catch (error) {
    toast.error(t('storages.deleteError'));
    console.error('Error deleting storage:', error);
  }
};

// Excel cell coordinates (e.g. A1, B3) — single shared convention with the
// backend tools and the AI agent (plugin-contract/grid-address).
const getCellAddress = (r: number, c: number): string =>
  formatCellAddress(r, c) ?? '';

const toggleCellFilter = (r: number, c: number): void => {
  const active = selectedCellFilter.value;
  if (active && active.r === r && active.c === c) {
    goToStorage(selectedStorageId.value); // clear cell → whole-storage view
  } else {
    goToStorageCell(selectedStorageId.value, r, c);
  }
};

const selectStorageAndCell = (
  storageId: string,
  r: number,
  c: number,
): void => {
  goToStorageCell(storageId, r, c);
};

const filteredComponents = computed(() => {
  if (!selectedCellFilter.value) return selectedStorageComponents.value;
  return selectedStorageComponents.value.filter(
    (item) =>
      item.storageRow === selectedCellFilter.value!.r &&
      item.storageCol === selectedCellFilter.value!.c,
  );
});

const getCellComponentsCount = (r: number, c: number) => {
  return selectedStorageComponents.value.filter(
    (item) =>
      item.storageId === selectedStorageId.value &&
      item.storageRow === r &&
      item.storageCol === c,
  ).length;
};

const getCellComponentsCountForStorage = (
  storageId: string,
  r: number,
  c: number,
) => {
  return allComponents.value.filter(
    (item) =>
      item.storageId === storageId &&
      item.storageRow === r &&
      item.storageCol === c,
  ).length;
};

const getCellStoragesCount = (storageId: string, r: number, c: number) => {
  return storages.value.filter(
    (s) => s.parentId === storageId && s.parentRow === r && s.parentCol === c,
  ).length;
};

const nestedStorages = computed(() => {
  if (!selectedStorage.value) return [];
  if (!selectedCellFilter.value) {
    return storages.value.filter(
      (s) => s.parentId === selectedStorage.value!.id,
    );
  }
  return storages.value.filter(
    (s) =>
      s.parentId === selectedStorage.value!.id &&
      s.parentRow === selectedCellFilter.value!.r &&
      s.parentCol === selectedCellFilter.value!.c,
  );
});

const visibleGridCells = computed<GridCellItem[]>(() => {
  if (
    !selectedStorage.value ||
    !selectedStorage.value.gridRows ||
    !selectedStorage.value.gridCols
  ) {
    return [];
  }
  const rows = selectedStorage.value.gridRows;
  const cols = selectedStorage.value.gridCols;
  const storageId = selectedStorage.value.id;

  let spans: GridSpan[] = [];
  if (selectedStorage.value.gridSpans) {
    try {
      spans = JSON.parse(selectedStorage.value.gridSpans);
    } catch (e) {
      console.error('Failed to parse gridSpans JSON:', e);
    }
  }

  const isCovered = Array.from({ length: rows }, () => Array(cols).fill(false));
  const spanStartMap = new Map<string, GridSpan>();

  for (const span of spans) {
    for (let r = span.startRow; r < span.startRow + span.rowSpan; r++) {
      for (let c = span.startCol; c < span.startCol + span.colSpan; c++) {
        if (r < rows && c < cols) {
          isCovered[r][c] = true;
        }
      }
    }
    spanStartMap.set(`${span.startRow},${span.startCol}`, span);
  }

  const cells: GridCellItem[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const coordKey = `${r},${c}`;
      if (spanStartMap.has(coordKey)) {
        const span = spanStartMap.get(coordKey)!;
        cells.push({
          id: `span-${span.startRow}-${span.startCol}`,
          row: span.startRow,
          col: span.startCol,
          rowSpan: span.rowSpan,
          colSpan: span.colSpan,
          isMergedStart: true,
          componentsCount: getCellComponentsCount(span.startRow, span.startCol),
          storagesCount: getCellStoragesCount(
            storageId,
            span.startRow,
            span.startCol,
          ),
          address: getMergedCellAddress(span),
          spanId: span.id,
        });
      } else if (!isCovered[r][c]) {
        cells.push({
          id: `cell-${r}-${c}`,
          row: r,
          col: c,
          rowSpan: 1,
          colSpan: 1,
          isMergedStart: false,
          componentsCount: getCellComponentsCount(r, c),
          storagesCount: getCellStoragesCount(storageId, r, c),
          address: getCellAddress(r, c),
        });
      }
    }
  }

  return cells;
});

const getMergedCellAddress = (span: GridSpan) => {
  const start = getCellAddress(span.startRow, span.startCol);
  const end = getCellAddress(
    span.startRow + span.rowSpan - 1,
    span.startCol + span.colSpan - 1,
  );
  return start === end ? start : `${start}:${end}`;
};

const getVisibleCellsForStorage = (s: StorageItem) => {
  const rows = s.gridRows || 0;
  const cols = s.gridCols || 0;
  if (rows === 0 || cols === 0) return [];

  let spans: GridSpan[] = [];
  if (s.gridSpans) {
    try {
      spans = JSON.parse(s.gridSpans);
    } catch (e) {}
  }

  const isCovered = Array.from({ length: rows }, () => Array(cols).fill(false));
  const spanStartMap = new Map<string, GridSpan>();

  for (const span of spans) {
    for (let r = span.startRow; r < span.startRow + span.rowSpan; r++) {
      for (let c = span.startCol; c < span.startCol + span.colSpan; c++) {
        if (r < rows && c < cols) {
          isCovered[r][c] = true;
        }
      }
    }
    spanStartMap.set(`${span.startRow},${span.startCol}`, span);
  }

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const coordKey = `${r},${c}`;
      if (spanStartMap.has(coordKey)) {
        const span = spanStartMap.get(coordKey)!;
        cells.push({
          r,
          c,
          rowSpan: span.rowSpan,
          colSpan: span.colSpan,
          visible: true,
        });
      } else if (!isCovered[r][c]) {
        cells.push({ r, c, rowSpan: 1, colSpan: 1, visible: true });
      } else {
        cells.push({ r, c, rowSpan: 0, colSpan: 0, visible: false });
      }
    }
  }
  return cells;
};

// Merge mode controls
const toggleMergeMode = () => {
  mergeMode.value = !mergeMode.value;
  clearMergeSelection();
};

const clearMergeSelection = () => {
  selectedCellsForMerge.value = [];
};

const toggleMergeCellSelection = (r: number, c: number) => {
  const index = selectedCellsForMerge.value.findIndex(
    (coord) => coord.r === r && coord.c === c,
  );
  if (index !== -1) {
    selectedCellsForMerge.value.splice(index, 1);
  } else {
    selectedCellsForMerge.value.push({ r, c });
  }
};

const isSelectionValidRectangle = computed(() => {
  if (selectedCellsForMerge.value.length < 2) return false;

  const rowsList = selectedCellsForMerge.value.map((cell) => cell.r);
  const colsList = selectedCellsForMerge.value.map((cell) => cell.c);

  const minR = Math.min(...rowsList);
  const maxR = Math.max(...rowsList);
  const minC = Math.min(...colsList);
  const maxC = Math.max(...colsList);

  const expectedCount = (maxR - minR + 1) * (maxC - minC + 1);
  if (selectedCellsForMerge.value.length !== expectedCount) {
    return false;
  }

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const exists = selectedCellsForMerge.value.some(
        (cell) => cell.r === r && cell.c === c,
      );
      if (!exists) return false;
    }
  }

  return true;
});

const canMergeSelection = computed(() => {
  if (!isSelectionValidRectangle.value) return false;

  let spans: GridSpan[] = [];
  if (selectedStorage.value?.gridSpans) {
    try {
      spans = JSON.parse(selectedStorage.value.gridSpans);
    } catch (e) {}
  }

  for (const coord of selectedCellsForMerge.value) {
    const isPartOfSpan = spans.some(
      (span) =>
        coord.r >= span.startRow &&
        coord.r < span.startRow + span.rowSpan &&
        coord.c >= span.startCol &&
        coord.c < span.startCol + span.colSpan,
    );
    if (isPartOfSpan) return false;
  }

  return true;
});

const getSelectedCellSpanId = () => {
  if (selectedCellsForMerge.value.length !== 1) return null;
  const coord = selectedCellsForMerge.value[0];
  const cell = visibleGridCells.value.find(
    (c) => c.row === coord.r && c.col === coord.c,
  );
  return cell?.spanId || null;
};

const handleMergeCells = async () => {
  if (!selectedStorage.value || !canMergeSelection.value) return;

  const rowsList = selectedCellsForMerge.value.map((cell) => cell.r);
  const colsList = selectedCellsForMerge.value.map((cell) => cell.c);

  const minR = Math.min(...rowsList);
  const maxR = Math.max(...rowsList);
  const minC = Math.min(...colsList);
  const maxC = Math.max(...colsList);

  let spans: GridSpan[] = [];
  if (selectedStorage.value.gridSpans) {
    try {
      spans = JSON.parse(selectedStorage.value.gridSpans);
    } catch (e) {}
  }

  const newSpan: GridSpan = {
    id: 'span_' + Math.random().toString(36).substring(2, 9),
    startRow: minR,
    startCol: minC,
    rowSpan: maxR - minR + 1,
    colSpan: maxC - minC + 1,
  };

  spans.push(newSpan);
  await saveSpans(spans);
};

const handleSplitCell = async (spanId: string) => {
  if (!selectedStorage.value) return;

  let spans: GridSpan[] = [];
  if (selectedStorage.value.gridSpans) {
    try {
      spans = JSON.parse(selectedStorage.value.gridSpans);
    } catch (e) {}
  }

  spans = spans.filter((s) => s.id !== spanId);
  await saveSpans(spans);
};

const saveSpans = async (spans: GridSpan[]) => {
  if (!selectedStorage.value) return;

  try {
    const response = await apiFetch(
      `/api/storages/${selectedStorage.value.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gridSpans: JSON.stringify(spans),
        }),
      },
    );

    if (response.ok) {
      selectedCellsForMerge.value = [];
      await fetchStorages();
      // Refresh data only — merge/split must keep the edited cell open and the
      // head container expanded (previously this reset the whole selection).
      await loadSelectedStorageComponents(selectedStorageId.value);
    }
  } catch (error) {
    console.error('Error saving spans:', error);
  }
};

const activeCellSpan = computed(() => {
  if (!selectedStorage.value || !selectedCellFilter.value) return null;
  let spans: GridSpan[] = [];
  if (selectedStorage.value.gridSpans) {
    try {
      spans = JSON.parse(selectedStorage.value.gridSpans);
    } catch (e) {}
  }
  return (
    spans.find(
      (span) =>
        span.startRow === selectedCellFilter.value!.r &&
        span.startCol === selectedCellFilter.value!.c,
    ) || null
  );
});

// Refetch everything when an AI agent turn may have mutated storage data, so agent
// changes (add / update / delete) appear without a manual page reload.
const refreshAll = async (): Promise<void> => {
  await fetchStorages();
  await fetchAllComponents();
  if (selectedStorageId.value) {
    await loadSelectedStorageComponents(selectedStorageId.value);
  }
};
watch(useAgentDataChanged(), () => {
  void refreshAll();
});

// Publish the precise selection to the AI chat page context, and clear it on leave
// so it never bleeds into another screen.
watch(pageContextSummary, (summary) => setPageContextSummary(summary), {
  immediate: true,
});
watch(pageContextRefs, (refs) => setPageContextRefs(refs), { immediate: true });
onUnmounted(() => {
  setPageContextSummary(null);
  setPageContextRefs(null);
});

// Route drives the open storage/cell — restore it on load and on any URL change.
watch(
  () => route.fullPath,
  () => {
    void syncFromRoute();
  },
  { immediate: true },
);

onMounted(() => {
  fetchStorages();
  fetchAllComponents();
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="$t('storages.title')"
      :subtitle="$t('storages.desc')"
      :icon="Archive"
    >
      <template #actions>
        <Button :icon-left="FolderPlus" @click="openAddModal()">
          {{ $t('storages.createButton') }}
        </Button>
      </template>
    </PageHeader>

    <!-- Main Workspace Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
      <!-- Left storage tree panel (1 Col) -->
      <div
        class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden flex flex-col"
      >
        <div
          class="p-4 border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-slate-900 flex items-center justify-between gap-2 flex-wrap"
        >
          <h3
            class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
          >
            {{ $t('storages.structureTitle') }}
          </h3>

          <!-- Tag filter, contributed by the tags plugin when enabled -->
          <PluginSlot
            name="storages.list.filters"
            :ctx="{
              pluginId: 'storages',
              entityType: 'storage',
              selectedTagId: tagFilter || null,
              onSelect: (id) => (tagFilter = id ?? ''),
              onMatches: onTagMatches,
            }"
          />
        </div>

        <div
          v-if="loadingStorages"
          class="flex justify-center items-center py-12"
        >
          <Spinner size="sm" />
        </div>

        <div
          v-else-if="storages.length === 0"
          class="p-8 text-center text-slate-500"
        >
          <Archive
            class="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2"
          />
          <span class="text-sm font-semibold">{{
            $t('storages.noStorages')
          }}</span>
          <span class="text-xs block text-slate-400 mt-1">{{
            $t('storages.noStoragesDesc')
          }}</span>
        </div>

        <div
          v-else
          class="divide-y divide-slate-100 dark:divide-slate-800 py-2"
        >
          <div
            v-for="s in treeStorages"
            :key="s.id"
            class="flex flex-col border-l-4 transition-colors"
            :class="[
              selectedStorageId === s.id
                ? 'bg-brand-500/5 border-brand-500'
                : 'border-transparent',
            ]"
          >
            <!-- Storage Row -->
            <div
              @click="selectStorage(s.id)"
              class="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-slate-100/30 dark:hover:bg-white/[0.02] group"
              :style="{ paddingLeft: `${s.depth * 1.25 + 0.8}rem` }"
            >
              <div class="flex items-center gap-1.5 overflow-hidden">
                <!-- Collapsible Chevron -->
                <button
                  v-if="s.hasChildren"
                  @click.stop="toggleExpand(s.id)"
                  class="p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 dark:text-slate-500 shrink-0"
                >
                  <ChevronDown v-if="s.isExpanded" class="w-3.5 h-3.5" />
                  <ChevronRight v-else class="w-3.5 h-3.5" />
                </button>
                <span v-else class="w-5 h-3 shrink-0" />
                <!-- empty offset -->

                <Folder class="w-4 h-4 text-brand-500 shrink-0" />
                <span
                  class="text-sm truncate"
                  :class="[
                    selectedStorageId === s.id
                      ? 'text-brand-600 dark:text-brand-400 font-bold'
                      : 'text-slate-700 dark:text-slate-300',
                  ]"
                >
                  {{ s.name }}
                </span>

                <!-- Display coordinate location inside parent grid if exists -->
                <span
                  v-if="s.parentRow !== null && s.parentCol !== null"
                  class="text-xxs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold shrink-0"
                >
                  {{ getCellAddress(s.parentRow, s.parentCol) }}
                </span>

                <span
                  v-if="s.gridRows && s.gridCols"
                  class="text-xxs px-1 py-0.2 rounded bg-brand-500/20 text-brand-600 font-bold shrink-0"
                >
                  {{ s.gridRows }}x{{ s.gridCols }}
                </span>
                <span
                  class="text-xxs font-bold px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0"
                >
                  {{ s.componentsCount }}
                </span>
              </div>

              <!-- Actions overlay -->
              <div
                class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <button
                  type="button"
                  @click.stop="openAddModal(s.id)"
                  class="p-1 text-slate-400 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-white/5 rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  :title="$t('storages.addSubsection')"
                  :aria-label="$t('storages.addSubsection')"
                >
                  <Plus class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  @click.stop="openEditModal(s)"
                  class="p-1 text-slate-400 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-white/5 rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                  :title="$t('storages.edit')"
                  :aria-label="$t('storages.edit')"
                >
                  <Edit2 class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  @click.stop="handleDeleteStorage(s)"
                  class="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                  :title="$t('storages.delete')"
                  :aria-label="$t('storages.delete')"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <!-- Mini clickable grid preview -->
            <div
              v-if="s.gridRows && s.gridCols && s.isExpanded"
              class="pb-3 pt-1 animate-fade-in flex"
              :style="{ paddingLeft: `${s.depth * 1.25 + 2.6}rem` }"
            >
              <div
                class="inline-grid gap-1 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 select-none shadow-sm"
                :style="{
                  gridTemplateColumns: `repeat(${s.gridCols}, 16px)`,
                  gridAutoRows: '16px',
                }"
              >
                <!-- Render using flat list of cells supporting spans -->
                <template
                  v-for="cell in getVisibleCellsForStorage(s)"
                  :key="`${cell.r}-${cell.c}`"
                >
                  <button
                    v-if="cell.visible"
                    type="button"
                    @click.stop="selectStorageAndCell(s.id, cell.r, cell.c)"
                    class="w-full h-full rounded-sm transition-all focus:outline-none border border-slate-400 dark:border-slate-600 flex items-center justify-center relative"
                    :style="{
                      gridColumn: `span ${cell.colSpan}`,
                      gridRow: `span ${cell.rowSpan}`,
                    }"
                    :class="[
                      selectedStorageId === s.id &&
                      selectedCellFilter &&
                      selectedCellFilter.r === cell.r &&
                      selectedCellFilter.c === cell.c
                        ? 'bg-brand-600 border-brand-700 dark:border-brand-500 ring-2 ring-brand-400/50 scale-105'
                        : isCellOnSelectedPath(s.id, cell.r, cell.c)
                          ? getCellStoragesCount(s.id, cell.r, cell.c) > 0
                            ? 'bg-amber-500 border-orange-600 dark:border-orange-500 animate-pulse'
                            : getCellComponentsCountForStorage(
                                  s.id,
                                  cell.r,
                                  cell.c,
                                ) > 0
                              ? 'bg-emerald-500 border-orange-600 dark:border-orange-500 animate-pulse'
                              : 'bg-white dark:bg-slate-900 border-orange-600 dark:border-orange-500 animate-pulse'
                          : getCellStoragesCount(s.id, cell.r, cell.c) > 0
                            ? 'bg-amber-500 border-amber-600 dark:bg-amber-500/80 hover:bg-amber-600'
                            : getCellComponentsCountForStorage(
                                  s.id,
                                  cell.r,
                                  cell.c,
                                ) > 0
                              ? 'bg-emerald-500 border-emerald-600 dark:bg-emerald-500/80 hover:bg-emerald-600'
                              : 'bg-white dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700',
                    ]"
                    :title="
                      $t('storages.cellTitle', {
                        address: getCellAddress(cell.r, cell.c),
                      })
                    "
                  />
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right contents panel (2 Cols) -->
      <div class="lg:col-span-2 space-y-4 animate-fade-in">
        <!-- Selected storage info -->
        <div
          v-if="selectedStorage"
          class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5 space-y-4 shadow-sm"
        >
          <div
            class="flex flex-col sm:flex-row justify-between sm:items-center gap-3"
          >
            <div class="space-y-1">
              <span
                class="text-xxs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block"
                >{{ $t('storages.cellPath') }}</span
              >
              <span
                class="text-sm font-semibold text-slate-900 dark:text-white flex items-center flex-wrap gap-x-1.5 gap-y-1"
              >
                <Box class="w-4 h-4 text-brand-500 shrink-0" />
                <template
                  v-for="(crumb, idx) in getStorageBreadcrumbs(
                    selectedStorage.id,
                  )"
                  :key="crumb.id"
                >
                  <!-- Separator -->
                  <span
                    v-if="idx > 0"
                    class="text-xs font-normal text-slate-400 dark:text-slate-600 px-0.5 select-none"
                    >/</span
                  >

                  <!-- Clickable name -->
                  <button
                    @click="selectStorage(crumb.id)"
                    class="hover:text-brand-500 hover:underline transition-all text-slate-800 dark:text-slate-200"
                    type="button"
                  >
                    {{ crumb.name }}
                  </button>

                  <!-- Coordinate badge -->
                  <span
                    v-if="crumb.coords"
                    class="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/15 leading-none shrink-0"
                  >
                    {{ crumb.coords }}
                  </span>
                </template>

                <!-- Selected cell within the current storage -->
                <template v-if="selectedCellAddress">
                  <span
                    class="text-xs font-normal text-slate-400 dark:text-slate-600 px-0.5 select-none"
                    >/</span
                  >
                  <span
                    class="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/15 leading-none shrink-0"
                  >
                    {{ selectedCellAddress }}
                  </span>
                </template>
              </span>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <div
                v-if="selectedStorage.location"
                class="flex items-center gap-1 text-xs text-slate-500"
              >
                <MapPin class="w-3.5 h-3.5 text-brand-500" />
                <span>{{
                  $t('storages.zone', { location: selectedStorage.location })
                }}</span>
              </div>
              <!-- Print-label action, contributed by the codes plugin (#74):
                   labels the open cell when one is selected, otherwise the whole
                   storage. Empty when codes is disabled. -->
              <PluginSlot
                v-if="cellTagRef || storageTagRef"
                name="storages.detail.actions"
                :ctx="{ entityRef: cellTagRef || storageTagRef }"
              />
              <!-- Same page.header.actions slot as every other page, so Export
                   sits top-right of the selected storage in the standard spot. -->
              <PluginSlot
                name="page.header.actions"
                :ctx="{ entityRef: storageTagRef }"
              />
            </div>
          </div>

          <!-- Tags for the selected storage, or the open cell — contributed by
               the tags plugin when enabled. -->
          <PluginSlot
            v-if="cellTagRef"
            name="storages.cell.meta"
            :ctx="{ entityRef: cellTagRef, editable: true }"
          />
          <PluginSlot
            v-else-if="storageTagRef"
            name="storages.detail.meta"
            :ctx="{ entityRef: storageTagRef, editable: true }"
          />
        </div>

        <!-- 2D Interactive Grid Visualization -->
        <div
          v-if="
            selectedStorage &&
            selectedStorage.gridRows &&
            selectedStorage.gridCols &&
            expandedStorages[selectedStorage.id]
          "
          class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5 space-y-4"
        >
          <div
            class="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-white/5 gap-2 flex-wrap"
          >
            <h4
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
            >
              <Grid class="w-4 h-4 text-brand-500" />
              {{
                $t('storages.visualGridTitle', {
                  rows: selectedStorage.gridRows,
                  cols: selectedStorage.gridCols,
                })
              }}
            </h4>

            <div class="flex items-center gap-3">
              <button
                v-if="gridEditingVisible"
                @click="toggleMergeMode()"
                class="flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-bold transition-all"
                :class="[
                  mergeMode
                    ? 'bg-purple-600 border-purple-700 text-white shadow-md shadow-purple-600/10'
                    : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10',
                ]"
              >
                <Layers class="w-3.5 h-3.5 animate-pulse" />
                {{
                  mergeMode
                    ? $t('storages.exitMergeMode')
                    : $t('storages.mergeCells')
                }}
              </button>

              <button
                v-if="selectedCellFilter"
                @click="selectedCellFilter = null"
                class="text-xxs font-bold text-brand-600 dark:text-brand-400 hover:underline"
              >
                {{ $t('storages.showAllCells') }}
              </button>
            </div>
          </div>

          <!-- Merge Mode Action Bar -->
          <div
            v-if="gridEditingVisible && mergeMode"
            class="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between flex-wrap gap-2 animate-fade-in"
          >
            <span
              class="text-xs text-purple-800 dark:text-purple-300 font-medium flex items-center gap-1.5"
            >
              <Info class="w-4 h-4 text-purple-500" />
              {{ $t('storages.mergeInstructions') }}
            </span>

            <div class="flex items-center gap-2">
              <!-- Merge Button -->
              <button
                v-if="selectedCellsForMerge.length >= 2"
                @click="handleMergeCells()"
                :disabled="!canMergeSelection"
                class="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all shadow-sm"
                :class="[
                  canMergeSelection
                    ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/10'
                    : 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed',
                ]"
                :title="
                  !canMergeSelection
                    ? $t('storages.mergeValidationTooltip')
                    : ''
                "
              >
                {{
                  $t('storages.mergeCount', {
                    count: selectedCellsForMerge.length,
                  })
                }}
              </button>

              <!-- Split Button -->
              <button
                v-if="
                  selectedCellsForMerge.length === 1 && getSelectedCellSpanId()
                "
                @click="handleSplitCell(getSelectedCellSpanId()!)"
                class="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm shadow-red-600/10 animate-pulse"
              >
                {{ $t('storages.splitCell') }}
              </button>

              <button
                @click="clearMergeSelection()"
                class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition-all"
              >
                {{ $t('storages.resetSelection') }}
              </button>
            </div>
          </div>

          <!-- Dynamic Grid Container -->
          <div class="overflow-x-auto pb-2">
            <div class="inline-block min-w-full align-middle">
              <div
                class="grid gap-2 border border-slate-200 dark:border-white/5 p-4 rounded-xl bg-slate-50/50 dark:bg-slate-900"
                :style="{
                  gridTemplateColumns: `repeat(${selectedStorage.gridCols}, minmax(4.5rem, 1fr))`,
                  gridAutoRows: '5.5rem',
                }"
              >
                <!-- Render using flat list of cells supporting spans -->
                <button
                  v-for="cell in visibleGridCells"
                  :key="cell.id"
                  @click="
                    mergeMode
                      ? toggleMergeCellSelection(cell.row, cell.col)
                      : toggleCellFilter(cell.row, cell.col)
                  "
                  type="button"
                  class="flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all min-w-[4.5rem] relative group w-full h-full"
                  :style="{
                    gridColumn: `span ${cell.colSpan}`,
                    gridRow: `span ${cell.rowSpan}`,
                  }"
                  :class="[
                    mergeMode
                      ? selectedCellsForMerge.some(
                          (coord) =>
                            coord.r === cell.row && coord.c === cell.col,
                        )
                        ? 'bg-purple-500/20 border-purple-500 text-purple-700 dark:text-purple-400 ring-2 ring-purple-400 scale-95 shadow-inner'
                        : 'bg-white dark:bg-slate-800 border-purple-300/40 dark:border-purple-800/40 text-slate-700 dark:text-slate-300 hover:bg-purple-500/5 hover:border-purple-400'
                      : selectedCellFilter &&
                          selectedCellFilter.r === cell.row &&
                          selectedCellFilter.c === cell.col
                        ? 'bg-brand-600 dark:bg-brand-600 text-white border-brand-500 shadow-lg shadow-brand-500/20 scale-95 ring-2 ring-brand-400'
                        : cell.componentsCount > 0
                          ? 'bg-brand-500/10 border-brand-500/30 text-brand-700 dark:text-brand-400 hover:bg-brand-500/20'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
                  ]"
                >
                  <!-- Visual dot indicator for filled cells -->
                  <span
                    v-if="!mergeMode && cell.componentsCount > 0"
                    class="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full"
                  />

                  <!-- Orange small indicator for nested storages -->
                  <span
                    v-if="!mergeMode && cell.storagesCount > 0"
                    class="absolute bottom-1.5 left-1.5 px-1 rounded bg-amber-500 text-white text-[9px] font-bold"
                    :title="$t('storages.nestedContainersTooltip')"
                  >
                    {{ cell.storagesCount }}
                  </span>

                  <!-- Hover Add Button shortcut -->
                  <span
                    v-if="!mergeMode"
                    @click.stop="
                      openNewComponentForCell(
                        selectedStorage.id,
                        cell.row,
                        cell.col,
                      )
                    "
                    class="absolute bottom-1 right-1 p-0.5 rounded bg-brand-500 hover:bg-brand-600 text-white opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-105"
                    :title="$t('storages.addPartToCell')"
                  >
                    <Plus class="w-3.5 h-3.5" />
                  </span>

                  <!-- Excel Address -->
                  <span class="text-xxs font-bold opacity-60">{{
                    cell.address
                  }}</span>
                  <!-- Count -->
                  <span
                    v-if="cell.componentsCount > 0"
                    class="text-xs font-black mt-1"
                  >
                    {{ $t('storages.pcs', { count: cell.componentsCount }) }}
                  </span>
                  <span v-else class="text-xxs opacity-30 mt-1">-</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Nested Storages / Drawers inside active cell coordinate -->
        <div
          v-if="selectedStorage && nestedStorages.length > 0"
          class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5 space-y-3 animate-fade-in"
        >
          <h4
            class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5"
          >
            <Folder class="w-4 h-4 text-amber-500" />
            {{
              selectedCellFilter
                ? $t('storages.nestedContainersInCell', {
                    address: getCellAddress(
                      selectedCellFilter.r,
                      selectedCellFilter.c,
                    ),
                  })
                : $t('storages.nestedContainersInStorage')
            }}
          </h4>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="sub in nestedStorages"
              :key="sub.id"
              @click="selectStorage(sub.id)"
              class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-slate-800 hover:bg-brand-500/10 hover:border-brand-500/30 text-slate-700 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-all text-xs font-semibold"
            >
              <Folder class="w-4 h-4 text-brand-500 shrink-0" />
              <span>{{ sub.name }}</span>
              <span
                v-if="sub.parentRow !== null && sub.parentCol !== null"
                class="text-xxs opacity-70"
              >
                ({{ getCellAddress(sub.parentRow, sub.parentCol) }})
              </span>
              <span
                class="text-xxs px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
              >
                {{ $t('storages.pcs', { count: sub.componentsCount }) }}
              </span>
            </button>
          </div>
        </div>

        <!-- Component List -->
        <div
          class="glass-card rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden"
        >
          <div
            class="p-4 border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-slate-900 flex justify-between items-center flex-wrap gap-2"
          >
            <h3
              class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5"
            >
              {{ $t('storages.partsInCell') }}
              <span
                v-if="selectedCellFilter"
                class="px-2 py-0.5 rounded bg-brand-500/20 text-brand-600 font-bold"
              >
                {{
                  $t('storages.filterByCell', {
                    address: getCellAddress(
                      selectedCellFilter.r,
                      selectedCellFilter.c,
                    ),
                  })
                }}
              </span>
              <span class="text-xxs opacity-70">{{
                $t('storages.totalCount', { count: filteredComponents.length })
              }}</span>
              <!-- Status of any background process a plugin is running AGAINST
                   THIS CELL (#79) — e.g. a live phone scan session filing items
                   into it. The host only names the cell; contributors match on
                   that ref, so an indicator never shows on a cell it isn't
                   about. Empty when nothing is running. -->
              <PluginSlot
                v-if="cellTagRef"
                name="storages.cell.status"
                :ctx="{ entityRef: cellTagRef }"
              />
            </h3>

            <div class="flex items-center gap-2">
              <!-- Split merged cell directly from selected view -->
              <button
                v-if="
                  gridEditingVisible &&
                  selectedStorage &&
                  selectedCellFilter &&
                  activeCellSpan
                "
                @click="handleSplitCell(activeCellSpan.id)"
                class="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/25 text-red-600 dark:text-red-400 border border-red-500/25 rounded-xl text-xs font-bold transition-all"
              >
                <Layers class="w-3.5 h-3.5" />
                {{ $t('storages.splitCell') }}
              </button>

              <!-- Quick Add sub-storage inside cell -->
              <button
                v-if="selectedStorage && selectedCellFilter"
                @click="
                  openAddModalWithCell(
                    selectedStorage.id,
                    selectedCellFilter.r,
                    selectedCellFilter.c,
                  )
                "
                class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold transition-all"
              >
                <FolderPlus class="w-3.5 h-3.5 text-brand-500" />
                {{ $t('storages.addBoxDrawer') }}
              </button>

              <!-- Quick Add component inside cell -->
              <button
                v-if="selectedStorage && selectedCellFilter"
                @click="
                  openNewComponentForCell(
                    selectedStorage.id,
                    selectedCellFilter.r,
                    selectedCellFilter.c,
                  )
                "
                class="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-brand-600/10"
              >
                <Plus class="w-3.5 h-3.5" />
                {{ $t('storages.addComponent') }}
              </button>

              <!-- Actions on what LIVES in the open cell (#79) — contributed by
                   the plugin that owns the placement (inventory), next to the
                   cell's own "add" actions. Storages only names the cell; it
                   never writes another plugin's models. Empty when no such
                   plugin is enabled. -->
              <PluginSlot
                v-if="cellActionsCtx"
                name="storages.cell.actions"
                :ctx="cellActionsCtx"
              />
            </div>
          </div>

          <div
            v-if="loadingComponents"
            class="flex justify-center items-center py-16"
          >
            <Spinner />
          </div>

          <div
            v-else-if="!selectedStorageId"
            class="p-16 text-center text-slate-500"
          >
            <Info class="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <span class="text-sm">{{ $t('storages.selectStorageHint') }}</span>
          </div>

          <div
            v-else-if="filteredComponents.length === 0"
            class="p-16 text-center text-slate-500 space-y-3"
          >
            <Box class="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600" />
            <div>
              <span
                class="text-sm font-semibold block text-slate-800 dark:text-slate-200"
              >
                {{
                  selectedCellFilter
                    ? $t('storages.emptyInCell', {
                        address: getCellAddress(
                          selectedCellFilter.r,
                          selectedCellFilter.c,
                        ),
                      })
                    : $t('storages.emptyInStorage')
                }}
              </span>
              <span class="text-xs text-slate-500 block mt-1">{{
                $t('storages.emptyHint')
              }}</span>
            </div>

            <button
              @click="
                selectedCellFilter
                  ? openNewComponentForCell(
                      selectedStorage.id,
                      selectedCellFilter.r,
                      selectedCellFilter.c,
                    )
                  : router.push('/inventory/new')
              "
              class="px-4 py-2 bg-brand-500/10 hover:bg-brand-500/20 text-brand-600 dark:text-brand-400 border border-brand-500/15 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 mx-auto"
            >
              <Plus class="w-4 h-4" />
              {{ $t('storages.addComponent') }}
            </button>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr
                  class="border-b border-slate-200 dark:border-white/5 bg-slate-100/30 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xxs font-semibold uppercase tracking-wider"
                >
                  <th class="px-6 py-4">
                    {{ $t('storages.table.component') }}
                  </th>
                  <th v-if="categoriesVisible" class="px-6 py-4">
                    {{ $t('storages.table.category') }}
                  </th>
                  <th class="px-6 py-4">
                    {{ $t('storages.table.exactAddress') }}
                  </th>
                  <th class="px-6 py-4 text-right">
                    {{ $t('storages.table.quantity') }}
                  </th>
                  <th class="px-6 py-4 text-right">
                    {{ $t('storages.table.actions') }}
                  </th>
                </tr>
              </thead>
              <tbody
                class="divide-y divide-slate-200 dark:divide-slate-800 text-sm"
              >
                <tr
                  v-for="c in filteredComponents"
                  :key="c.id"
                  class="hover:bg-slate-100/20 dark:hover:bg-slate-800 transition-colors"
                >
                  <td class="px-6 py-4">
                    <div class="flex flex-col">
                      <span
                        class="font-medium text-slate-900 dark:text-white"
                        >{{ c.name }}</span
                      >
                      <span class="text-xxs text-slate-500 font-mono mt-0.5">{{
                        c.sku || $t('storages.noSku')
                      }}</span>
                    </div>
                  </td>
                  <td v-if="categoriesVisible" class="px-6 py-4">
                    <Badge v-if="c.categoryRef" variant="label">
                      {{ c.categoryRef.name }}
                    </Badge>
                    <span
                      v-else
                      class="text-xs text-slate-400 dark:text-slate-500"
                    >
                      {{ $t('storages.noCategory') }}
                    </span>
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-1.5">
                      <span
                        v-if="c.storageRow !== null && c.storageCol !== null"
                        class="text-xs px-2 py-0.5 rounded bg-brand-500/10 text-brand-600 font-bold"
                      >
                        {{
                          $t('storages.cellAddressLabel', {
                            address: getCellAddress(
                              c.storageRow || 0,
                              c.storageCol || 0,
                            ),
                          })
                        }}
                      </span>
                      <span v-if="c.location" class="text-xs text-slate-500">
                        ({{ c.location }})
                      </span>
                    </div>
                  </td>
                  <td
                    class="px-6 py-4 text-right font-bold text-slate-800 dark:text-slate-200"
                  >
                    {{ $t('storages.pcs', { count: c.quantity }) }}
                  </td>
                  <td class="px-6 py-4 text-right">
                    <button
                      @click="router.push(`/inventory/${c.id}/edit`)"
                      class="px-3 py-1.5 bg-brand-500/10 text-brand-600 dark:text-brand-400 rounded-xl text-xxs font-bold hover:bg-brand-500/20 transition-all inline-flex items-center gap-1"
                    >
                      {{ $t('storages.edit') }}
                      <ArrowRight class="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Add/Edit Storage Modal -->
    <Modal
      v-model="showAddEditModal"
      width="md"
      :title="
        isEditMode
          ? $t('storages.modal.editTitle')
          : $t('storages.modal.createTitle')
      "
    >
      <form @submit.prevent="handleSaveStorage" class="space-y-4">
        <!-- Name -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('storages.modal.nameLabel') }}</label
          >
          <input
            v-model="storageName"
            type="text"
            :placeholder="$t('storages.modal.namePlaceholder')"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            required
          />
        </div>

        <!-- Parent Storage -->
        <div class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('storages.modal.parentLabel') }}</label
          >
          <Select
            v-model="storageParentId"
            :options="[
              {
                value: '',
                label: t('storages.modal.rootStorage'),
                empty: true,
              },
              ...storages
                .filter((s) => s.id !== editingStorageId)
                .map((s) => ({ value: s.id, label: getStoragePath(s.id) })),
            ]"
          />
        </div>

        <!-- Coordinate Selectors when selected parent is grid-based. Hidden in
               simple mode; the refs keep their loaded/prefilled values so saving
               never clobbers an existing placement. -->
        <div
          v-if="advancedFieldsVisible && isParentStorageGrid"
          class="grid grid-cols-2 gap-4 animate-fade-in pl-3 border-l-2 border-brand-500/35"
        >
          <div class="space-y-1.5">
            <label class="text-xxs font-bold text-slate-500 block">{{
              $t('storages.modal.placeInRow')
            }}</label>
            <Select v-model="storageParentRow" :options="parentRowOptions" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xxs font-bold text-slate-500 block">{{
              $t('storages.modal.placeInCol')
            }}</label>
            <Select v-model="storageParentCol" :options="parentColOptions" />
          </div>
        </div>

        <!-- Location (physical area). Hidden in simple mode; the ref keeps the
               loaded value so saving never clobbers an existing zone. -->
        <div v-if="advancedFieldsVisible" class="space-y-1.5">
          <label
            class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >{{ $t('storages.modal.physicalZone') }}</label
          >
          <input
            v-model="storageLocation"
            type="text"
            :placeholder="$t('storages.modal.physicalZonePlaceholder')"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          />
        </div>

        <!-- 2D Grid settings toggle -->
        <div
          class="space-y-3 pt-2 border-t border-slate-200 dark:border-white/5"
        >
          <div class="flex items-center gap-2">
            <Switch
              v-model="isGridToggle"
              :aria-label="$t('storages.modal.useGrid')"
            />
            <span class="text-xs font-bold text-slate-800 dark:text-slate-200">
              {{ $t('storages.modal.useGrid') }}
            </span>
          </div>

          <div
            v-if="isGridToggle"
            class="grid grid-cols-2 gap-4 animate-fade-in pl-6"
          >
            <div class="space-y-1.5">
              <label class="text-xxs font-bold text-slate-500 block">{{
                $t('storages.modal.rowsCount')
              }}</label>
              <input
                v-model.number="gridRows"
                type="number"
                min="1"
                max="15"
                class="w-full glass-input rounded-xl px-4 py-2 text-xs font-bold text-center"
              />
            </div>

            <div class="space-y-1.5">
              <label class="text-xxs font-bold text-slate-500 block">{{
                $t('storages.modal.colsCount')
              }}</label>
              <input
                v-model.number="gridCols"
                type="number"
                min="1"
                max="15"
                class="w-full glass-input rounded-xl px-4 py-2 text-xs font-bold text-center"
              />
            </div>
          </div>
        </div>

        <!-- Modal Action Footer -->
        <div
          class="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-white/5"
        >
          <Button
            variant="secondary"
            size="sm"
            @click="showAddEditModal = false"
          >
            {{ $t('storages.modal.cancel') }}
          </Button>
          <Button type="submit" size="sm">
            {{ $t('storages.modal.save') }}
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
