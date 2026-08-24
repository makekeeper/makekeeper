<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import {
  RichEditor,
  Button,
  Spinner,
  Modal,
  Badge,
  EmptyState,
  useConfirm,
  useToastStore,
  apiFetch,
  apiDownload,
  sanitizeHtml,
  usePageContext,
  useAgentDataChanged,
  useUxMode,
  usePluginsStore,
  useInternalDragStore,
  asciiFilename,
  useSlotContributions,
  PluginSlot,
  readAsDataUrl,
  SegmentedControl,
  useRouteQuery,
  prewarmPreviews,
  ImageLightbox,
  type LightboxImage,
  type SegmentedOption,
} from '@makekeeper/frontend-core';
import type { Component as VueComponent, ComponentPublicInstance } from 'vue';
import { formatObjectRef } from '@makekeeper/plugin-contract';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  useLocaleDate,
  dueStatus,
  DUE_STATUS_CLASS,
  coverCropSquare,
  statusBucket,
  BUCKET_CANONICAL_STATUS,
  BUCKET_LABEL_KEY,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL_KEY,
  PROJECT_STATUS_CHIP,
} from './shared';
import ProjectActivityCalendar from './ProjectActivityCalendar.vue';
import ProjectKpiTiles from './dashboard/ProjectKpiTiles.vue';
import ProjectFilesListing from './ProjectFilesListing.vue';
import {
  isProjectFilesView,
  readStoredFilesView,
  storeFilesView,
  type ProjectFile,
  type ProjectFilesView,
} from './project-files';
import {
  ArrowLeft,
  LayoutDashboard,
  CheckSquare,
  Cpu,
  Plus,
  Trash2,
  Calendar,
  AlertTriangle,
  Info,
  Image as ImageIcon,
  Upload,
  ShoppingCart,
  Copy,
  FileUp,
  File as FileIcon,
  Download,
  Minus,
  LayoutGrid,
  List,
  FolderTree,
} from '@lucide/vue';
import { useProjectGroupsStore } from './project-groups-store';

const route = useRoute();
const router = useRouter();
const projectId = route.params.id as string;
const { t } = useI18n();

// Publish this project as a canonical ORef for the AI chat page context (#16), so
// the agent gets an exact, ownership-tagged handle instead of a bare route id.
const pageContextRefs = computed<string[] | null>(() => {
  const ref = formatObjectRef({
    pluginId: 'projects',
    entityType: 'project',
    entityId: projectId,
  });
  return ref ? [ref] : null;
});
usePageContext(pageContextRefs);
const confirm = useConfirm();
const toast = useToastStore();
const internalDrag = useInternalDragStore();
const { isFeatureVisible } = useUxMode();
// Linking BOM rows browses the component catalog — inventory functionality
// (#58); the entry point exists only while inventory is enabled.
const pluginsStore = usePluginsStore();
const inventoryEnabled = computed(() => pluginsStore.isEnabled('inventory'));

// Simple-mode lenses (#53). Each hides an entry point only — deep-linked
// content still renders (see visibleTabs) and no data or API call changes.
const showSpecsCard = computed<boolean>(() =>
  isFeatureVisible('projects.specsCard'),
);
const showBudgetPlanning = computed<boolean>(() =>
  isFeatureVisible('projects.budgetPlanning'),
);
const showReservations = computed<boolean>(() =>
  isFeatureVisible('projects.reservations'),
);
const showFullStatuses = computed<boolean>(() =>
  isFeatureVisible('projects.fullStatuses'),
);
// Where this project is filed (#289) — hidden in simple mode with the rest of
// the groups surface.
const groupsVisible = computed<boolean>(() =>
  isFeatureVisible('projects.groups'),
);
const groupsStore = useProjectGroupsStore();

interface Component {
  id: string;
  name: string;
  sku: string;
  // #205 replaced the free-text column with a relation. Nothing here renders it
  // yet; the field is typed correctly so the next reader does not trust a lie.
  categoryRef: { id: string; name: string } | null;
  quantity: number;
}

interface ProjectComponent {
  id: string;
  componentId: string;
  neededQty: number;
  reservedQty: number;
  component: Component;
}

interface Task {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  dueDate?: string;
  components: any[];
  orders: any[];
}

interface Order {
  id: string;
  storeName: string;
  orderDate: string | null;
  status: string;
  trackingNumber: string;
  trackingUrl: string;
  estimatedDelivery: string | null;
  totalCost: number;
  currency: string;
  itemsCount: number;
}

interface Project {
  id: string;
  title: string;
  description: string;
  status: 'IDEA' | 'PLANNING' | 'IN_PROGRESS' | 'TESTING' | 'COMPLETED';
  // The group the project is filed in (#289).
  groupId: string;
  createdAt: string;
  startDate: string | null;
  dueDate: string | null;
  tasksCount: number;
  completedTasksCount: number;
  componentsCount: number;
  tasks: Task[];
  components: ProjectComponent[];
  relatedOrders: Order[];
  budgetPlanned?: number;
  budgetCurrency?: string;
  actualBudget: number;
}

const project = ref<Project | null>(null);
const loading = ref(true);
const projectGroup = computed(() =>
  project.value?.groupId
    ? (groupsStore.byId.get(project.value.groupId) ?? null)
    : null,
);
// Sub-tab is route-driven (§5.3) — it lives in route.query.tab, not a local ref,
// so deep links and back/forward navigation restore the active tab.
const activeTab = computed<string>({
  get: () => {
    const tab =
      typeof route.query.tab === 'string' ? route.query.tab : 'dashboard';
    // The old AI-copilot chat tab is now the AI-history tab (#59); keep bookmarks
    // to ?tab=chat landing on it.
    return tab === 'chat' ? 'ai' : tab;
  },
  set: (value) => {
    router.replace({
      query: {
        ...route.query,
        tab: value === 'dashboard' ? undefined : value,
      },
    });
  },
});

// Add Task Inline
const newTaskTitle = ref('');

// Shopping list / BOM
interface ShoppingItem {
  componentId: string;
  name: string;
  sku: string | null;
  neededQty: number;
  reservedQty: number;
  availableStock: number;
  toBuy: number;
  unitPrice: number | null;
  currency: string | null;
  estCost: number | null;
}
const shoppingList = ref<{
  items: ShoppingItem[];
  totals: { currency: string; amount: number }[];
}>({ items: [], totals: [] });

const fetchShoppingList = async () => {
  try {
    const res = await apiFetch(`/api/projects/${projectId}/shopping-list`);
    if (res.ok) shoppingList.value = await res.json();
  } catch {
    // Non-critical panel — a failure just leaves the list empty.
  }
};

const shoppingListText = computed(() =>
  shoppingList.value.items
    .map((i) => `${i.toBuy}× ${i.name}${i.sku ? ` (${i.sku})` : ''}`)
    .join('\n'),
);

const copyShoppingList = async () => {
  try {
    await navigator.clipboard.writeText(shoppingListText.value);
    toast.success(t('projectDetail.shopping.copied'));
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
  }
};

