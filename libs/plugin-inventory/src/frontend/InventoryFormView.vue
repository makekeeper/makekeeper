<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  Select,
  RichEditor,
  Button,
  Spinner,
  useConfirm,
  useToastStore,
  apiFetch,
  apiJson,
  buildTreeOptions,
  Badge,
  usePageContext,
  useUxMode,
  usePluginsStore,
  PluginSlot,
  readAsDataUrl,
  PhotoGallery,
  ImageLightbox,
  type GalleryPhoto,
  type LightboxImage,
} from '@makekeeper/frontend-core';
import {
  formatObjectRef,
  formatCellAddress,
} from '@makekeeper/plugin-contract';
import { MAX_ITEM_PHOTOS, type ComponentPhoto } from '../photos';
import type {
  ComponentPropertyValueDto,
  EffectiveProperty,
  ItemCategoryDto,
} from '../categories';
import { useRoute, useRouter, type LocationQueryValue } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  Cpu,
  Save,
  Trash2,
  FileText,
  Package,
  Plus,
  Globe,
  Tag,
  ShoppingCart,
  Clock,
  ImagePlus,
  AlertTriangle,
  Pencil,
  Check,
  ExternalLink,
} from '@lucide/vue';

const route = useRoute();
const router = useRouter();

// vue-router query values are `string | null | (string | null)[]`; take the
// first usable string so a `?sku=`/`?storageId=` prefill stays correct even if a
// param arrives duplicated (array-valued).
const firstQueryValue = (
  value: LocationQueryValue | LocationQueryValue[],
): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
const { t, locale } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();

// Simple/advanced UX-mode gating (#53) — a display lens only; hidden fields
// keep their loaded values and are re-sent unchanged on save.
const { isFeatureVisible } = useUxMode();
const showExtraFields = computed(() =>
  isFeatureVisible('inventory.extraFields'),
);
const showHistoryPanels = computed(() =>
  isFeatureVisible('inventory.historyPanels'),
);
// Categories & typed properties (#205) are their own lens (#269) — previously
// half-bundled under `extraFields` (the property editor) with the category
// Select ungated, so the pair could contradict each other.
const showCategories = computed(() => isFeatureVisible('inventory.categories'));

const isEdit = ref(false);
const componentId = ref('');
const loading = ref(false);

// ── Read-only activity: related orders + stock movements (edit mode only) ────
interface StockMovement {
  id: string;
  delta: number;
  type: string;
  note?: string;
  createdAt: string;
}

interface RelatedOrder {
  orderId: string;
  storeName: string;
  status: string;
  quantity: number;
  orderDate: string;
}

const movements = ref<StockMovement[]>([]);
const loadingMovements = ref(false);
const relatedOrders = ref<RelatedOrder[]>([]);
const loadingOrders = ref(false);

const formatQty = (value: number): string =>
  String(parseFloat((value ?? 0).toFixed(3)));