// Props for the logistics "create order" contribution on the shopping list
// (#58): the deficit lines it hands off to the order form.
const shoppingActionsCtx = computed<Record<string, unknown>>(() => ({
  projectId,
  items: shoppingList.value.items
    .filter((i) => i.toBuy > 0)
    .map((i) => ({ componentId: i.componentId, quantity: i.toBuy })),
}));

const exportShoppingCsv = () => {
  const header = [
    'name',
    'sku',
    'needed',
    'reserved',
    'stock',
    'to_buy',
    'unit_price',
    'est_cost',
  ];
  const rows = shoppingList.value.items.map((i) => [
    i.name,
    i.sku ?? '',
    i.neededQty,
    i.reservedQty,
    i.availableStock,
    i.toBuy,
    i.unitPrice ?? '',
    i.estCost ?? '',
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `shopping-list-${projectId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

// Files / build-log (images shown as thumbnails, any other file as a card)
const files = ref<ProjectFile[]>([]);

// Grid or list (#116). Route-driven so a link opens the way its author read it,
// falling back to the remembered preference — and writing back to it, because
// how you read your files is a habit, not a per-project choice. The query
// plumbing (array values, preserving the other keys, the duplicate-navigation
// reject) belongs to `useRouteQuery`; what is left here is the narrowing and
// the write-through to storage.
const filesViewQuery = useRouteQuery('files', {
  default: readStoredFilesView(),
});
const filesView = computed<ProjectFilesView>({
  get: () =>
    isProjectFilesView(filesViewQuery.value) ? filesViewQuery.value : 'grid',
  set: (value) => {
    storeFilesView(value);
    filesViewQuery.value = value;
  },
});

const filesViewOptions = computed<SegmentedOption<ProjectFilesView>[]>(() => [
  { value: 'grid', label: t('projectDetail.files.viewGrid'), icon: LayoutGrid },
  { value: 'list', label: t('projectDetail.files.viewList'), icon: List },
]);

// A file ORef link lands on this tab with ?file=<id> (#112). Pointing at the
// tab is not pointing at the file: in a grid of dozens the link dead-ends
// unless the target card is marked and scrolled to.
const highlightedFileId = computed<string | null>(() =>
  typeof route.query.file === 'string' ? route.query.file : null,
);
// Which photo the lightbox shows (#117). Route-driven like every other
// navigation state here (§5.3): a photo is linkable, and Back closes the viewer
// instead of leaving the project.
//
// Only OPENING pushes; stepping between photos and closing both replace. That
// asymmetry is what makes Back mean "close": one history entry stands for the
// whole viewing session, so a user who arrowed through twenty photos presses
// Back once to get out, not twenty times.
const openPhotoId = computed<string | null>({
  get: () => (typeof route.query.photo === 'string' ? route.query.photo : null),
  set: (value) => {
    const to = { query: { ...route.query, photo: value ?? undefined } };
    const opening = value !== null && typeof route.query.photo !== 'string';
    void (opening ? router.push(to) : router.replace(to));
  },
});

// Only images, in the order they are shown, so arrowing follows the grid.
const lightboxImages = computed<LightboxImage[]>(() =>
  files.value
    .filter((file) => file.isImage)
    .map((file) => ({
      id: file.id,
      url: file.url,
      filename: file.filename,
    })),
);

// Downloading from the viewer is the same action as downloading from a tile —
// the original bytes, through apiDownload (#109).
const downloadFromLightbox = (image: LightboxImage): void => {
  const file = files.value.find((candidate) => candidate.id === image.id);
  if (file) void handleDownloadFile(file);
};

const fileCards = new Map<string, HTMLElement>();
const setFileCard = (
  id: string,
  el: Element | ComponentPublicInstance | null,
): void => {
  if (el instanceof HTMLElement) fileCards.set(id, el);
  else fileCards.delete(id);
};
watch([files, highlightedFileId], async () => {
  const id = highlightedFileId.value;
  if (!id) return;
  await nextTick();
  fileCards.get(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

const fileInput = ref<HTMLInputElement | null>(null);
const uploadingFiles = ref(false);
const isDraggingFile = ref(false);

const fetchFiles = async () => {
  try {
    const res = await apiFetch(`/api/projects/${projectId}/files`);
    if (res.ok) files.value = await res.json();
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  }
};

const openFilePicker = () => fileInput.value?.click();

// Shared by the file picker and drag-and-drop. Everything uploads as-is, full
// resolution included: the Files tab is the project's build-log/archive, so a
// download must return the original bytes (#109) — unlike the chat composer,
// which downscales because its images only feed vision models.
const uploadFiles = async (list: File[]): Promise<void> => {
  if (list.length === 0) return;
  uploadingFiles.value = true;
  try {
    for (const file of list) {
      const dataUrl = await readAsDataUrl(file);
      const res = await apiFetch(`/api/projects/${projectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl, filename: file.name }),
      });
      if (!res.ok) toast.error(t('projectDetail.photos.uploadError'));
    }
    await fetchFiles();
  } catch {
    toast.error(t('projectDetail.photos.uploadError'));
  } finally {
    uploadingFiles.value = false;
  }
};

const onFilesSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const list = Array.from(input.files ?? []);
  input.value = '';
  await uploadFiles(list);
};

const onFileDragOver = (event: DragEvent): void => {
  // A tile dragged out of this very tab is not a drop candidate for it: the
  // drop is ignored anyway (see onFileDrop), so offering the "drop here" hint
  // and a copy cursor would promise an upload that never happens. A native
  // image drag does expose 'Files', hence the explicit internal-drag check.
  if (internalDrag.isActive()) return;
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
    isDraggingFile.value = true;
  }
};
const onFileDragLeave = (event: DragEvent) => {
  // Clear only when the pointer truly leaves the dropzone (relatedTarget is the
  // element it moved to; if that's outside the zone, we left). Robust across
  // nested children, unlike a `currentTarget === target` check.
  const el = event.currentTarget as HTMLElement | null;
  if (el && !el.contains(event.relatedTarget as Node | null)) {
    isDraggingFile.value = false;
  }
};
// Safety net: a cancelled/ended drag (Esc, dropped elsewhere, left the window)
// doesn't always fire dragleave — reset the highlight on these global events.
const endFileDrag = (): void => {
  isDraggingFile.value = false;
};
const onWindowDragLeave = (event: DragEvent): void => {
  if (!event.relatedTarget) isDraggingFile.value = false;
};
const onFileDrop = async (event: DragEvent): Promise<void> => {
  event.preventDefault();
  isDraggingFile.value = false;
  // Ignore internal drags (an existing tile being dragged out, e.g. to the
  // chat or the desktop); only external file drops should upload. A native
  // image drag exposes the image in dataTransfer.files, so without this guard
  // dropping a tile back onto the zone would re-upload a duplicate.
  if (internalDrag.isActive()) return;
  await uploadFiles(Array.from(event.dataTransfer?.files ?? []));
};