const formatDate = (value: string): string =>
  new Date(value).toLocaleString(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

const movementTypeLabel = (type: string): string =>
  t(`inventory.movementTypes.${type}`, type);

const movementTypeClass = (type: string): string => {
  const classes: Record<string, string> = {
    PURCHASE:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    RESERVED:
      'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20',
    USED: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    ADJUSTMENT:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    RETURN:
      'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/5',
  };
  return classes[type] || 'bg-slate-100 text-slate-500';
};

const orderStatusLabel = (status: string): string =>
  t(`inventory.orderStatus.${status}`, status);

const orderStatusClass = (status: string): string => {
  const classes: Record<string, string> = {
    CART: 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/5',
    ORDERED: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    SHIPPED:
      'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20',
    DELIVERED:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  };
  return classes[status] || 'bg-slate-100 text-slate-500';
};

// Neighbouring plugins' surfaces (#58): the storage picker belongs to
// storages, the related-orders panel to logistics — both exist (and fetch)
// only while their owner is enabled. A hidden picker keeps the loaded
// storageId so saving never clobbers the placement.
const pluginsStore = usePluginsStore();
const storagesEnabled = computed(() => pluginsStore.isEnabled('storages'));
const logisticsEnabled = computed(() => pluginsStore.isEnabled('logistics'));

const fetchActivity = async (): Promise<void> => {
  loadingMovements.value = true;
  loadingOrders.value = logisticsEnabled.value;
  try {
    const [mvRes, ordRes] = await Promise.all([
      apiFetch(`/api/components/${componentId.value}/movements`),
      logisticsEnabled.value
        ? apiFetch(`/api/components/${componentId.value}/orders`)
        : Promise.resolve(null),
    ]);
    if (mvRes.ok) movements.value = await mvRes.json();
    if (ordRes?.ok) relatedOrders.value = await ordRes.json();
  } catch (error) {
    console.error('Error fetching component activity:', error);
  } finally {
    loadingMovements.value = false;
    loadingOrders.value = false;
  }
};

const formName = ref('');
const formSku = ref('');
const formCategoryId = ref('');

// The category's typed properties and this item's values for them (#205).
// Loaded from the server so the inheritance rule is resolved in exactly one
// place, and re-loaded whenever the category changes.
const categoryList = ref<ItemCategoryDto[]>([]);
const effectiveProperties = ref<EffectiveProperty[]>([]);
const propertyValues = ref<Record<string, string>>({});
// Values other items already carry for a text property, keyed by property id.
// Offered while typing so one shelf label does not become four spellings of
// itself — which costs something the moment anything else reads the value.
const propertySuggestions = ref<Record<string, string[]>>({});

// Soft duplicate check (#33 E4): components already sharing this SKU. Populated
// on SKU blur; purely advisory — never blocks saving.
const skuMatches = ref<{ id: string; name: string; sku: string }[]>([]);

const checkSku = async (): Promise<void> => {
  const sku = formSku.value.trim();
  if (!sku) {
    skuMatches.value = [];
    return;
  }
  try {
    const params = new URLSearchParams({ sku });
    if (isEdit.value && componentId.value) {
      params.set('excludeId', componentId.value);
    }
    const res = await apiFetch(`/api/components/by-sku?${params.toString()}`);
    skuMatches.value = res.ok ? await res.json() : [];
  } catch {
    skuMatches.value = [];
  }
};
const formQty = ref(0);
const formMinQty = ref(0);
const formUnit = ref('pcs');

// Unit codes are technical identifiers (not user text); their labels are i18n.
const UNIT_CODES = [
  'pcs',
  'm',
  'cm',
  'mm',
  'g',
  'kg',
  'ml',
  'l',
  'roll',
  'pack',
  'set',
] as const;
const unitOptions = computed(() =>
  UNIT_CODES.map((code) => ({
    value: code,
    label: t(`inventory.units.${code}`),
  })),
);
const formDescription = ref('');

// Photographs (#214, epic #212). The form holds the whole set, so Cancel really
// cancels: nothing is uploaded, adopted or deleted until Save.
//
// One entry is either a photo the item already has (`src` = its stored
// "/api/uploads/:id" URL) or one just picked (`src` = a data URL). Both travel
// in the same list, in the same order, and the save sends exactly that list —
// the server stores what is new, deletes what left and pins the first.
interface FormPhoto {
  key: string;
  src: string;
}

const formPhotos = ref<FormPhoto[]>([]);
// Which entry is the cover, by key. Null means "the first one", which is also
// what the server falls back to.
const formCoverKey = ref<string | null>(null);
// Which photo the lightbox is showing; null closes it.
const lightboxKey = ref<string | null>(null);
let pendingPhotoSeq = 0;

const coverKey = computed<string | null>(() => {
  if (formPhotos.value.length === 0) return null;
  const pinned = formPhotos.value.find(
    (photo) => photo.key === formCoverKey.value,
  );
  return pinned?.key ?? formPhotos.value[0].key;
});

const galleryPhotos = computed<GalleryPhoto[]>(() =>
  formPhotos.value.map((photo) => ({
    key: photo.key,
    src: photo.src,
    isCover: photo.key === coverKey.value,
  })),
);

// The lightbox shows the full-size picture, so a stored photo goes by its URL
// (it resolves the `lg` rendition itself) and a pending pick by its own bytes.
const lightboxImages = computed<LightboxImage[]>(() =>
  formPhotos.value.map((photo) => ({
    id: photo.key,
    url: photo.src,
    filename: null,
  })),
);

// The set the loaded item started with, so a save can be told what is genuinely
// new — and so `photos` is only sent when it actually changed.
const addPhotos = async (files: File[]): Promise<void> => {
  for (const file of files) {
    if (formPhotos.value.length >= MAX_ITEM_PHOTOS) break;
    try {
      formPhotos.value.push({
        key: `pending_${++pendingPhotoSeq}`,
        src: await readAsDataUrl(file),
      });
    } catch {
      toast.error(t('inventory.form.imageError'));
    }
  }
};

// A saved item's picture is worth a question; a pick made ten seconds ago is
// not. Only the former is confirmed.
const removePhoto = async (key: string): Promise<void> => {
  const photo = formPhotos.value.find((entry) => entry.key === key);
  if (!photo) return;
  if (!photo.src.startsWith('data:')) {
    const ok = await confirm({
      message: t('inventory.form.removePhotoConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
  }
  formPhotos.value = formPhotos.value.filter((entry) => entry.key !== key);
  // Deleting the cover simply lets the fallback move on — no dialog.
  if (formCoverKey.value === key) formCoverKey.value = null;
};

const makeCover = (key: string): void => {
  formCoverKey.value = key;
};

// Fill the gallery from a payload's `photos`. A stored photo keys by its
// attachment id, so re-covering and removing survive the round trip.
const isComponentPhoto = (entry: unknown): entry is ComponentPhoto => {
  if (typeof entry !== 'object' || entry === null) return false;
  // Narrowed off an index signature rather than asserted through the target
  // type — a cast inside a guard defeats the guard (§5.1).
  const candidate: Record<string, unknown> = { ...entry };
  return typeof candidate.id === 'string' && typeof candidate.url === 'string';
};

const loadPhotos = (photos: unknown): void => {
  const list: ComponentPhoto[] = Array.isArray(photos)
    ? photos.filter(isComponentPhoto)
    : [];
  formPhotos.value = list.map((photo) => ({ key: photo.id, src: photo.url }));
  formCoverKey.value = list.find((photo) => photo.isCover)?.id ?? null;
  lightboxKey.value = null;
};

// What the save sends: the cover first, then the rest in their existing order.
// The server pins the first entry, and the list is otherwise re-read in upload
// order — so "cover first" is a message about the pin, not about the layout.
const photosPayload = computed<string[]>(() => {
  const chosen = coverKey.value;
  return [
    ...formPhotos.value.filter((photo) => photo.key === chosen),
    ...formPhotos.value.filter((photo) => photo.key !== chosen),
  ].map((photo) => photo.src);
});

// `editing` is transient UI state (display ↔ edit per row); it's stripped before
// the links are persisted. Saved links open in display mode, new ones in edit.
interface FormLink {
  label: string;
  url: string;
  editing?: boolean;
  // Pre-edit snapshot so Esc can cancel; transient, never persisted.
  orig?: { label: string; url: string };
}
const formLinks = ref<FormLink[]>([]);

// A safe href for the clickable link: a bare "example.com" gets an https scheme
// so the browser doesn't treat it as an in-app relative path.
const linkHref = (url: string): string =>
  /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
// Custom characteristics mirror the links table: display ↔ edit per row, the
// `editing` flag transient and stripped before persisting.
interface FormCustomField {
  key: string;
  value: string;
  editing?: boolean;
  // Pre-edit snapshot so Esc can cancel; transient, never persisted.
  orig?: { key: string; value: string };
}
const formCustomFields = ref<FormCustomField[]>([]);
const formStorageId = ref('');
const storagesList = ref<any[]>([]);
const formStorageRow = ref<number | null>(null);
const formStorageCol = ref<number | null>(null);

// Publish this component (when editing) and its storage placement (when set) as
// canonical ORefs for the AI chat page context (#16). On the new-component form
// prefilled from a storage cell, this carries "mk://storages/storage/<id>#B1" so
// the agent knows exactly which cell is being filled.
const pageContextRefs = computed<string[] | null>(() => {
  const refs: string[] = [];
  if (componentId.value) {
    const componentRef = formatObjectRef({
      pluginId: 'inventory',
      entityType: 'component',
      entityId: componentId.value,
    });
    if (componentRef) refs.push(componentRef);
  }
  if (formStorageId.value) {
    const cell = formatCellAddress(formStorageRow.value, formStorageCol.value);
    const storageRef = formatObjectRef({
      pluginId: 'storages',
      entityType: 'storage',
      entityId: formStorageId.value,
      ...(cell ? { fragment: cell } : {}),
    });
    if (storageRef) refs.push(storageRef);
  }
  return refs.length ? refs : null;
});
usePageContext(pageContextRefs);

// Canonical ORef of the edited component, for the tag chips slot.
const componentTagRef = computed<string>(
  () =>
    formatObjectRef({
      pluginId: 'inventory',
      entityType: 'component',
      entityId: componentId.value,
    }) ?? '',
);

const selectedStorageDetails = computed(() => {
  return storagesList.value.find((s) => s.id === formStorageId.value) || null;
});

const isSelectedStorageGrid = computed(() => {
  return !!(
    selectedStorageDetails.value?.gridRows &&
    selectedStorageDetails.value?.gridCols
  );
});

const rowOptions = computed(() => {
  if (!selectedStorageDetails.value?.gridRows) return [];
  return Array.from(
    { length: selectedStorageDetails.value.gridRows },
    (_, i) => ({
      value: i,
      label: t('inventory.form.row', { num: i + 1 }),
    }),
  );
});

const colOptions = computed(() => {
  if (!selectedStorageDetails.value?.gridCols) return [];
  return Array.from(
    { length: selectedStorageDetails.value.gridCols },
    (_, i) => ({
      value: i,
      label: t('inventory.form.column', { char: String.fromCharCode(65 + i) }),
    }),
  );
});

watch(formStorageId, (newId) => {
  const s = storagesList.value.find((item) => item.id === newId);
  if (s && s.gridRows && s.gridCols) {
    if (formStorageRow.value === null || formStorageRow.value === undefined) {
      formStorageRow.value = 0;
    }
    if (formStorageCol.value === null || formStorageCol.value === undefined) {
      formStorageCol.value = 0;
    }
  } else {
    formStorageRow.value = null;
    formStorageCol.value = null;
  }
});

const fetchStoragesList = async () => {
  if (!storagesEnabled.value) return;
  try {
    const res = await apiFetch('/api/storages');
    if (res.ok) {
      storagesList.value = await res.json();
    }
  } catch (error) {
    console.error('Error fetching storages:', error);
  }
};

const getStoragePathLabel = (id: string | null): string => {
  if (!id) return '';
  const current = storagesList.value.find((s) => s.id === id);
  if (!current) return '';
  if (current.parentId) {
    return getStoragePathLabel(current.parentId) + ' > ' + current.name;
  }
  return current.name;
};

const storageOptions = computed(() => {
  return [
    { value: '', label: t('inventory.form.selectStorage'), empty: true },
    ...storagesList.value.map((s) => ({
      value: s.id,
      label: getStoragePathLabel(s.id),
    })),
  ];
});

const handleAddLink = () => {
  formLinks.value.push({ label: '', url: '', editing: true });
};

const handleRemoveLink = (index: number) => {
  formLinks.value.splice(index, 1);
};

// Toggle a saved link into edit mode; done() collapses it back to display when
// it has both fields (an empty row is just removed). Esc cancels: it restores
// the pre-edit snapshot, or drops a never-saved new row.
const editLink = (index: number): void => {
  const link = formLinks.value[index];
  if (!link) return;
  link.orig = { label: link.label, url: link.url };
  link.editing = true;
};
const doneEditLink = (index: number): void => {
  const link = formLinks.value[index];
  if (!link) return;
  if (!link.label.trim() && !link.url.trim()) {
    formLinks.value.splice(index, 1);
    return;
  }
  delete link.orig;
  link.editing = false;
};
const cancelEditLink = (index: number): void => {
  const link = formLinks.value[index];
  if (!link) return;
  if (!link.orig) {
    formLinks.value.splice(index, 1);
    return;
  }
  link.label = link.orig.label;
  link.url = link.orig.url;
  delete link.orig;
  link.editing = false;
};

const handleAddCustomField = () => {
  formCustomFields.value.push({ key: '', value: '', editing: true });
};

const handleRemoveCustomField = (index: number) => {
  formCustomFields.value.splice(index, 1);
};

// Toggle a saved characteristic into edit mode; done() collapses it back when
// it has both fields (an empty row is just removed). Esc cancels: restore the
// pre-edit snapshot, or drop a never-saved new row.
const editCustomField = (index: number): void => {
  const field = formCustomFields.value[index];
  if (!field) return;
  field.orig = { key: field.key, value: field.value };
  field.editing = true;
};
const doneEditCustomField = (index: number): void => {
  const field = formCustomFields.value[index];
  if (!field) return;
  if (!field.key.trim() && !field.value.trim()) {
    formCustomFields.value.splice(index, 1);
    return;
  }
  delete field.orig;
  field.editing = false;
};
const cancelEditCustomField = (index: number): void => {
  const field = formCustomFields.value[index];
  if (!field) return;
  if (!field.orig) {
    formCustomFields.value.splice(index, 1);
    return;
  }
  field.key = field.orig.key;
  field.value = field.orig.value;
  delete field.orig;
  field.editing = false;
};

// Enter (inside a field) confirms that row; Esc is handled globally below so it
// works whether or not a field is focused.
const onLinkEditKey = (event: KeyboardEvent, index: number): void => {
  if (event.key === 'Enter') {
    event.preventDefault();
    doneEditLink(index);
  }
};
const onCustomFieldEditKey = (event: KeyboardEvent, index: number): void => {
  if (event.key === 'Enter') {
    event.preventDefault();
    doneEditCustomField(index);
  }
};

// Esc cancels any open row editors regardless of focus. Iterate from the end so
// removing never-saved empty rows doesn't shift indices still to be visited.
const cancelAllRowEditing = (): void => {
  for (let i = formLinks.value.length - 1; i >= 0; i--) {
    if (formLinks.value[i].editing) cancelEditLink(i);
  }
  for (let i = formCustomFields.value.length - 1; i >= 0; i--) {
    if (formCustomFields.value[i].editing) cancelEditCustomField(i);
  }
};
const onGlobalKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') cancelAllRowEditing();
};
onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));

// ── Category properties (#205) ──────────────────────────────────────────────

// Shown as the tree it is, not a flat list: a sub-category's meaning is its
// branch ("Passive → Resistors" is not "Resistors"). `Select` indents by `depth`
// and, because the options carry a hierarchy, opens with its filter field —
// which is the only sane way to reach one branch of a long vocabulary.
const categoryOptions = computed(() => [
  { value: '', label: t('inventory.form.noCategory'), empty: true },
  ...buildTreeOptions(
    categoryList.value.map((category) => ({
      value: category.id,
      label: category.name,
      parentValue: category.parentId,
      order: category.order,
    })),
  ),
]);

// A soft-required property that is blank does not block the save — it only
// marks the card incomplete, which is what this badge says.
const incompleteCount = computed(
  () =>
    effectiveProperties.value.filter(
      (property) =>
        property.required &&
        !(propertyValues.value[property.id] ?? '').toString().trim(),
    ).length,
);

async function loadCategories(): Promise<void> {
  try {
    categoryList.value = await apiJson<ItemCategoryDto[]>(
      '/api/item-categories',
    );
  } catch {
    // No vocabulary, no picker — the rest of the form still works.
    categoryList.value = [];
  }
}

async function loadEffectiveProperties(): Promise<void> {
  if (!formCategoryId.value) {
    effectiveProperties.value = [];
    return;
  }
  try {
    effectiveProperties.value = await apiJson<EffectiveProperty[]>(
      `/api/item-categories/${formCategoryId.value}/effective-properties`,
    );
  } catch {
    effectiveProperties.value = [];
  }
}

async function loadPropertyValues(): Promise<void> {
  if (!isEdit.value) return;
  try {
    const values = await apiJson<ComponentPropertyValueDto[]>(
      `/api/components/${componentId.value}/property-values`,
    );
    propertyValues.value = Object.fromEntries(
      values.map((value) => [
        value.propertyId,
        value.value === null ? '' : String(value.value),
      ]),
    );
  } catch {
    propertyValues.value = {};
  }
}

// Every free-text property suggests what has been typed into it before. A
// `select` already offers its own closed list, and a number is not a spelling
// anybody needs help repeating.
async function loadSuggestions(): Promise<void> {
  const sources = effectiveProperties.value.filter(
    (property) => property.type === 'text',
  );
  const loaded: Record<string, string[]> = {};
  await Promise.all(
    sources.map(async (property) => {
      try {
        loaded[property.id] = await apiJson<string[]>(
          `/api/item-categories/properties/${property.id}/values`,
        );
      } catch {
        // No suggestions is a fine state — the field is still typeable.
        loaded[property.id] = [];
      }
    }),
  );
  propertySuggestions.value = loaded;
}

// Changing the category re-reads the set. Values already typed for properties
// the new category also has are kept; the rest spill into the free-form pairs
// on save — said out loud here, because a value silently moving between two
// blocks of the same form is exactly the kind of thing people later call a bug.
watch(formCategoryId, async () => {
  const before = effectiveProperties.value;
  await loadEffectiveProperties();
  await loadSuggestions();
  const kept = new Set(
    effectiveProperties.value.map((property) => property.id),
  );
  const spilled = before.filter(
    (property) =>
      !kept.has(property.id) &&
      (propertyValues.value[property.id] ?? '').toString().trim() !== '',
  );
  if (spilled.length) {
    toast.info(
      t('inventory.form.spilledToCustom', {
        count: spilled.length,
        names: spilled.map((property) => property.name).join(', '),
      }),
    );
  }
});

function selectOptionsFor(
  property: EffectiveProperty,
): Array<{ value: string; label: string }> {
  return [
    { value: '', label: t('inventory.form.noValue'), empty: true },
    ...property.options.map((option) => ({ value: option, label: option })),
  ];
}

// A tag source with something to suggest gets the combobox; one with nothing to
// offer yet stays a plain input rather than a dropdown that opens onto nothing.
function hasSuggestions(property: EffectiveProperty): boolean {
  return (propertySuggestions.value[property.id] ?? []).length > 0;
}

function suggestionOptionsFor(
  property: EffectiveProperty,
): Array<{ value: string; label: string }> {
  return [
    { value: '', label: t('inventory.form.noValue'), empty: true },
    ...(propertySuggestions.value[property.id] ?? []).map((suggestion) => ({
      value: suggestion,
      label: suggestion,
    })),
  ];
}

// Only the properties currently on screen are sent; a blank clears the value.
function buildPropertyValues(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const property of effectiveProperties.value) {
    const raw = (propertyValues.value[property.id] ?? '').toString().trim();
    out[property.id] = raw === '' ? null : raw;
  }
  return out;
}