// Dragging an existing tile out — to the chat composer, the desktop or
// another app. Every drag is also published to the shared internal-drag store
// so in-app drop targets (the chat composer, this tab's own dropzone guard)
// recognise it without relying on DataTransfer flavours.
//
// Images: DO NOT write to the drag data store. Once a dragstart handler calls
// setData(), the browser builds the OS drag payload from the author data
// ALONE and drops its native image payload — the file promise that makes
// "drag a picture out of the browser onto the desktop" save a real file on
// every browser/OS. The only thing we add is the visual ghost:
//
// The default drag ghost is rasterised from the image's *natural* size — a
// large original janks the drag start, and during that jank the pointer builds
// a text selection that reaches the off-screen chat panel (it is translated
// out of view, not unmounted), which the browser then composes into the ghost
// (#111). So: drop any selection and hand the browser a small pre-drawn ghost
// from the already-decoded thumbnail instead.
//
// Non-image cards have no native drag payload, so for them we do set data:
// Chromium's `DownloadURL` ("<mime>:<name>:<abs-url>", absolute URL required)
// saves a real file on a desktop drop; it must be the ONLY flavour, or the OS
// prefers the URL and writes a .webloc/.url link instead (crbug 55071).
// Firefox/Safari have no drag-out-download mechanism at all, so there we set
// NOTHING — an empty drag that snaps back beats littering the desktop with
// .webloc link files — and, when the drag ends without an in-app target
// consuming it, show a notice pointing at the tile's download button.
const DRAG_GHOST_SIZE = 96;

// Chromium is the only engine that turns a `DownloadURL` drag into a saved
// file, and there is no feature detection for it — the data type is accepted
// silently everywhere. Sniffing the UA is therefore the only signal available;
// a Chromium fork that hides its brand simply falls into the "unsupported"
// branch and gets the download-button notice instead of a broken file.
const supportsDragOutDownload = (): boolean =>
  /Chrom(e|ium)\//.test(navigator.userAgent);

const onFileDragStart = (event: DragEvent, file: ProjectFile): void => {
  internalDrag.start({
    url: file.url,
    mimeType: file.mimeType,
    filename: file.filename,
    isImage: file.isImage,
    sizeBytes: file.sizeBytes,
  });
  if (!event.dataTransfer) return;
  window.getSelection()?.removeAllRanges();
  if (!file.isImage) {
    const absUrl = new URL(file.url, window.location.origin).href;
    // `DownloadURL` is colon-delimited, so the name must survive the same
    // sanitising the server applies to Content-Disposition (shared rule).
    const dragName = asciiFilename(file.filename, file.id);
    if (supportsDragOutDownload()) {
      event.dataTransfer.setData(
        'DownloadURL',
        `${file.mimeType}:${dragName}:${absUrl}`,
      );
      event.dataTransfer.effectAllowed = 'copy';
    } else {
      // Surface the notice only when the drag ENDS unconsumed (the tile
      // snapped back) — during the drag the user is mid-gesture.
      dragOutUnsupportedFile = file;
    }
    return;
  }
  const img = event.currentTarget;
  if (!(img instanceof HTMLImageElement) || !img.naturalWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = DRAG_GHOST_SIZE;
  canvas.height = DRAG_GHOST_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { sx, sy, size } = coverCropSquare(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(
    img,
    sx,
    sy,
    size,
    size,
    0,
    0,
    DRAG_GHOST_SIZE,
    DRAG_GHOST_SIZE,
  );
  event.dataTransfer.setDragImage(
    canvas,
    DRAG_GHOST_SIZE / 2,
    DRAG_GHOST_SIZE / 2,
  );
};
// dragend fires on the SOURCE element even when the drop happened outside the
// window, so the internal-drag flag cannot leak into a later external drop.
// It is also the moment an unsupported drag-out visibly snaps back — the
// notice armed in dragstart shows only if no in-app target (e.g. the chat
// composer) consumed the drag AND the drop happened OUTSIDE the window
// (dragend reports the release point in viewport coordinates; outside the
// viewport means the user actually aimed at the desktop/another app). A drag
// simply released somewhere on the page is not a download attempt.
let dragOutUnsupportedFile: ProjectFile | null = null;
const dragOutNotice = ref<ProjectFile | null>(null);
const onFileDragEnd = (event: DragEvent): void => {
  const { wasConsumed } = internalDrag.end();
  if (dragOutUnsupportedFile) {
    const outsideWindow =
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight;
    if (!wasConsumed && outsideWindow) {
      dragOutNotice.value = dragOutUnsupportedFile;
    }
    dragOutUnsupportedFile = null;
  }
};
const downloadFromNotice = async (): Promise<void> => {
  const file = dragOutNotice.value;
  dragOutNotice.value = null;
  if (file) await handleDownloadFile(file);
};

// One download path for every tile, image or not: apiDownload carries auth
// headers (multiuser) and honours the server's Content-Disposition filename,
// which a bare cross-origin anchor would not (#109).
const handleDownloadFile = async (file: ProjectFile): Promise<void> => {
  try {
    await apiDownload(file.url, {}, file.filename ?? file.id);
  } catch {
    toast.error(t('projectDetail.files.downloadError'));
  }
};

// Pin/unpin an image as the project cover. Toggling: pinning the current cover
// again clears it (falls back to the first image).
const handleSetCover = async (file: ProjectFile) => {
  const attachmentId = file.isCover ? null : file.id;
  try {
    const res = await apiFetch(`/api/projects/${projectId}/cover`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachmentId }),
    });
    if (res.ok) await fetchFiles();
    else toast.error(t('projects.toasts.saveFailed'));
  } catch {
    toast.error(t('projects.toasts.saveFailed'));
  }
};

const handleDeleteFile = async (id: string) => {
  const ok = await confirm({
    message: t('projectDetail.photos.deleteConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const res = await apiFetch(`/api/projects/${projectId}/files/${id}`, {
      method: 'DELETE',
    });
    if (res.ok) await fetchFiles();
    else toast.error(t('projects.toasts.deleteFailed'));
  } catch {
    toast.error(t('projects.toasts.deleteFailed'));
  }
};

const statusLabels = computed(() =>
  Object.fromEntries(
    PROJECT_STATUSES.map((status) => [
      status,
      t(PROJECT_STATUS_LABEL_KEY[status]),
    ]),
  ),
);

const statusColors = PROJECT_STATUS_CHIP;

// Hero status badge, mode-aware: buckets in simple mode (coloured like the
// bucket's canonical status), raw statuses when full statuses are visible.
const heroStatusLabel = computed<string>(() => {
  if (!project.value) return '';
  return showFullStatuses.value
    ? statusLabels.value[project.value.status]
    : t(BUCKET_LABEL_KEY[statusBucket(project.value.status)]);
});
const heroStatusClass = computed<string>(() => {
  if (!project.value) return '';
  return statusColors[
    showFullStatuses.value
      ? project.value.status
      : BUCKET_CANONICAL_STATUS[statusBucket(project.value.status)]
  ];
});