const fetchComponentDetails = async () => {
  try {
    loading.value = true;
    const response = await apiFetch(`/api/components/${componentId.value}`);
    if (response.ok) {
      const current = await response.json();
      formName.value = current.name;
      formSku.value = current.sku || '';
      formCategoryId.value = current.categoryId || '';
      formQty.value = current.quantity;
      formMinQty.value = current.minQuantity;
      formUnit.value = current.unit || 'pcs';
      formDescription.value = current.description || '';
      loadPhotos(current.photos);
      formStorageId.value = current.storageId || '';
      formStorageRow.value = current.storageRow;
      formStorageCol.value = current.storageCol;

      try {
        const parsedLinks = JSON.parse(current.links || '[]');
        formLinks.value = Array.isArray(parsedLinks)
          ? parsedLinks.map((l: { label?: string; url?: string }) => ({
              label: l.label ?? '',
              url: l.url ?? '',
              editing: false,
            }))
          : [];
      } catch (e) {
        formLinks.value = [];
      }

      try {
        const parsedFields = JSON.parse(current.customFields || '[]');
        formCustomFields.value = Array.isArray(parsedFields)
          ? parsedFields.map((f: { key?: string; value?: string }) => ({
              key: f.key ?? '',
              value: f.value ?? '',
              editing: false,
            }))
          : [];
      } catch (e) {
        formCustomFields.value = [];
      }
    } else {
      // Unknown id (404) or fetch error — bounce back to the list.
      router.push('/inventory');
    }
  } catch (error) {
    console.error('Error fetching component details:', error);
  } finally {
    loading.value = false;
  }
};