// Tabs other plugins contribute into this view (#58): logistics, AI history…
// The meta shape is this slot's contract; a contribution with a `visible`
// lens (e.g. an advanced surface in simple mode) hides its entry point but a
// deep link (?tab=…) still shows it so requested content isn't orphaned.
interface ContributedTabMeta {
  tabId: string;
  labelKey: string;
  icon?: VueComponent;
  visible?: () => boolean;
}
const isContributedTabMeta = (
  meta: Record<string, unknown> | undefined,
): meta is Record<string, unknown> & ContributedTabMeta =>
  !!meta && typeof meta.tabId === 'string' && typeof meta.labelKey === 'string';

const tabContributions = useSlotContributions('projects.detail.tabs');
const contributedTabs = computed(() =>
  tabContributions.value.flatMap((c) => {
    if (!isContributedTabMeta(c.meta)) return [];
    const meta = c.meta;
    if (meta.visible && !meta.visible() && activeTab.value !== meta.tabId) {
      return [];
    }
    return [
      {
        id: meta.tabId,
        name: t(meta.labelKey),
        icon: meta.icon,
        component: c.component,
      },
    ];
  }),
);

const visibleTabs = computed(() => [
  {
    id: 'dashboard',
    name: t('projectDetail.tabs.dashboard'),
    icon: LayoutDashboard,
  },
  { id: 'components', name: t('projectDetail.tabs.components'), icon: Cpu },
  { id: 'photos', name: t('projectDetail.tabs.photos'), icon: ImageIcon },
  ...contributedTabs.value.map((tab) => ({
    id: tab.id,
    name: tab.name,
    icon: tab.icon,
  })),
]);

// A deep link into a tab that no longer exists (its contributor plugin is
// disabled) falls back to the dashboard instead of a blank pane.
const effectiveTab = computed<string>(() =>
  visibleTabs.value.some((tab) => tab.id === activeTab.value)
    ? activeTab.value
    : 'dashboard',
);

// The contributed tab currently on screen, if the active tab is contributed.
const activeContributedTab = computed(
  () =>
    contributedTabs.value.find((tab) => tab.id === effectiveTab.value) ?? null,
);

// Warm the lightbox's rendition while the grid is being looked at (#128).
//
// `lg` is generated lazily (#117), so without this the FIRST photo opened in a
// project pays a 2048 px encode between the click and the picture. Asking for
// it while the Files tab is on screen turns that into work done while the user
// is still choosing which tile to click. Declared after `effectiveTab` because
// the watcher is immediate and would read it in its temporal dead zone.
//
// Only while the tab is actually open, and only for ids not asked about before:
// it watches a list that also refreshes after every upload and after every
// agent turn, and re-warming what is already warm would turn a chat
// conversation into a stream of pointless requests. `prewarmPreviews` caps the
// batch and reports what it took, so ids past the cap stay unmarked and a
// gallery larger than one request warms the rest on the next refresh rather
// than never.
const prewarmedIds = new Set<string>();
watch(
  [effectiveTab, lightboxImages],
  ([tab, images]) => {
    if (tab !== 'photos') return;
    const pending = images
      .map((image) => image.id)
      .filter((id) => !prewarmedIds.has(id));
    for (const id of prewarmPreviews(pending, 'lg')) prewarmedIds.add(id);
  },
  { immediate: true },
);

const priorityLabels = computed(() => ({
  LOW: t('projects.priority.low'),
  MEDIUM: t('projects.priority.medium'),
  HIGH: t('projects.priority.high'),
}));

const priorityColors = {
  LOW: 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
  MEDIUM: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  HIGH: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

const formatDate = useLocaleDate();

const fetchProjectDetails = async () => {
  try {
    loading.value = true;
    const response = await apiFetch(`/api/projects/${projectId}`);
    if (response.ok) {
      project.value = await response.json();
      await fetchShoppingList();
    } else {
      router.push('/projects');
    }
  } catch {
    toast.error(t('projects.toasts.loadFailed'));
  } finally {
    loading.value = false;
  }
};
const handleAddTask = async () => {
  if (!newTaskTitle.value.trim()) return;
  try {
    const response = await apiFetch(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTaskTitle.value.trim() }),
    });
    if (response.ok) {
      newTaskTitle.value = '';
      await fetchProjectDetails();
    }
  } catch {
    toast.error(t('projects.toasts.taskAddFailed'));
  }
};

const handleToggleTaskQuick = async (task: any) => {
  try {
    const response = await apiFetch(
      `/api/projects/${projectId}/tasks/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !task.isCompleted }),
      },
    );
    if (response.ok) {
      await fetchProjectDetails();
    }
  } catch {
    toast.error(t('projects.toasts.taskUpdateFailed'));
  }
};
const handleDeleteTask = async (taskId: string) => {
  const ok = await confirm({
    message: t('projectDetail.deleteTaskConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(
      `/api/projects/${projectId}/tasks/${taskId}`,
      {
        method: 'DELETE',
      },
    );
    if (response.ok) {
      await fetchProjectDetails();
    } else {
      const err = await response.json();
      toast.error(err.message || t('projectDetail.deleteTaskError'));
    }
  } catch {
    toast.error(t('projectDetail.deleteTaskError'));
  }
};

// Adjust the required quantity of a linked component. Reuses the link endpoint
// (which updates neededQty when the link already exists). Never drops below what
// is already reserved (unreserve first to go lower).
const handleUpdateNeeded = async (pc: ProjectComponent, delta: number) => {
  const newQty = Math.max(1, pc.reservedQty, pc.neededQty + delta);
  if (newQty === pc.neededQty) return;
  // Optimistic in-place edit: only this cell (and derived buttons) re-render —
  // no full project refetch, so the view doesn't flicker. The shopping-list
  // panel is refreshed on its own since the deficit changed.
  const previous = pc.neededQty;
  pc.neededQty = newQty;
  try {
    const response = await apiFetch(`/api/projects/${projectId}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentId: pc.componentId, neededQty: newQty }),
    });
    if (response.ok) {
      await fetchShoppingList();
    } else {
      pc.neededQty = previous;
      toast.error(t('projects.toasts.saveFailed'));
    }
  } catch {
    pc.neededQty = previous;
    toast.error(t('projects.toasts.saveFailed'));
  }
};

const handleUnlinkComponent = async (componentId: string) => {
  const ok = await confirm({
    message: t('projectDetail.unlinkConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(
      `/api/projects/${projectId}/components/${componentId}`,
      {
        method: 'DELETE',
      },
    );
    if (response.ok) {
      await fetchProjectDetails();
    }
  } catch {
    toast.error(t('projects.toasts.componentUnlinkFailed'));
  }
};

const handleDeleteProject = async () => {
  const ok = await confirm({
    message: t('projectDetail.deleteConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const response = await apiFetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      router.push('/projects');
    }
  } catch {
    toast.error(t('projects.toasts.deleteFailed'));
  }
};

// Helper metrics
const progressPct = computed(() => {
  if (!project.value || project.value.tasksCount === 0) return 0;
  return Math.round(
    (project.value.completedTasksCount / project.value.tasksCount) * 100,
  );
});

// After any AI chat turn the files list AND the project itself refresh — the
// agent renames projects, re-files them into groups, adds tasks. Quiet on
// purpose: the flag that swaps the view for a spinner stays down, so the data
// updates under the reader instead of blinking at them.
const agentDataChanged = useAgentDataChanged();
watch(agentDataChanged, () => {
  void fetchFiles();
  void refreshProjectQuietly();
});

async function refreshProjectQuietly(): Promise<void> {
  try {
    const response = await apiFetch(`/api/projects/${projectId}`);
    if (response.ok) {
      project.value = await response.json();
      await fetchShoppingList();
    }
  } catch {
    // A background refresh has no user action to blame; the data on screen is
    // simply one turn older, and the next explicit load reconciles.
  }
}

onMounted(async () => {
  window.addEventListener('dragend', endFileDrag);
  window.addEventListener('drop', endFileDrag);
  window.addEventListener('dragleave', onWindowDragLeave);
  await fetchProjectDetails();
  await fetchFiles();
  if (groupsVisible.value) await groupsStore.ensureLoaded();
});
onUnmounted(() => {
  window.removeEventListener('dragend', endFileDrag);
  window.removeEventListener('drop', endFileDrag);
  window.removeEventListener('dragleave', onWindowDragLeave);
});
</script>

<template>
  <div v-if="loading" class="flex justify-center items-center py-24">
    <Spinner />
  </div>

  <!-- `min-h-full` + column flex so a tab panel can claim the rest of the
       viewport (the Files drop zone does — see #121). Other tabs keep their
       natural height; flex items never shrink below their content. -->
  <div
    v-else-if="project"
    class="flex flex-col min-h-full space-y-8 animate-fade-in"
  >
    <!-- Header Navigation Back -->
    <div class="flex items-center justify-between">
      <button
        @click="router.push('/projects')"
        class="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ $t('projectDetail.back') }}
      </button>

      <div class="flex items-center gap-2">
        <!-- Same page.header.actions slot used by PageHeader-based pages, so the
             Export control lands in one predictable top-right spot everywhere. -->
        <PluginSlot
          name="page.header.actions"
          :ctx="{ entityRef: pageContextRefs?.[0] }"
        />
        <Button
          variant="secondary"
          size="sm"
          @click="router.push('/projects/' + projectId + '/edit')"
        >
          {{ $t('projectDetail.editBtn') }}
        </Button>
        <Button variant="danger" size="sm" @click="handleDeleteProject">
          {{ $t('projectDetail.deleteBtn') }}
        </Button>
      </div>
    </div>

    <!-- Main Project Summary Hero -->
    <div
      class="glass-card rounded-3xl p-6 md:p-8 border border-slate-200 dark:border-white/5 relative overflow-hidden bg-gradient-to-tr from-brand-600/5 via-slate-100/30 to-slate-100/10 dark:from-brand-950/20 dark:via-dark-900/60 dark:to-dark-950 flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
    >
      <div class="space-y-3 flex-1">
        <div class="flex items-center gap-3">
          <h2
            class="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
          >
            {{ project.title }}
          </h2>
          <span
            class="px-2.5 py-0.5 text-xxs font-bold rounded-lg border shrink-0"
            :class="heroStatusClass"
          >
            {{ heroStatusLabel }}
          </span>
          <!-- The group is a place, so it links to that place: the projects
               list filtered to it, exactly where the sidebar's sub-item goes. -->
          <RouterLink
            v-if="groupsVisible && projectGroup"
            :to="{ path: '/projects', query: { group: projectGroup.id } }"
            class="flex items-center gap-1 min-w-0 text-xs text-slate-500 dark:text-slate-400 rounded-lg px-1.5 py-0.5 transition-colors hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <FolderTree class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ projectGroup.name }}</span>
          </RouterLink>
        </div>
        <div
          class="text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed prose prose-sm dark:prose-invert"
          v-html="
            sanitizeHtml(project.description) ||
            $t('projectDetail.noDescription')
          "
        ></div>
      </div>

      <!-- Quick progress card -->
      <div class="w-full md:w-56 shrink-0 space-y-2">
        <div
          class="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400"
        >
          <span>{{ $t('projectDetail.progressTitle') }}</span>
          <span>{{ progressPct }}%</span>
        </div>
        <div
          class="w-full h-2.5 bg-slate-200/50 dark:bg-white/5 rounded-full overflow-hidden"
        >
          <div
            class="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-500"
            :style="{ width: `${progressPct}%` }"
          ></div>
        </div>
        <span
          class="text-xxs font-medium text-slate-500 dark:text-slate-500 flex items-center gap-1"
        >
          <CheckSquare class="w-3.5 h-3.5" />
          {{
            $t('projectDetail.tasksCompleted', {
              completed: project.completedTasksCount,
              total: project.tasksCount,
            })
          }}
        </span>
      </div>
    </div>

    <!-- Tabs Layout -->
    <div
      class="border-b border-slate-200 dark:border-white/5 flex gap-6 overflow-x-auto select-none no-scrollbar"
    >
      <button
        v-for="tab in visibleTabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition-all shrink-0"
        :class="[
          effectiveTab === tab.id
            ? 'border-brand-500 text-brand-600 dark:text-brand-400'
            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
        ]"
      >
        <component :is="tab.icon" class="w-4 h-4" />
        {{ tab.name }}
      </button>
    </div>

    <!-- Tab 1: Dashboard & Tasks Checklist -->
    <div v-if="effectiveTab === 'dashboard'" class="space-y-6">
      <!-- Activity calendar + project key figures at the top of the dashboard,
           side by side (each cell is dashboard-panel sized, so the fluid heatmap
           stays compact). -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProjectActivityCalendar :project-id="projectId" />
        <ProjectKpiTiles :project="project" />
      </div>

      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-slate-900 dark:text-white">
          {{ $t('projectDetail.taskListTitle') }}
        </h3>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Task list left 2 cols -->
        <div class="lg:col-span-2 space-y-4">
          <!-- Add Task Inline Form -->
          <form
            @submit.prevent="handleAddTask"
            class="glass-card rounded-2xl p-4 flex gap-2 border border-slate-200 dark:border-white/5 shadow-sm"
          >
            <input
              v-model="newTaskTitle"
              type="text"
              :placeholder="$t('projectDetail.addTaskPlaceholder')"
              class="flex-1 bg-transparent border-0 text-sm focus:ring-0 focus:outline-none placeholder-slate-400 dark:placeholder-slate-600"
              required
            />
            <button
              type="submit"
              class="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold shadow-lg shadow-brand-600/10 transition-all shrink-0"
            >
              <Plus class="w-4 h-4" />
              {{ $t('projectDetail.addBtn') }}
            </button>
            <button
              type="button"
              @click="router.push('/projects/' + projectId + '/tasks/new')"
              class="px-3 py-2 text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 rounded-xl text-xs font-semibold transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              :aria-label="$t('projectDetail.addTaskAdvanced')"
              :title="$t('projectDetail.addTaskAdvanced')"
            >
              {{ $t('projectDetail.addTaskAdvanced') }}
            </button>
          </form>

          <!-- List of Tasks -->
          <div
            class="glass-card rounded-3xl border border-slate-200 dark:border-white/5 overflow-hidden"
          >
            <div
              v-if="project.tasks.length === 0"
              class="p-8 text-center text-slate-500"
            >
              <CheckSquare
                class="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2"
              />
              <span class="text-sm font-semibold">{{
                $t('projectDetail.noTasks')
              }}</span>
              <span class="text-xs block text-slate-400 mt-1">{{
                $t('projectDetail.noTasksHint')
              }}</span>
            </div>
            <div v-else class="divide-y divide-slate-200 dark:divide-white/5">
              <div
                v-for="task in project.tasks"
                :key="task.id"
                @click="
                  router.push('/projects/' + projectId + '/tasks/' + task.id)
                "
                class="p-4 flex items-center justify-between gap-4 hover:bg-slate-100/30 dark:hover:bg-white/[0.02] cursor-pointer transition-colors group"
              >
                <div class="flex items-center gap-3.5">
                  <input
                    type="checkbox"
                    :checked="task.isCompleted"
                    @change.stop="handleToggleTaskQuick(task)"
                    @click.stop
                    class="rounded border-slate-300 dark:border-white/15 text-brand-600 focus:ring-brand-500 cursor-pointer w-4 h-4"
                  />
                  <div class="space-y-0.5">
                    <span
                      class="text-sm font-medium transition-colors"
                      :class="[
                        task.isCompleted
                          ? 'line-through text-slate-400 dark:text-slate-500'
                          : 'text-slate-800 dark:text-slate-200',
                      ]"
                    >
                      {{ task.title }}
                    </span>
                    <div
                      v-if="task.description"
                      class="text-xxs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-md prose prose-xs dark:prose-invert"
                      v-html="sanitizeHtml(task.description)"
                    ></div>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <!-- Due date -->
                  <span
                    v-if="task.dueDate"
                    class="flex items-center gap-1 text-xxs font-medium"
                    :class="
                      DUE_STATUS_CLASS[
                        dueStatus(task.dueDate, task.isCompleted)
                      ] || 'text-slate-500 dark:text-slate-400'
                    "
                  >
                    <Calendar class="w-3 h-3" />
                    {{ formatDate(task.dueDate) }}
                  </span>
                  <!-- Priority badge -->
                  <span
                    class="px-2 py-0.5 text-xxs font-bold rounded"
                    :class="priorityColors[task.priority]"
                  >
                    {{ priorityLabels[task.priority] }}
                  </span>
                  <button
                    @click.stop="handleDeleteTask(task.id)"
                    class="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Meta info side-card right 1 col -->
        <div class="space-y-4">
          <div
            v-if="showSpecsCard"
            class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5 space-y-4"
          >
            <h4
              class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5"
            >
              <Info class="w-4 h-4 text-brand-500" />
              {{ $t('projectDetail.characteristics') }}
            </h4>

            <div class="space-y-3 text-xs font-medium">
              <div
                class="flex justify-between pb-2.5 border-b border-slate-200/50 dark:border-white/5"
              >
                <span class="text-slate-500">{{
                  $t('projectDetail.createdAt')
                }}</span>
                <span class="text-slate-800 dark:text-slate-200">{{
                  formatDate(project.createdAt) ?? '—'
                }}</span>
              </div>
              <div
                class="flex justify-between pb-2.5 border-b border-slate-200/50 dark:border-white/5"
              >
                <span class="text-slate-500">{{
                  $t('projectDetail.startDate')
                }}</span>
                <span class="text-slate-800 dark:text-slate-200">{{
                  formatDate(project.startDate) ?? '—'
                }}</span>
              </div>
              <div
                class="flex justify-between pb-2.5 border-b border-slate-200/50 dark:border-white/5"
              >
                <span class="text-slate-500">{{
                  $t('projectDetail.dueDate')
                }}</span>
                <span
                  class="flex items-center gap-1"
                  :class="
                    DUE_STATUS_CLASS[
                      dueStatus(project.dueDate, project.status === 'COMPLETED')
                    ] || 'text-slate-800 dark:text-slate-200'
                  "
                >
                  <Calendar class="w-3.5 h-3.5" />
                  {{ formatDate(project.dueDate) ?? $t('projects.noDueDate') }}
                </span>
              </div>
              <div
                class="flex justify-between pb-2.5 border-b border-slate-200/50 dark:border-white/5"
              >
                <span class="text-slate-500">{{
                  $t('projectDetail.neededComponents')
                }}</span>
                <span class="text-slate-800 dark:text-slate-200">{{
                  $t('projectDetail.pcsCount', {
                    count: project.componentsCount,
                  })
                }}</span>
              </div>
              <div
                class="flex justify-between pb-2.5 border-b border-slate-200/50 dark:border-white/5"
              >
                <span class="text-slate-500">{{
                  $t('projectDetail.projectOrders')
                }}</span>
                <span class="text-slate-800 dark:text-slate-200">{{
                  $t('projectDetail.unitsCount', {
                    count: project.relatedOrders.length,
                  })
                }}</span>
              </div>
              <div v-if="pageContextRefs">
                <PluginSlot
                  name="projects.detail.meta"
                  :ctx="{ entityRef: pageContextRefs[0], editable: true }"
                />
              </div>
            </div>
          </div>

          <!-- Budget widget (planning is an advanced surface; simple mode keeps
               a read-only "spent" line so advanced-entered spend stays visible) -->
          <div
            v-if="showBudgetPlanning"
            class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5 space-y-4"
          >
            <h4
              class="text-sm font-bold text-slate-900 dark:text-white flex items-center justify-between"
            >
              <span class="flex items-center gap-1.5">
                <span
                  class="w-2 h-2 rounded-full bg-brand-500 animate-pulse"
                ></span>
                {{ $t('projectDetail.budgetTitle') }}
              </span>
              <button
                @click="router.push('/projects/' + projectId + '/edit')"
                class="text-xxs text-brand-600 dark:text-brand-400 hover:underline font-semibold"
              >
                {{ $t('projectDetail.changeBtn') }}
              </button>
            </h4>

            <div class="space-y-3.5">
              <div v-if="project.budgetPlanned" class="space-y-1.5">
                <div class="flex justify-between text-xs font-semibold">
                  <span class="text-slate-500">{{
                    $t('projectDetail.spent')
                  }}</span>
                  <span class="text-slate-800 dark:text-slate-200">
                    {{ project.actualBudget }} / {{ project.budgetPlanned }}
                    {{ project.budgetCurrency }}
                  </span>
                </div>
                <div
                  class="w-full h-2 bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden"
                >
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="[
                      project.actualBudget > project.budgetPlanned
                        ? 'bg-rose-500'
                        : 'bg-brand-500',
                    ]"
                    :style="{
                      width: `${Math.min(100, (project.actualBudget / project.budgetPlanned) * 100)}%`,
                    }"
                  ></div>
                </div>
                <div class="flex justify-between text-xxs text-slate-400">
                  <span>{{
                    $t('projectDetail.budgetSpentProgress', {
                      percent: Math.round(
                        (project.actualBudget / project.budgetPlanned) * 100,
                      ),
                    })
                  }}</span>
                  <span
                    v-if="project.actualBudget > project.budgetPlanned"
                    class="text-rose-500 font-bold"
                    >{{ $t('projectDetail.budgetExceeded') }}</span
                  >
                </div>
              </div>
              <div v-else class="text-xs text-slate-500 text-center py-2">
                {{ $t('projectDetail.noBudget') }}
                <button
                  @click="router.push('/projects/' + projectId + '/edit')"
                  class="text-brand-600 dark:text-brand-400 hover:underline block mx-auto mt-1"
                >
                  {{ $t('projectDetail.setBudget') }}
                </button>
              </div>
            </div>
          </div>
          <div
            v-else-if="project.actualBudget > 0"
            class="glass-card rounded-2xl p-5 border border-slate-200 dark:border-white/5"
          >
            <span
              class="text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              {{
                $t('projectDetail.budget.spentOnly', {
                  amount:
                    `${project.actualBudget} ${project.budgetCurrency || ''}`.trim(),
                })
              }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: Project Components & Reservations -->
    <div v-else-if="effectiveTab === 'components'" class="space-y-6">
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <h3 class="text-base font-semibold text-slate-900 dark:text-white">
            {{ $t('projectDetail.componentsTitle') }}
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ $t('projectDetail.componentsSubtitle') }}
          </p>
        </div>
        <button
          v-if="inventoryEnabled"
          @click="router.push('/projects/' + projectId + '/components/link')"
          class="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl shadow-lg shadow-brand-600/10 transition-all text-xs font-semibold"
        >
          <Plus class="w-4 h-4" />
          {{ $t('projectDetail.linkComponentBtn') }}
        </button>
      </div>

      <!-- Shopping list / what to buy -->
      <div
        v-if="shoppingList.items.length > 0"
        class="glass-card rounded-2xl p-5 border border-amber-500/25 bg-amber-500/[0.04] space-y-4"
      >
        <div
          class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div>
            <h4
              class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5"
            >
              <ShoppingCart
                class="w-4 h-4 text-amber-600 dark:text-amber-400"
              />
              {{ $t('projectDetail.shopping.title') }}
            </h4>
            <p class="text-xxs text-slate-500 mt-0.5">
              {{ $t('projectDetail.shopping.subtitle') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              :icon-left="Copy"
              @click="copyShoppingList"
            >
              {{ $t('projectDetail.shopping.copy') }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :icon-left="FileUp"
              @click="exportShoppingCsv"
            >
              {{ $t('projectDetail.shopping.csv') }}
            </Button>
            <!-- Order handoff — contributed by logistics (#58) -->
            <PluginSlot
              name="projects.shopping-list.actions"
              :ctx="shoppingActionsCtx"
            />
          </div>
        </div>

        <div class="divide-y divide-slate-200/60 dark:divide-white/5">
          <div
            v-for="item in shoppingList.items"
            :key="item.componentId"
            class="flex items-center justify-between py-1.5 text-xs gap-3"
          >
            <span
              class="text-slate-700 dark:text-slate-200 font-medium truncate"
            >
              {{ item.name }}
              <span
                v-if="item.sku"
                class="text-slate-400 font-mono text-xxs ml-1"
                >{{ item.sku }}</span
              >
            </span>
            <span class="flex items-center gap-3 shrink-0">
              <span class="font-bold text-amber-600 dark:text-amber-400">{{
                $t('projectDetail.shopping.buyQty', { qty: item.toBuy })
              }}</span>
              <span
                v-if="item.estCost != null"
                class="text-slate-500 tabular-nums"
                >{{ item.estCost }} {{ item.currency }}</span
              >
            </span>
          </div>
        </div>

        <div
          v-if="shoppingList.totals.length > 0"
          class="flex justify-end items-center gap-3 text-xs font-bold text-slate-700 dark:text-slate-200 pt-2 border-t border-slate-200/60 dark:border-white/5"
        >
          <span class="text-slate-500 font-medium">{{
            $t('projectDetail.shopping.totalLabel')
          }}</span>
          <span
            v-for="tot in shoppingList.totals"
            :key="tot.currency"
            class="tabular-nums"
          >
            {{ tot.amount }} {{ tot.currency }}
          </span>
        </div>
      </div>

      <!-- Table of Components -->
      <div
        class="glass-card rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5"
      >
        <table class="w-full text-left border-collapse">
          <thead>
            <tr
              class="border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-white/[0.02] text-slate-500 dark:text-slate-400 text-xxs font-semibold uppercase tracking-wider"
            >
              <th class="px-6 py-4">
                {{ $t('projectDetail.table.component') }}
              </th>
              <th class="px-6 py-4 text-center">
                {{ $t('projectDetail.table.needed') }}
              </th>
              <th class="px-6 py-4 text-center">
                {{ $t('projectDetail.table.reserved') }}
              </th>
              <th class="px-6 py-4 text-center">
                {{ $t('projectDetail.table.available') }}
              </th>
              <th class="px-6 py-4 text-right">
                {{ $t('projectDetail.table.actions') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-white/5 text-sm">
            <tr
              v-for="pc in project.components"
              :key="pc.id"
              class="hover:bg-slate-100/30 dark:hover:bg-white/[0.02] transition-colors group"
            >
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="font-medium text-slate-900 dark:text-white">{{
                    pc.component.name
                  }}</span>
                  <span class="text-xxs text-slate-500 font-mono mt-0.5">{{
                    pc.component.sku
                  }}</span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    :aria-label="$t('projectDetail.decNeeded')"
                    :title="$t('projectDetail.decNeeded')"
                    class="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-colors"
                    @click="handleUpdateNeeded(pc, -1)"
                  >
                    <Minus class="w-3.5 h-3.5" />
                  </button>
                  <span
                    class="min-w-[2.5rem] text-center font-bold text-slate-800 dark:text-slate-200 tabular-nums"
                    >{{ $t('projectDetail.pcs', { qty: pc.neededQty }) }}</span
                  >
                  <button
                    type="button"
                    :aria-label="$t('projectDetail.incNeeded')"
                    :title="$t('projectDetail.incNeeded')"
                    class="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 transition-colors"
                    @click="handleUpdateNeeded(pc, 1)"
                  >
                    <Plus class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
              <td class="px-6 py-4 text-center font-bold">
                <span
                  v-if="showReservations"
                  :class="[
                    pc.reservedQty === pc.neededQty
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400',
                  ]"
                >
                  {{ pc.reservedQty }} / {{ pc.neededQty }}
                </span>
                <!-- Reservations hidden: advanced-created reserves keep a
                     read-only representation instead of vanishing -->
                <Badge
                  v-else-if="pc.reservedQty > 0"
                  tone="brand"
                  :uppercase="false"
                >
                  {{
                    $t('projectDetail.componentsTable.reservedBadge', {
                      qty: pc.reservedQty,
                    })
                  }}
                </Badge>
                <span
                  v-else
                  class="text-slate-400 dark:text-slate-500 font-normal"
                  >—</span
                >
              </td>
              <td class="px-6 py-4 text-center text-slate-500">
                {{ $t('projectDetail.pcs', { qty: pc.component.quantity }) }}
              </td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2">
                  <!-- Stock actions — contributed by inventory (#58) -->
                  <PluginSlot
                    name="projects.component-row.actions"
                    :ctx="{
                      projectId,
                      pc,
                      showReservations,
                      onChanged: fetchProjectDetails,
                    }"
                  />
                  <button
                    @click="handleUnlinkComponent(pc.componentId)"
                    class="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                    :title="$t('projectDetail.unlinkTitle')"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="project.components.length === 0">
              <td colspan="5" class="py-12 text-center text-slate-500">
                <Cpu
                  class="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto mb-2"
                />
                <span class="text-sm font-semibold">{{
                  $t('projectDetail.noComponents')
                }}</span>
                <span class="text-xs block text-slate-400 mt-1">{{
                  $t('projectDetail.noComponentsHint')
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab: Files / build-log (photos + any file). This panel distributes free
         space (the drop zone below grows via `flex-1`), so spacing is flex-native
         `gap` — `space-y` margins are consumed before growth is computed and make
         the grown child's final height harder to reason about. The root keeps
         `space-y-8`: it stacks tab panels, it doesn't distribute space. -->
    <div
      v-else-if="effectiveTab === 'photos'"
      class="flex flex-1 flex-col gap-6"
    >
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <h3 class="text-base font-semibold text-slate-900 dark:text-white">
            {{ $t('projectDetail.photos.title') }}
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ $t('projectDetail.photos.subtitle') }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <SegmentedControl
            v-model="filesView"
            :options="filesViewOptions"
            :aria-label="$t('projectDetail.files.viewLabel')"
            iconOnly
          />
          <Button
            :icon-left="Upload"
            :disabled="uploadingFiles"
            @click="openFilePicker"
          >
            {{
              uploadingFiles
                ? $t('projectDetail.photos.uploading')
                : $t('projectDetail.photos.upload')
            }}
          </Button>
        </div>
      </div>

      <!-- Drag-out unsupported → modal notice with a direct download action
           (same dialog pattern as the phone-bridge QR window) -->
      <Modal
        :model-value="dragOutNotice !== null"
        :title="$t('projectDetail.files.dragOutUnsupportedTitle')"
        width="sm"
        @update:model-value="dragOutNotice = null"
      >
        <div class="space-y-4">
          <p class="text-sm text-slate-600 dark:text-slate-400">
            {{ $t('projectDetail.files.dragOutUnsupported') }}
          </p>
          <div
            class="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-3 py-2"
          >
            <FileIcon
              class="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500"
            />
            <span
              class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate"
            >
              {{ dragOutNotice?.filename || $t('projectDetail.files.unnamed') }}
            </span>
          </div>
          <Button
            class="w-full"
            :icon-left="Download"
            @click="downloadFromNotice"
          >
            {{ $t('projectDetail.files.download') }}
          </Button>
        </div>
      </Modal>

      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden"
        @change="onFilesSelected"
      />

      <!-- Drop zone: the files area only. The title/subtitle/upload row above is
           deliberately outside it — dropping onto a heading is not a gesture the
           UI promises, and the overlay must not cover its own controls. -->
      <div
        class="relative flex flex-1 flex-col rounded-2xl transition-colors"
        :class="
          isDraggingFile
            ? 'ring-2 ring-brand-500/60 ring-offset-4 ring-offset-slate-50 dark:ring-offset-dark-950'
            : ''
        "
        @dragover="onFileDragOver"
        @dragleave="onFileDragLeave"
        @drop="onFileDrop"
      >
        <!-- Drag overlay -->
        <div
          v-if="isDraggingFile"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand-500/10 border-2 border-dashed border-brand-500/60 pointer-events-none"
        >
          <span
            class="relative flex items-center gap-2 px-6 py-3 text-sm font-semibold text-brand-600 dark:text-brand-400"
          >
            <!-- Soft readability haze (shared `.drop-hint-haze` helper) -->
            <span
              aria-hidden="true"
              class="absolute -inset-4 rounded-full drop-hint-haze"
            />
            <Upload class="relative w-5 h-5" />
            <span class="relative">{{
              $t('projectDetail.photos.dropHere')
            }}</span>
          </span>
        </div>

        <EmptyState
          v-if="files.length === 0"
          class="flex-1"
          :icon="ImageIcon"
          :title="$t('projectDetail.photos.emptyTitle')"
          :description="$t('projectDetail.photos.emptyDescription')"
        >
          <template #action>
            <Button
              variant="secondary"
              :icon-left="Upload"
              @click="openFilePicker"
            >
              {{ $t('projectDetail.photos.upload') }}
            </Button>
          </template>
        </EmptyState>

        <!-- `content-start` keeps the tiles top-aligned and square while the
             grid itself stretches to the bottom of the drop zone; the list
             draws the same files as rows (#116). -->
        <ProjectFilesListing
          v-else
          :files="files"
          :view="filesView"
          :highlighted-file-id="highlightedFileId"
          @open="openPhotoId = $event.id"
          @download="handleDownloadFile"
          @remove="handleDeleteFile"
          @toggle-cover="handleSetCover"
          @dragstart="onFileDragStart($event.event, $event.file)"
          @dragend="onFileDragEnd"
          @register-card="setFileCard($event.id, $event.el)"
        />
      </div>
    </div>

    <!-- Contributed tabs (#58): logistics orders, AI history… — each rendered
         by its owning plugin's component, with the project id as its context -->
    <component
      :is="activeContributedTab.component"
      v-else-if="activeContributedTab"
      :project-id="projectId"
    />
  </div>

  <div v-else class="text-center py-24 text-slate-500">
    <AlertTriangle class="w-12 h-12 mx-auto text-amber-500 mb-2" />
    <span class="font-bold text-sm">{{
      $t('projectDetail.projectNotFound')
    }}</span>
    <button
      @click="router.push('/projects')"
      class="mt-4 text-xs font-semibold text-brand-600 hover:underline block mx-auto"
    >
      {{ $t('projectDetail.backToList') }}
    </button>
  </div>

  <ImageLightbox
    v-model:openId="openPhotoId"
    :images="lightboxImages"
    @download="downloadFromLightbox"
  />
</template>