const handleSave = async () => {
  if (!formName.value.trim()) return;

  // Filter empty links and fields; strip the transient `editing` flag so only
  // {label,url} is persisted.
  const links = formLinks.value
    .filter((l) => l.label.trim() && l.url.trim())
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  const customFields = formCustomFields.value
    .filter((f) => f.key.trim() && f.value.trim())
    .map((f) => ({ key: f.key.trim(), value: f.value.trim() }));

  try {
    loading.value = true;
    const url = isEdit.value
      ? `/api/components/${componentId.value}`
      : '/api/components';
    const method = isEdit.value ? 'PATCH' : 'POST';

    // Hidden (UX-mode-gated) fields are still sent with their loaded values so
    // simple mode never clobbers data. In edit mode `quantity` is deliberately
    // omitted: stock changes go through the movement-recording modal only.
    const response = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: formName.value.trim(),
        sku: formSku.value.trim(),
        categoryId: formCategoryId.value || null,
        propertyValues: buildPropertyValues(),
        ...(isEdit.value ? {} : { quantity: formQty.value }),
        minQuantity: formMinQty.value,
        unit: formUnit.value,
        description: formDescription.value.trim(),
        // The whole set, every time. Fresh picks are `data:` URLs the server
        // stores; anything the item had and this list does not is deleted.
        photos: photosPayload.value,
        links: JSON.stringify(links),
        customFields: JSON.stringify(customFields),
        storageId: formStorageId.value || null,
        storageRow:
          formStorageRow.value !== null && formStorageRow.value !== undefined
            ? Number(formStorageRow.value)
            : null,
        storageCol:
          formStorageCol.value !== null && formStorageCol.value !== undefined
            ? Number(formStorageCol.value)
            : null,
      }),
    });

    if (response.ok) {
      const saved = await response.json().catch(() => null);
      toast.success(t('inventory.form.saveSuccess'));
      if (!isEdit.value && saved?.id) {
        // The component now exists — switch onto its edit page so the user stays
        // on this component and further saves keep them here.
        router.replace(`/inventory/${saved.id}/edit`);
        return;
      }
      // Edit: stay on the page and re-sync the fields the server may have
      // transformed (a fresh photo became a stored URL; links collapse to
      // display mode).
      if (saved) {
        // Fresh picks came back as stored photos with real ids — re-keying the
        // gallery from the answer is what makes a second save a no-op instead
        // of a re-upload.
        loadPhotos(saved.photos);
        formLinks.value = formLinks.value.map((link) => ({
          ...link,
          editing: false,
        }));
        formCustomFields.value = formCustomFields.value.map((field) => ({
          ...field,
          editing: false,
        }));
      }
    } else {
      toast.error(t('inventory.form.saveError'));
    }
  } catch (error) {
    toast.error(t('inventory.form.saveError'));
    console.error('Error saving component:', error);
  } finally {
    loading.value = false;
  }
};

const handleDelete = async () => {
  const ok = await confirm({
    message: t('inventory.form.deleteConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    loading.value = true;
    const response = await apiFetch(`/api/components/${componentId.value}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      router.push('/inventory');
    } else {
      const err = await response.json();
      toast.error(err.message || t('inventory.form.deleteError'));
    }
  } catch (error) {
    toast.error(t('inventory.form.deleteError'));
    console.error('Error deleting component:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchStoragesList();
  void loadCategories();
  if (route.params.id) {
    isEdit.value = true;
    componentId.value = route.params.id as string;
    fetchComponentDetails();
    fetchActivity();
    void loadPropertyValues();
  } else {
    if (route.query.storageId) {
      formStorageId.value = route.query.storageId as string;
    }
    if (route.query.row !== undefined && route.query.row !== null) {
      formStorageRow.value = Number(route.query.row);
    }
    if (route.query.col !== undefined && route.query.col !== null) {
      formStorageCol.value = Number(route.query.col);
    }
    // Quick-add from a barcode scan (#33 E6): seed the SKU so a not-found scan
    // lands on a pre-filled new-component form, and immediately run the soft
    // duplicate check (#33 E4) so a matching SKU is flagged without waiting for
    // the field to be blurred.
    if (route.query.sku) {
      formSku.value = firstQueryValue(route.query.sku);
      checkSku();
    }
  }
});
</script>

<template>
  <div class="w-full space-y-6 animate-fade-in pb-12">
    <!-- Header Back Navigation -->
    <div class="flex items-center justify-between">
      <button
        @click="router.push('/inventory')"
        class="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ t('inventory.form.backToInventory') }}
      </button>

      <div class="flex items-center gap-2">
        <!-- Print-label action, contributed by the codes plugin (#74). Empty
             when codes is disabled. -->
        <PluginSlot
          v-if="isEdit && componentTagRef"
          name="inventory.detail.actions"
          :ctx="{ entityRef: componentTagRef }"
        />
        <Button
          v-if="isEdit"
          variant="danger"
          size="sm"
          :icon-left="Trash2"
          @click="handleDelete"
        >
          {{ t('inventory.form.deleteComponent') }}
        </Button>
      </div>
    </div>

    <!-- Title and Subtitle -->
    <div>
      <h2 class="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
        {{
          isEdit ? t('inventory.form.editTitle') : t('inventory.form.newTitle')
        }}
      </h2>
      <p class="text-xs text-slate-500 mt-1">
        {{ t('inventory.form.subtitle') }}
      </p>
      <!-- Tags (editable), contributed by the tags plugin on existing components -->
      <div v-if="isEdit && componentTagRef" class="mt-3">
        <PluginSlot
          name="inventory.form.meta"
          :ctx="{ entityRef: componentTagRef, editable: true }"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex justify-center items-center py-12">
      <Spinner />
    </div>

    <!-- Edit Form Card -->
    <form v-else @submit.prevent="handleSave" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left 2 Cols: Main Info -->
        <div class="lg:col-span-2 space-y-6">
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-6"
          >
            <h3
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <Cpu class="w-4 h-4 text-brand-500" />
              {{ t('inventory.form.mainParams') }}
            </h3>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-1.5 md:col-span-2">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('inventory.form.componentName') }}</label
                >
                <input
                  v-model="formName"
                  type="text"
                  :placeholder="t('inventory.form.namePlaceholder')"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                  required
                />
              </div>

              <div v-if="showExtraFields" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('inventory.form.skuLabel') }}</label
                >
                <input
                  v-model="formSku"
                  type="text"
                  :placeholder="t('inventory.form.skuPlaceholder')"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-mono"
                  @blur="checkSku"
                />
                <!-- Soft duplicate warning (#33 E4): non-blocking; save still allowed -->
                <div
                  v-if="skuMatches.length"
                  class="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
                  <div class="space-y-1 min-w-0">
                    <p class="font-semibold">
                      {{ t('inventory.form.skuDuplicateWarning') }}
                    </p>
                    <ul class="space-y-0.5">
                      <li v-for="m in skuMatches" :key="m.id">
                        <button
                          type="button"
                          class="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded"
                          @click="router.push('/inventory/' + m.id + '/edit')"
                        >
                          {{ m.name }}
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div v-if="showCategories" class="space-y-1.5">
                <label
                  for="component-category"
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('inventory.form.categoryLabel') }}</label
                >
                <Select
                  id="component-category"
                  v-model="formCategoryId"
                  :options="categoryOptions"
                />
                <p class="text-xxs text-slate-500 dark:text-slate-400">
                  {{ t('inventory.form.categoryHint') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Description (WYSIWYG Editor) -->
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
          >
            <h3
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <FileText class="w-4 h-4 text-brand-500" />
              {{ t('inventory.form.detailedDesc') }}
            </h3>

            <RichEditor
              v-model="formDescription"
              :placeholder="t('inventory.form.editorPlaceholder')"
            />
          </div>

          <!-- Reference blocks: Useful links + Custom characteristics share the
               left column, each half-width -->
          <div
            v-if="
              showExtraFields ||
              (showCategories && effectiveProperties.length > 0)
            "
            class="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <!-- Links Section -->
            <div
              v-if="showExtraFields"
              class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
            >
              <div
                class="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-3"
              >
                <h3
                  class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
                >
                  <Globe class="w-4 h-4 text-brand-500" />
                  {{ t('inventory.form.usefulLinks') }}
                </h3>
                <button
                  type="button"
                  @click="handleAddLink"
                  class="flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  <Plus class="w-3.5 h-3.5" />
                  {{ t('inventory.form.add') }}
                </button>
              </div>

              <!-- Links table: name + clickable URL, per-row edit/delete -->
              <div>
                <div
                  v-if="formLinks.length === 0"
                  class="text-center py-6 text-slate-500 text-xs"
                >
                  {{ t('inventory.form.noLinks') }}
                </div>

                <div
                  v-else
                  class="rounded-xl border border-slate-200/60 dark:border-white/5 divide-y divide-slate-200/60 dark:divide-white/5 overflow-hidden"
                >
                  <!-- Header -->
                  <div
                    class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-3 items-center px-3 py-2 bg-slate-50 dark:bg-white/[0.02] text-xxs font-bold text-slate-500"
                  >
                    <span>{{ t('inventory.form.linkNameColumn') }}</span>
                    <span>{{ t('inventory.form.linkUrlColumn') }}</span>
                    <span class="sr-only">{{
                      t('inventory.form.actions')
                    }}</span>
                  </div>

                  <div
                    v-for="(link, index) in formLinks"
                    :key="index"
                    class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-3 items-center px-3 py-2 text-sm"
                  >
                    <!-- Display mode -->
                    <template v-if="!link.editing">
                      <span
                        class="font-medium text-slate-800 dark:text-slate-200 truncate"
                        >{{
                          link.label || t('inventory.form.linkNoName')
                        }}</span
                      >
                      <a
                        :href="linkHref(link.url)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1.5 text-brand-600 dark:text-brand-400 hover:underline font-mono text-xs truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                      >
                        <ExternalLink class="w-3.5 h-3.5 shrink-0" />
                        <span class="truncate">{{ link.url }}</span>
                      </a>
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          :aria-label="t('inventory.form.editLink')"
                          class="p-1.5 text-slate-400 hover:text-brand-500 rounded-lg hover:bg-brand-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                          @click="editLink(index)"
                        >
                          <Pencil class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          :aria-label="t('inventory.form.removeLink')"
                          class="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                          @click="handleRemoveLink(index)"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    </template>

                    <!-- Edit mode -->
                    <template v-else>
                      <input
                        v-model="link.label"
                        type="text"
                        :placeholder="t('inventory.form.linkPlaceholder')"
                        class="w-full glass-input rounded-lg px-3 py-2 text-sm"
                        @keydown="onLinkEditKey($event, index)"
                      />
                      <input
                        v-model="link.url"
                        type="url"
                        placeholder="https://..."
                        class="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
                        @keydown="onLinkEditKey($event, index)"
                      />
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          :aria-label="t('inventory.form.saveLink')"
                          class="p-1.5 text-slate-400 hover:text-emerald-500 rounded-lg hover:bg-emerald-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                          @click="doneEditLink(index)"
                        >
                          <Check class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          :aria-label="t('inventory.form.removeLink')"
                          class="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                          @click="handleRemoveLink(index)"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- Category properties (#205): the typed set this item's
                 category defines, ancestors included. Sits above the free-form
                 pairs, which stay for one-off notes about THIS item. Follows
                 the categories lens, not extraFields (#269). -->
            <div
              v-if="showCategories && effectiveProperties.length"
              class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
            >
              <div
                class="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-3"
              >
                <h3
                  class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
                >
                  <Tag class="w-4 h-4 text-brand-500" />
                  {{ t('inventory.form.categoryProperties') }}
                </h3>
                <Badge v-if="incompleteCount" tone="warning">
                  {{
                    t('inventory.form.incomplete', { count: incompleteCount })
                  }}
                </Badge>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div
                  v-for="property in effectiveProperties"
                  :key="property.id"
                  class="space-y-1.5"
                >
                  <label
                    :for="`prop-${property.id}`"
                    class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >
                    {{ property.name }}
                    <span v-if="property.unit" class="font-normal">
                      , {{ property.unit }}
                    </span>
                  </label>

                  <Select
                    v-if="property.type === 'select'"
                    :id="`prop-${property.id}`"
                    v-model="propertyValues[property.id]"
                    :options="selectOptionsFor(property)"
                  />
                  <!-- Values other items already carry for this property:
                       picking beats retyping, and a consistent spelling is
                       worth more the moment anything else reads it. A combobox
                       Select rather than a native <datalist>: the browser's own
                       dropdown answers to no stylesheet and differs in every
                       engine. -->
                  <Select
                    v-else-if="hasSuggestions(property)"
                    :id="`prop-${property.id}`"
                    v-model="propertyValues[property.id]"
                    :options="suggestionOptionsFor(property)"
                    :placeholder="t('inventory.form.noValue')"
                    allow-custom
                  />
                  <input
                    v-else
                    :id="`prop-${property.id}`"
                    v-model="propertyValues[property.id]"
                    :type="property.type === 'number' ? 'number' : 'text'"
                    class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                  />

                  <p class="text-xxs text-slate-500 dark:text-slate-400">
                    <span v-if="property.inherited">
                      {{ property.ownerCategoryName }}
                    </span>
                    <span v-if="property.inherited && property.required">
                      ·
                    </span>
                    <span v-if="property.required">
                      {{ t('inventory.form.expected') }}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <!-- Custom Fields Section -->
            <div
              v-if="showExtraFields"
              class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
            >
              <div
                class="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-3"
              >
                <h3
                  class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
                >
                  <Tag class="w-4 h-4 text-brand-500" />
                  {{ t('inventory.form.customSpecs') }}
                </h3>
                <button
                  type="button"
                  @click="handleAddCustomField"
                  class="flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-transparent rounded-lg text-xs font-semibold transition-all"
                >
                  <Plus class="w-3.5 h-3.5 text-brand-500" />
                  {{ t('inventory.form.add') }}
                </button>
              </div>

              <!-- Characteristics table: name + value, per-row edit/delete -->
              <div>
                <div
                  v-if="formCustomFields.length === 0"
                  class="text-center py-6 text-slate-500 text-xs"
                >
                  {{ t('inventory.form.noCustomSpecs') }}
                </div>

                <div
                  v-else
                  class="rounded-xl border border-slate-200/60 dark:border-white/5 divide-y divide-slate-200/60 dark:divide-white/5 overflow-hidden"
                >
                  <!-- Header -->
                  <div
                    class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-3 items-center px-3 py-2 bg-slate-50 dark:bg-white/[0.02] text-xxs font-bold text-slate-500"
                  >
                    <span>{{ t('inventory.form.specKeyColumn') }}</span>
                    <span>{{ t('inventory.form.specValueColumn') }}</span>
                    <span class="sr-only">{{
                      t('inventory.form.actions')
                    }}</span>
                  </div>

                  <div
                    v-for="(field, index) in formCustomFields"
                    :key="index"
                    class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-3 items-center px-3 py-2 text-sm"
                  >
                    <!-- Display mode -->
                    <template v-if="!field.editing">
                      <span
                        class="font-medium text-slate-800 dark:text-slate-200 truncate"
                        >{{ field.key || t('inventory.form.specNoName') }}</span
                      >
                      <span
                        class="text-slate-600 dark:text-slate-300 truncate"
                        >{{ field.value }}</span
                      >
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          :aria-label="t('inventory.form.editSpec')"
                          class="p-1.5 text-slate-400 hover:text-brand-500 rounded-lg hover:bg-brand-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                          @click="editCustomField(index)"
                        >
                          <Pencil class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          :aria-label="t('inventory.form.removeSpec')"
                          class="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                          @click="handleRemoveCustomField(index)"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    </template>

                    <!-- Edit mode -->
                    <template v-else>
                      <input
                        v-model="field.key"
                        type="text"
                        :placeholder="t('inventory.form.specKeyPlaceholder')"
                        class="w-full glass-input rounded-lg px-3 py-2 text-sm font-bold"
                        @keydown="onCustomFieldEditKey($event, index)"
                      />
                      <input
                        v-model="field.value"
                        type="text"
                        :placeholder="t('inventory.form.specValuePlaceholder')"
                        class="w-full glass-input rounded-lg px-3 py-2 text-sm"
                        @keydown="onCustomFieldEditKey($event, index)"
                      />
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          :aria-label="t('inventory.form.saveSpec')"
                          class="p-1.5 text-slate-400 hover:text-emerald-500 rounded-lg hover:bg-emerald-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                          @click="doneEditCustomField(index)"
                        >
                          <Check class="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          :aria-label="t('inventory.form.removeSpec')"
                          class="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                          @click="handleRemoveCustomField(index)"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right 1 Col: Storage, Price, and Custom Fields -->
        <div class="lg:col-span-1 space-y-6">
          <!-- Photographs (#214). A set, not a slot: the gallery is the shared
               primitive and the list lives in the form, so Cancel reverts every
               add, removal and cover change together. -->
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
          >
            <h3
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <ImagePlus class="w-4 h-4 text-brand-500" />
              {{ t('inventory.form.photos') }}
            </h3>

            <PhotoGallery
              :photos="galleryPhotos"
              :max="MAX_ITEM_PHOTOS"
              @add="addPhotos"
              @remove="removePhoto"
              @make-cover="makeCover"
              @open="lightboxKey = $event"
            />
          </div>

          <!-- Storage & Qty -->
          <div
            class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-6"
          >
            <h3
              class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
            >
              <Package class="w-4 h-4 text-brand-500" />
              {{ t('inventory.form.stockControl') }}
            </h3>

            <div class="space-y-4">
              <div v-if="storagesEnabled" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                >
                  {{ t('inventory.form.storageLocation') }}
                </label>
                <Select v-model="formStorageId" :options="storageOptions" />
              </div>

              <!-- Grid cell selectors -->
              <div
                v-if="storagesEnabled && isSelectedStorageGrid"
                class="grid grid-cols-2 gap-4 animate-fade-in pl-3 border-l-2 border-brand-500/35"
              >
                <div class="space-y-1.5">
                  <label class="text-xxs font-bold text-slate-500 block">{{
                    t('inventory.form.rowLabel')
                  }}</label>
                  <Select v-model="formStorageRow" :options="rowOptions" />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xxs font-bold text-slate-500 block">{{
                    t('inventory.form.colLabel')
                  }}</label>
                  <Select v-model="formStorageCol" :options="colOptions" />
                </div>
              </div>

              <div v-if="showExtraFields" class="space-y-1.5">
                <label
                  class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                  >{{ t('inventory.form.unitLabel') }}</label
                >
                <Select v-model="formUnit" :options="unitOptions" />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1.5">
                  <label
                    class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                    >{{ t('inventory.form.currentStock') }}</label
                  >
                  <!-- Edit mode: quantity is read-only — the stock-change modal on the
                       inventory list is the single write path (records a movement). -->
                  <template v-if="isEdit">
                    <p
                      class="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-center bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white border border-slate-200 dark:border-white/5"
                    >
                      {{ formatQty(formQty) }}
                      {{ t(`inventory.units.${formUnit}`) }}
                    </p>
                    <p class="text-xxs text-slate-500 dark:text-slate-400">
                      {{ t('inventory.form.quantityViaModal') }}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      @click="router.push('/inventory')"
                    >
                      {{ t('inventory.form.changeStock') }}
                    </Button>
                  </template>
                  <input
                    v-else
                    v-model.number="formQty"
                    type="number"
                    min="0"
                    step="any"
                    class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-semibold text-center"
                  />
                </div>

                <div class="space-y-1.5">
                  <label
                    class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
                    >{{ t('inventory.form.minStock') }}</label
                  >
                  <input
                    v-model.number="formMinQty"
                    type="number"
                    min="0"
                    step="any"
                    class="w-full glass-input rounded-xl px-4 py-2.5 text-sm font-semibold text-center"
                  />
                  <p class="text-xxs text-slate-500 dark:text-slate-400">
                    {{ t('inventory.form.minQuantityHint') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity: related orders + movement history (edit mode) -->
      <div
        v-if="isEdit && showHistoryPanels"
        class="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <!-- Related orders — logistics data, hidden with the plugin (#58) -->
        <div
          v-if="logisticsEnabled"
          class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
        >
          <h3
            class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
          >
            <ShoppingCart class="w-4 h-4 text-brand-500" />
            {{ t('inventory.relatedOrders') }}
          </h3>
          <div
            v-if="loadingOrders"
            class="flex items-center gap-2 py-3 text-xs text-slate-500"
          >
            <Spinner size="sm" /> {{ t('inventory.loadingHistory') }}
          </div>
          <p
            v-else-if="relatedOrders.length === 0"
            class="text-xs text-slate-400 dark:text-slate-500 py-2"
          >
            {{ t('inventory.noOrders') }}
          </p>
          <div
            v-else
            class="rounded-xl border border-slate-200/60 dark:border-white/5 divide-y divide-slate-200/60 dark:divide-white/5 overflow-hidden max-h-64 overflow-y-auto"
          >
            <button
              v-for="ord in relatedOrders"
              :key="ord.orderId"
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-xxs hover:bg-brand-500/5 transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-500/50"
              @click="router.push('/logistics')"
            >
              <span
                class="font-bold text-slate-800 dark:text-slate-200 w-6 text-right shrink-0"
                >{{ formatQty(ord.quantity) }}</span
              >
              <span
                class="px-1.5 py-0.5 rounded-md border font-semibold shrink-0"
                :class="orderStatusClass(ord.status)"
              >
                {{ orderStatusLabel(ord.status) }}
              </span>
              <span
                class="text-slate-600 dark:text-slate-300 font-medium truncate min-w-0 flex-1"
                >{{ ord.storeName }}</span
              >
              <span
                class="text-slate-400 dark:text-slate-500 font-mono shrink-0"
                >{{ formatDate(ord.orderDate) }}</span
              >
            </button>
          </div>
        </div>

        <!-- Movement history -->
        <div
          class="glass-card rounded-2xl p-6 border border-slate-200 dark:border-white/5 space-y-4"
        >
          <h3
            class="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-200 dark:border-white/5 pb-3"
          >
            <Clock class="w-4 h-4 text-brand-500" />
            {{ t('inventory.movementHistory') }}
          </h3>
          <div
            v-if="loadingMovements"
            class="flex items-center gap-2 py-3 text-xs text-slate-500"
          >
            <Spinner size="sm" /> {{ t('inventory.loadingHistory') }}
          </div>
          <p
            v-else-if="movements.length === 0"
            class="text-xs text-slate-400 dark:text-slate-500 py-2"
          >
            {{ t('inventory.noMovements') }}
          </p>
          <div
            v-else
            class="rounded-xl border border-slate-200/60 dark:border-white/5 divide-y divide-slate-200/60 dark:divide-white/5 overflow-hidden max-h-64 overflow-y-auto"
          >
            <div
              v-for="mv in movements"
              :key="mv.id"
              class="flex items-center gap-2 px-3 py-2 text-xxs"
            >
              <span
                class="font-bold w-8 text-right shrink-0"
                :class="[
                  mv.delta > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                ]"
              >
                {{
                  mv.delta > 0 ? '+' + formatQty(mv.delta) : formatQty(mv.delta)
                }}
              </span>
              <span
                class="px-1.5 py-0.5 rounded-md border font-semibold shrink-0"
                :class="movementTypeClass(mv.type)"
              >
                {{ movementTypeLabel(mv.type) }}
              </span>
              <span
                class="text-slate-600 dark:text-slate-300 font-medium truncate min-w-0 flex-1"
                >{{ mv.note || t('inventory.noDescription') }}</span
              >
              <span
                class="text-slate-400 dark:text-slate-500 font-mono shrink-0"
                >{{ formatDate(mv.createdAt) }}</span
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-3 pt-4">
        <Button variant="secondary" @click="router.push('/inventory')">
          {{ t('inventory.form.cancel') }}
        </Button>
        <Button type="submit" :icon-left="Save">
          {{ t('inventory.form.saveComponent') }}
        </Button>
      </div>
    </form>

    <!-- Anything another plugin wants to say about THIS item: a note, a
         reading, a reminder. Empty when no plugin contributes, so the page
         looks the same on an instance that installed none.

         Outside the <form> on purpose: a guest renders its own form, and a
         form inside a form is invalid HTML whose inner submit takes the
         outer one with it. -->
    <PluginSlot
      v-if="isEdit && componentTagRef"
      name="inventory.form.aside"
      :ctx="{ entityRef: componentTagRef }"
    />

    <!-- Full-size viewing. Not route-driven here, unlike the project Files tab:
         these pictures include ones that do not exist yet, so there is nothing
         a URL could name. -->
    <ImageLightbox v-model:open-id="lightboxKey" :images="lightboxImages" />
  </div>
</template>
