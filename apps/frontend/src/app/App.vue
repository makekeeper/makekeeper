<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, type Component } from 'vue';
import {
  previewUrl,
  Badge,
  Button,
  Select,
  Modal,
  Spinner,
  Tooltip,
  MarkdownMessage,
  ToastViewport,
  ConfirmDialog,
  useConfirm,
  useNavBadges,
  useSidebarNav,
  isNavPathActive,
  resolvePluginIcon,
  usePluginsStore,
  useInternalDragStore,
  type InternalDragFile,
  usePreferencesStore,
  useSessionStore,
  useToastStore,
  useProvidersChanged,
  usePageContextSummary,
  usePageContextRefs,
  useChatSessionRequest,
  useChatPromptRequest,
  useChatSessionsChanged,
  apiFetch,
  apiDownload,
  useRealtime,
  useAvailabilityStore,
  useVersionStore,
  isAppWideDataChange,
  notifyAgentDataChanged,
  PluginSlot,
  useSlotContributions,
  getFrontendPlugin,
  getNavChildren,
  type RegisteredContribution,
  BrandMark,
  OfflineOverlay,
  ResizeHandle,
  SegmentedControl,
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MIN,
  readAsDataUrl,
  writeStoredLocale,
  COLOR_SCHEMES,
  isColorScheme,
  type ColorScheme,
  type RegisteredNavItem,
  type SegmentedOption,
  type ThemeMode,
} from '@makekeeper/frontend-core';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  APP_LOCALES,
  parseAppLocale,
  parseObjectRef,
  attachmentRejectionParams,
  formatByteSize,
  DATA_CHANGED_EVENT,
  SECRET_ACCESS_EVENT,
  type SecretAccessRealtimePayload,
  isAvailableAttachment,
  isResolvedChatContext,
  isHeaderItemMeta,
} from '@makekeeper/plugin-contract';
import type {
  AttachmentDescriptor,
  AttachmentRejection,
  PageContext,
  PluginNavChild,
  PhoneBridgeContext,
  ResolvedChatContext,
} from '@makekeeper/plugin-contract';
import {
  ModeTransitionOverlay,
  UserMenu,
} from '@makekeeper/plugin-multiuser/frontend';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { useAttachmentRulesStore } from '../stores/attachment-rules';
import HeaderOverflowRow from './HeaderOverflowRow.vue';
import HeaderItem from './HeaderItem.vue';
import HeaderOverflowSection from './HeaderOverflowSection.vue';
import HeaderAvatarMenu from './HeaderAvatarMenu.vue';
import HeaderOverflowBadge from './HeaderOverflowBadge.vue';
import {
  HEADER_PRIORITY,
  HEADER_SLOTS,
  panelOrderFor,
  priorityFor,
} from './header-overflow';
import {
  FolderGit,
  Layers,
  ShoppingBag,
  Bot,
  Settings as SettingsIcon,
  Menu,
  X,
  Send,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  Palette,
  Box,
  CheckCircle,
  XCircle,
  ShieldAlert,
  Camera,
  Loader,
  Blocks,
  Plus,
  History,
  Trash2,
  MessageSquare,
  ImagePlus,
  RotateCcw,
  Smartphone,
  Paperclip,
  Users,
  Share2,
  Feather,
  Zap,
  File as FileIcon,
  FileX,
  Download,
  ChevronDown,
} from '@lucide/vue';

const route = useRoute();
const { locale, t, te } = useI18n();
const toast = useToastStore();

// Phone-capture routes (/capture/:token) render as a bare full-screen page,
// without the desktop shell (sidebar/header/chat panel).
const isFullscreenRoute = computed<boolean>(() =>
  Boolean(route.meta.fullscreen),
);

const isChatOpen = ref(true);
const chatInput = ref('');

// The header's plugin-facing slots, driven by the HEADER_SLOTS table (#277):
// contributions are enumerated rather than rendered through `PluginSlot`,
// because each one is a separate overflow unit (#274) — the shell needs the
// list, not just the rendered result. Same registry, same enabled/visible
// filtering. The sources are collected at setup (composables cannot run
// inside a computed); the flat item list derives everything a `HeaderItem`
// needs from the slot's rank and the contribution's position in its slot's
// `order`-sorted list — the raw `order` value never reaches the priority
// scale, so no contribution can cross its slot's boundary.
const headerSlotSources = HEADER_SLOTS.map((slot) => ({
  slot,
  contributions: useSlotContributions(slot.name),
}));

// What names a collapsed contribution in the avatar menu: its own
// `meta.labelKey` when declared and resolvable, else its plugin's registry
// name key — NOT the `plugins.<id>.name` template, which does not exist for
// an external plugin (its name key is namespaced) — else the bare plugin id.
// `te()` guards every step so a raw i18n key is never shown.
const contributionLabel = (c: RegisteredContribution): string => {
  if (isHeaderItemMeta(c.meta) && te(c.meta.labelKey))
    return t(c.meta.labelKey);
  const nameKey = getFrontendPlugin(c.pluginId)?.nameKey;
  return nameKey && te(nameKey) ? t(nameKey) : c.pluginId;
};

interface HeaderSlotItem {
  id: string;
  priority: number;
  panelOrder: number;
  panelFull: boolean;
  label: string;
  component: RegisteredContribution['component'];
}

const headerSlotItems = computed<HeaderSlotItem[]>(() => {
  const items = headerSlotSources.flatMap(({ slot, contributions }) =>
    contributions.value.map((c, index, all) => ({
      // Stable across plugin toggles — never the v-for index, which shifts
      // when a neighbour's plugin toggles and poisons the measurement cache.
      id: `${slot.name}:${c.pluginId}:${c.order ?? 100}`,
      priority: priorityFor(slot.priority, index, all.length),
      panelOrder: panelOrderFor(slot.panelOrder, index),
      panelFull: slot.panelFull,
      label: contributionLabel(c),
      component: c.component,
    })),
  );
  if (import.meta.env.DEV) {
    const seen = new Set<string>();
    for (const item of items) {
      // Two same-slot contributions from one plugin with an equal `order` are
      // an author error — the id must key the measurement cache uniquely.
      if (seen.has(item.id)) console.warn(t('header.duplicateItemId'), item.id);
      seen.add(item.id);
    }
  }
  return items;
});

// The header's one state-dependent priority (#274). While the chat panel is
// open, the button that opens it is repeating what is already on screen — and
// the panel is exactly what took the width away — so it gives way first.
const aiButtonPriority = computed<number>(() =>
  isChatOpen.value
    ? HEADER_PRIORITY.aiAssistantChatOpen
    : HEADER_PRIORITY.aiAssistant,
);

const currentLanguage = ref(locale.value);
// Built from the contract's list rather than kept alongside it (#211): the
// bundles, the QR parameter and this switcher have to agree on what we ship, and
// a second list is how they stop agreeing. The label is the tag itself.
const languageOptions = APP_LOCALES.map((value) => ({
  value,
  label: value.toUpperCase(),
}));

// Persisted through the same helper the bootstrap resolver reads (#211) — a
// phone inherits this very value through the pairing QR.
const handleLanguageChange = (lang: string) => {
  const chosen = parseAppLocale(lang);
  if (!chosen) return;
  locale.value = chosen;
  writeStoredLocale(chosen);
};

const getHeaderTitle = computed(() => {
  if (route.name) {
    const key = `routeTitles.${route.name as string}`;
    if (te(key)) {
      return t(key);
    }
  }
  return (route.meta.title as string) || t('common.appName');
});

// A new page title is a new width on the header's line, and the overflow row
// reserves the title's natural width (#274) — nudge it, since no resize fires.
const headerRow = ref<InstanceType<typeof HeaderOverflowRow> | null>(null);
watch(getHeaderTitle, () => headerRow.value?.sync());

// The browser-tab title is i18n-driven, never a literal (§5.5): it tracks the active
// route title and locale. `index.html` only carries the brand wordmark as the
// pre-mount bootstrap title, replaced here as soon as the shell mounts.
watch(
  getHeaderTitle,
  (title) => {
    document.title =
      route.name === 'home'
        ? t('common.appName')
        : `${title} · ${t('common.appName')}`;
  },
  { immediate: true },
);

// AI assistant state lives in a Pinia store (§5.3) — it outlives the view.
const chatStore = useChatStore();
const { messages: chatMessages, isSending, liveStage } = storeToRefs(chatStore);
const confirm = useConfirm();

// Cross-device refetch nudge (#61): the backend pushes data:changed into the
// scope room after an agent tool mutates data. Reuses the same tick views
// already watch — the initiating client's local call stays as the fallback.
//
// A SCREEN-ONLY nudge is skipped: an external plugin invalidating its own
// screen is not news about the core's data, and following it made every open
// view refetch on that plugin's timer — a printer reporting a temperature
// every fifteen seconds made the inventory list blink.
useRealtime().on(DATA_CHANGED_EVENT, (payload) => {
  if (isAppWideDataChange(payload)) notifyAgentDataChanged();
});

// Out-of-session secret use (#63): the backend notifies a key's owner when a
// background job or a workspace guest used one of their personal secrets. Prove
// it happened rather than fail to prevent it — surface an info toast. `purposeKey`
// is a plugin i18n key resolved here; a missing key degrades to a generic notice.
const isSecretAccessPayload = (v: unknown): v is SecretAccessRealtimePayload =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SecretAccessRealtimePayload).purposeKey === 'string' &&
  typeof (v as SecretAccessRealtimePayload).byGuest === 'boolean';

useRealtime().on(SECRET_ACCESS_EVENT, (payload) => {
  if (!isSecretAccessPayload(payload)) return;
  const purpose = te(payload.purposeKey)
    ? t(payload.purposeKey)
    : t('secretAccess.genericPurpose');
  useToastStore().info(
    t(payload.byGuest ? 'secretAccess.usedByGuest' : 'secretAccess.usedByJob', {
      purpose,
    }),
  );
});

// Live agent-turn stage line (#61) shown inside the typing indicator while a
// turn is in flight; null (socket down / no event yet) falls back to the
// generic "thinking" label.
const liveStageText = computed<string | null>(() => {
  const stage = liveStage.value;
  if (!stage) return null;
  switch (stage.type) {
    case 'turn_started':
      return t('chat.stages.starting', { turn: stage.turn });
    case 'llm_call_started':
      return t('chat.stages.thinking', { turn: stage.turn });
    case 'tool_started':
      return t('chat.stages.toolRunning', { name: stage.toolName });
    case 'tool_finished':
      return stage.ok
        ? t('chat.stages.toolDone', { name: stage.toolName })
        : t('chat.stages.toolFailed', { name: stage.toolName });
    case 'awaiting_confirmation':
      return t('chat.stages.awaitingConfirmation');
    default:
      return null;
  }
});

// Raw tool-call entries are hidden; tool activity renders as compact status
// chips (see the messages log) rather than dumping tool JSON into a bubble.
const visibleMessages = computed<ChatMessage[]>(() =>
  chatMessages.value.filter((m) => m.kind !== 'tool_call'),
);
const toolChipLabel = (msg: ChatMessage): string => {
  const name = msg.toolName ?? '';
  if (msg.kind === 'tool_cancelled') return t('chat.toolCancelled', { name });
  if (msg.kind === 'tool_executing') return t('chat.toolExecuting', { name });
  return t('chat.toolUsed', { name });
};

// Keep the conversation pinned to the latest message so a just-sent message and
// the reply/typing indicator are always visible.
const messagesRef = ref<HTMLElement | null>(null);
const scrollChatToBottom = (): void => {
  const el = messagesRef.value;
  if (el) el.scrollTop = el.scrollHeight;
};
// An attached image grows the content after it decodes — re-pin, but only if the
// user is already at the bottom (don't yank them while they scroll up history).
const onMessageImageLoad = (): void => {
  const el = messagesRef.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
    scrollChatToBottom();
  }
};
// Fires on new messages, on the typing indicator, and on switching chats
// (which replaces the message list).
watch(
  () => [chatMessages.value.length, isSending.value] as const,
  () => nextTick(scrollChatToBottom),
);

// Real AI-provider connection state for the assistant header.
const chatStatusText = computed<string>(() => {
  const name = chatStore.activeProviderName ?? '';
  switch (chatStore.connectionStatus) {
    case 'connected':
      return t('chat.status.connected', { name });
    case 'error':
      return name
        ? t('chat.status.error', { name })
        : t('chat.status.errorNoProvider');
    case 'none':
      return t('chat.status.none');
    default:
      return t('chat.status.checking');
  }
});

const chatStatusColor = computed<string>(() => {
  switch (chatStore.connectionStatus) {
    case 'connected':
      return 'text-emerald-500 dark:text-emerald-400';
    case 'error':
      return 'text-red-500 dark:text-red-400';
    case 'none':
      return 'text-slate-400 dark:text-slate-500';
    default:
      return 'text-amber-500 dark:text-amber-400';
  }
});

const chatStatusDot = computed<string>(() => {
  switch (chatStore.connectionStatus) {
    case 'connected':
      return 'bg-emerald-500 dark:bg-emerald-400';
    case 'error':
      return 'bg-red-500 dark:bg-red-400';
    case 'none':
      return 'bg-slate-400 dark:bg-slate-500';
    default:
      return 'bg-amber-500 dark:bg-amber-400';
  }
});

// Plugins declare icons by name in their manifest; the sidebar resolves them
// through the shared, drift-guarded registry (see @makekeeper/frontend-core's
// plugin-icons) — never a local copy, which is how the sidebar previously fell
// out of sync and rendered the Box fallback for newer plugins.
const resolveIcon = (name: string): Component => resolvePluginIcon(name);

// Dashboard is an app-level view, not a plugin — it seeds the main nav; every
// other entry comes from the plugin registry (no hardcoded plugin nav here).
const coreNav: RegisteredNavItem[] = [
  {
    path: '/',
    titleKey: 'nav.dashboard',
    icon: 'Layers',
    section: 'main',
    pluginId: 'core',
  },
];
// Only enabled plugins contribute nav entries (core `dashboard` is always on).
const pluginsStore = usePluginsStore();
// The AI assistant panel + its header toggle belong to the `chat` plugin, so
// they disappear when it is disabled.
const chatEnabled = computed<boolean>(() => pluginsStore.isEnabled('chat'));
// The "capture from phone" button in the composer belongs to the capture plugin.
const captureEnabled = computed<boolean>(() =>
  pluginsStore.isEnabled('capture'),
);
// What the phone surface encodes a camera frame as (`CapturePhoneSurface.vue`
// calls `toDataURL('image/jpeg')`). A mime type is a technical identifier, not
// text.
const CAPTURED_PHOTO_MIME = 'image/jpeg';
// What a phone-captured photo attaches to — the current chat.
const captureContext = computed<PhoneBridgeContext>(() => ({
  kind: 'capture',
  targetId: chatStore.sessionId ?? undefined,
  contextLabel: t('capture.desktop.chatContext'),
}));
const onCapturedPhoto = (url: string): void => {
  // The phone bridge reports only the URL, so nothing else here knows this is a
  // picture — and since #112 the chip renders from metadata, not from whether
  // an <img> managed to load. Without this the user's own photo comes back as a
  // generic file chip until the server echoes the session's attachments.
  //
  // Optimistic and deliberately ungated: capture only ever produces a camera
  // photo, and guessing its mime just to run the format check could refuse a
  // real photo on a wrong guess. `sendMessage` re-validates server-side against
  // the true stored metadata, which is where a refusal belongs.
  attachmentMeta.value.set(url, {
    url,
    mimeType: CAPTURED_PHOTO_MIME,
    filename: null,
    isImage: true,
    // Unknown until the server echoes the real row back; never rendered,
    // because a picture shows a preview rather than a size.
    sizeBytes: 0,
  });
  if (!attachedFiles.value.includes(url)) attachedFiles.value.push(url);
};

// Unified "+" attach menu. The phone-capture option is a capture-plugin
// contribution rendered into the `app.header.capture` slot (#58) — the shell
// imports no capture code. It reports its live-session flag back through the
// slot ctx so the "+" icon can pulse. With a single option available (capture
// disabled) the "+" acts directly instead of opening a menu.
const showAttachMenu = ref(false);
const captureActive = ref<boolean>(false);
// Props/callbacks for the capture contribution: what a phone photo attaches to,
// where captured URLs land, live-state mirroring, and closing the attach menu
// once the option is chosen.
const captureSlotCtx = computed<Record<string, unknown>>(() => ({
  context: captureContext.value,
  onPhoto: onCapturedPhoto,
  onActiveChange: (active: boolean): void => {
    captureActive.value = active;
  },
  onSelect: (): void => {
    showAttachMenu.value = false;
  },
}));
// The project the OPEN PAGE names, from its published refs. Distinct from the
// assistant's scope (`chatStore.projectId`, #130), which is this whenever the
// user is on a project page and stays put once they leave.
const currentProjectId = computed<string | null>(() => {
  for (const raw of pageContextRefs.value ?? []) {
    const ref = parseObjectRef(raw);
    if (ref && ref.pluginId === 'projects' && ref.entityType === 'project') {
      return ref.entityId;
    }
  }
  return null;
});

// "Choose from project files" picker (images already uploaded to the project).
// The listed shape is what the attachment gate needs to judge a file (#112) —
// mime, size and the probed picture verdict, not just a URL.
type ProjectFileOption = AttachmentDescriptor & { id: string };

const showProjectFilesPicker = ref(false);
const loadingProjectFiles = ref(false);
const projectFilesList = ref<ProjectFileOption[]>([]);

// Files already uploaded to the project the assistant is scoped to — the same
// project the context line names, so the picker offers what the panel says it
// is working in rather than only what the current page happens to be.
const pickProjectFiles = async (): Promise<void> => {
  showAttachMenu.value = false;
  const pid = chatStore.projectId;
  if (!pid) return;
  showProjectFilesPicker.value = true;
  loadingProjectFiles.value = true;
  try {
    const res = await apiFetch(`/api/projects/${pid}/files`);
    if (res.ok) {
      const all: ProjectFileOption[] = await res.json();
      projectFilesList.value = all.filter((f) => f.isImage);
    }
  } catch {
    projectFilesList.value = [];
  } finally {
    loadingProjectFiles.value = false;
  }
};

const attachProjectFile = (file: ProjectFileOption): void => {
  attachCandidates([{ url: file.url, meta: { ...file } }]);
  showProjectFilesPicker.value = false;
};

// Drag-and-drop onto the composer: an internal drag of an already-uploaded
// file (image or not) attaches its /api/uploads/ URL; external image files
// are uploaded. Non-image external files are ignored (they have no stored
// counterpart to reference).
//
// Internal drags are recognised via the shared internal-drag store, not a
// DataTransfer flavour: the project Files tiles deliberately keep the drag
// data store native/minimal so the same drag can save a real file when it
// ends on the desktop (#109).
const internalDrag = useInternalDragStore();
const isChatDragging = ref(false);
const onChatDragOver = (event: DragEvent): void => {
  const types = event.dataTransfer?.types;
  if (internalDrag.isActive() || types?.includes('Files')) {
    event.preventDefault();
    isChatDragging.value = true;
  }
};
const onChatDragLeave = (event: DragEvent): void => {
  // Clear only when the pointer truly leaves the chat column (see the projects
  // Files drop zone for the same relatedTarget-based reasoning).
  const el = event.currentTarget as HTMLElement | null;
  if (el && !el.contains(event.relatedTarget as Node | null)) {
    isChatDragging.value = false;
  }
};
// Safety net for cancelled/ended drags (Esc, dropped elsewhere, left the window).
const endChatDrag = (): void => {
  isChatDragging.value = false;
};
const onWindowChatDragLeave = (event: DragEvent): void => {
  if (!event.relatedTarget) isChatDragging.value = false;
};
const onChatDrop = async (event: DragEvent): Promise<void> => {
  event.preventDefault();
  isChatDragging.value = false;
  const dt = event.dataTransfer;
  if (!dt) return;
  // An in-app drag of an already-stored file — attach it by reference
  // (any type: the runtime decides how to present it to the model).
  const internal = internalDrag.consume();
  if (internal) {
    attachCandidates([{ url: internal.url, meta: internal }]);
    return;
  }
  const images = Array.from(dt.files).filter((f) =>
    f.type.startsWith('image/'),
  );
  const candidates: { url: string; meta: InternalDragFile }[] = [];
  for (const file of images) {
    const url = await readAsDataUrl(file);
    candidates.push({ url, meta: describeLocalFile(file, url) });
  }
  attachCandidates(candidates);
};

// The chat column's drop zone is drawn by two elements — the panel and the
// splitter that covers its first pixels (#283) — and both must accept a file,
// or one let go on the seam is opened by the browser instead (#112, #121).
// Bound as one object so the pair cannot drift apart.
const chatDropHandlers = {
  onDragover: onChatDragOver,
  onDragleave: onChatDragLeave,
  onDrop: onChatDrop,
};

const onAddClick = (): void => {
  // Show the menu when there is more than one source (upload always exists).
  if (captureEnabled.value || chatStore.projectId) {
    showAttachMenu.value = !showAttachMenu.value;
  } else {
    openFilePicker();
  }
};
const pickUpload = (): void => {
  showAttachMenu.value = false;
  openFilePicker();
};
// Multiuser session (login state, admin flag) — drives the header user menu
// and hides admin-only nav entries from regular users. `adminOnly` only
// applies while multi-user mode is on: in single-user mode there is no admin
// and the single user administers everything.
const sessionStore = useSessionStore();
const versionStore = useVersionStore();
// Simple/advanced UX mode: a display lens over the same data, owned by the
// `uxmode` plugin (its enablement gates the header toggle — same pattern as
// the chat panel). Nav entries a plugin marks `advanced` disappear in simple
// mode; in-view surfaces gate via useUxMode().isFeatureVisible inside each
// plugin. With the plugin disabled everything is visible.
const prefs = usePreferencesStore();
const uxModeEnabled = computed<boolean>(() => pluginsStore.isEnabled('uxmode'));
// The rail's width is a stored preference (#268), not component state — read
// only here, written through `prefs.toggleSidebar()`, so the two burgers cannot
// flip the ref without persisting it.
const isSidebarOpen = computed<boolean>(() => prefs.isSidebarOpen);
// The chat column's width is stored the same way (#283). One number feeds both
// the panel's width and the content area's reservation, so the pair that used
// to be `w-96`/`pr-96` cannot drift apart. `isChatResizing` is the drag itself:
// while it runs, both sides drop their 300ms transition, or the column would
// lag a frame-by-frame value across the screen.
const chatWidth = computed<number>(() => prefs.chatWidth);
const isChatResizing = ref(false);
// The sidebar's entries come from ONE shared visibility filter (#110), also used
// by every hub's tab bar — the rule (enabled / adminOnly / advanced) must not be
// duplicated here. Hub tabs are not sidebar entries, and a hub with no visible
// tab is dropped, so exactly one entry lights up on a hub sub-path.
const sidebarNav = useSidebarNav();
// Sidebar badges (#307): the shell asks the registered sources and renders a
// number; it never learns that the number counts notifications. A collapsed
// rail has no room for a count, so it shows the fact rather than the figure.
const navBadges = useNavBadges();
const navBadgeOf = (item: RegisteredNavItem): number => navBadges.value(item);
const mainNav = computed<RegisteredNavItem[]>(() => [
  ...coreNav,
  ...sidebarNav.value.filter((n) => (n.section ?? 'main') === 'main'),
]);
const systemNav = computed<RegisteredNavItem[]>(() =>
  sidebarNav.value.filter((n) => n.section === 'system'),
);

// Runtime sub-items (#288): a nav entry may name a `childrenProvider`, and the
// shell renders whatever that provider returns — indented, one level, never
// learning what the children ARE. Project groups are the first user; storages
// and tags are the obvious next ones.
//
// Two rules, settled in the ticket: sub-items appear only while the rail is
// EXPANDED (the collapsed rail keeps the shared gutter and no geometry of its
// own, per #259), and only when there is more than one child — a single folder
// is not a tree worth drawing.
const navChildrenOf = (item: RegisteredNavItem): PluginNavChild[] =>
  getNavChildren(item);

const hasNavChildren = (item: RegisteredNavItem): boolean =>
  prefs.isSidebarOpen && navChildrenOf(item).length > 1;

// A sub-item is active when the route IS its target — same path, and every
// query parameter the child names present with that value. Compared this way
// rather than by full path so the list's own state (`view`, `q`, `status`, a
// tag) does not un-light the group the user is standing in. The shell still
// knows nothing about what the parameters mean.
const isNavChildActive = (child: PluginNavChild): boolean => {
  const [path, search] = child.path.split('?');
  if (route.path !== path) return false;
  const wanted = new URLSearchParams(search ?? '');
  for (const [key, value] of wanted.entries()) {
    const actual = route.query[key];
    const current = Array.isArray(actual) ? actual[0] : actual;
    if (current !== value) return false;
  }
  return true;
};

// An entry the user has never touched follows the route: landing on a group
// opens its parent. Once there IS an opinion, the opinion wins — including
// "closed while standing on a group".
const isNavExpanded = (item: RegisteredNavItem): boolean =>
  prefs.navExpanded[item.path] ??
  navChildrenOf(item).some((child) => isNavChildActive(child));

const toggleNavExpanded = (item: RegisteredNavItem): void => {
  prefs.setNavExpanded(item.path, !isNavExpanded(item));
};

// A section stays highlighted while the user drills into its detail views
// (`/inventory/123` keeps `/inventory` lit). The rule itself lives in
// frontend-core so the sidebar and the hub tab bars share one implementation;
// since hub tabs are no longer sidebar entries (#110), exactly one entry lights
// up on a hub sub-path.
const isNavActive = (path: string): boolean =>
  isNavPathActive(route.path, path);

// Theme state and `.dark` application live in the preferences store (§5.3); the
// header just binds the three-position control to it.
const themeMode = computed<ThemeMode>({
  get: () => prefs.themeMode,
  set: (mode) => prefs.setTheme(mode),
});
const themeOptions = computed<SegmentedOption<ThemeMode>[]>(() => [
  { value: 'light', label: t('header.theme.light'), icon: Sun },
  { value: 'dark', label: t('header.theme.dark'), icon: Moon },
  { value: 'system', label: t('header.theme.system'), icon: Monitor },
]);

// Colour scheme picker (#236): an icon-only `Select` between the language
// selector and the theme switch. It is the shared primitive with its trigger
// and rows re-skinned through slots — not a second dropdown — so it inherits
// the teleported panel, the arrow-key roving highlight and the outside-click
// handling (#105). Each row previews its scheme by carrying `data-scheme`
// itself: themes.css re-scopes the brand/dark variables for that subtree, so
// the swatches need no per-scheme colour list here.
const schemeOptions = computed(() =>
  COLOR_SCHEMES.map((scheme) => ({
    value: scheme,
    label: t(`header.scheme.${scheme}`),
  })),
);
const pickScheme = (scheme: ColorScheme): void => {
  prefs.setColorScheme(scheme);
};

// Pointing at a row paints the whole app in that scheme; only a click settles
// it. Leaving the row (or closing the panel) hands `null` back and the stored
// scheme returns — the swatch says what the accent is, the preview says what
// the app looks like, and those are not the same question.
const previewScheme = (option: { value: unknown } | null): void => {
  prefs.previewColorScheme(
    option && isColorScheme(option.value) ? option.value : null,
  );
};

// Authenticated API calls are pointless (401) until the user signs in while
// multi-user mode is on; in single-user mode there is no login at all.
const canUseAuthedApi = computed<boolean>(
  () => !sessionStore.multiuserEnabled || sessionStore.isAuthenticated,
);

const initChatShell = (): void => {
  if (chatEnabled.value && canUseAuthedApi.value) {
    chatStore.refreshConnection();
    chatStore.initChat();
    // The attachment rules belong to the owner of the ACTIVE connection, so
    // they are re-read whenever the shell (re)initialises — including after a
    // login, where the previous account's ruleset must not linger.
    attachmentRules.load();
  }
};

// Watch backend availability and lock the UI behind the offline overlay when
// it drops (#64). Started once here so the monitor runs for the whole session,
// including the fullscreen phone-capture page.
const availabilityStore = useAvailabilityStore();
availabilityStore.start();

// Gate the routed content on "the backend has been confirmed live at least
// once", so a plugin view never mounts (and fires its onMounted fetch) against a
// still-booting backend and ends up showing empty — the exact failure this
// ticket exists to prevent (#64). Crucially this is a *mount gate on first
// load*, NOT a remount: once the content is shown it stays mounted for the whole
// session, so a mid-session outage never tears the current view down and never
// loses in-progress edits.
const contentReady = ref(false);

// Healthy first load: main.ts already bootstrapped session + plugins before
// mount and the very first probe reports online with no prior failure
// (recoveryTick still 0) — reveal the content immediately.
watch(
  () => availabilityStore.status,
  (status) => {
    if (status === 'online' && availabilityStore.recoveryTick === 0) {
      contentReady.value = true;
    }
  },
  { immediate: true },
);

// A probe that succeeds *after* a failure bumps recoveryTick. What we do next
// depends ENTIRELY on whether the app ever finished initialising, because the
// two cases have opposite requirements:
//
//  - Boot race (content never revealed): main.ts's pre-mount bootstrap ran
//    against a down backend and failed, so session + plugin state are empty.
//    Initialise them now, THEN reveal the content — the first render happens
//    against a live backend, with correct data.
//
//  - Mid-session reconnect (content already live): the view is mounted and may
//    hold unsaved edits. Recovery must be a STRICT NO-OP — the overlay hides
//    reactively and the user continues exactly where they were. No re-bootstrap
//    or plugin refetch (fetchPlugins() recomputes every `isEnabled` v-if and
//    can remount views), and no data-changed nudge either: that refetch storm
//    re-syncs form state from the server and wipes in-progress edits (this is
//    the "page reloaded on reconnect" report). Post-outage staleness is the
//    accepted trade-off; agent-driven changes still arrive via the real
//    `data:changed` socket event once the socket reconnects.
watch(
  () => availabilityStore.recoveryTick,
  async () => {
    if (contentReady.value) return;
    await sessionStore.bootstrap();
    await pluginsStore.fetchPlugins();
    notifyAgentDataChanged();
    contentReady.value = true;
  },
);

onMounted(() => {
  initChatShell();
  versionStore.refresh();
  window.addEventListener('dragend', endChatDrag);
  window.addEventListener('drop', endChatDrag);
  window.addEventListener('dragleave', onWindowChatDragLeave);
  // One-time hint on the very first run after the simple/advanced mode
  // shipped: the UI now starts simple, tell the user where the switch lives.
  if (prefs.isFirstRun && !isFullscreenRoute.value && uxModeEnabled.value) {
    useToastStore().info(t('uxmode.header.firstRun'));
    prefs.acknowledgeFirstRun();
  }
});

// Login/logout/user switch: wipe the previous account's chat state and
// initialize for the new one — without this the shell stayed in its
// pre-login "everything 401'd" state until a manual page refresh.
watch(
  () => sessionStore.user?.id,
  (userId, previous) => {
    if (userId === previous) return;
    chatStore.reset();
    if (userId) {
      initChatShell();
      // Effective plugin states are per-user — refetch with the new token.
      pluginsStore.fetchPlugins();
    }
  },
);

// Re-check the real connection whenever the panel is (re)opened.
watch(isChatOpen, (open) => {
  if (!open) return;
  if (chatEnabled.value && canUseAuthedApi.value) chatStore.refreshConnection();
  nextTick(scrollChatToBottom);
});

// A plugin view (the project AI-history tab, #59) asked to open a specific chat
// session: reveal the panel, select the session, and refresh the switcher list.
const chatSessionRequest = useChatSessionRequest();
watch(chatSessionRequest, async (req) => {
  if (!req || !chatEnabled.value) return;
  isChatOpen.value = true;
  await chatStore.selectSession(req.sessionId);
  await chatStore.loadSessions();
  nextTick(scrollChatToBottom);
});

// A view (the dashboard bench, #90) asked to open the assistant with the
// composer pre-filled: reveal the panel and drop the text in WITHOUT sending —
// the user edits and submits. Focus the textarea so they can type straight away.
const chatPromptRequest = useChatPromptRequest();
watch(chatPromptRequest, (req) => {
  if (!req || !chatEnabled.value) return;
  isChatOpen.value = true;
  // Empty text = a bare "open the assistant" (the dashboard "ask" verb): reveal
  // and focus without clobbering an in-progress draft. Non-empty prefills.
  if (req.text) chatInput.value = req.text;
  nextTick(() => {
    autoGrowInput();
    chatInputRef.value?.focus();
    scrollChatToBottom();
  });
});

// The AI-history panel changed the session set (delete/rename/pin, #59) — keep the
// sidebar's list in sync, and reconcile the open chat if it was the one deleted.
const chatSessionsChanged = useChatSessionsChanged();
watch(chatSessionsChanged, (change) => {
  if (!change || !chatEnabled.value) return;
  void chatStore.syncSessionsAfterExternalChange(change.deletedSessionId);
});

// Auto-refresh the status when the provider config changes in settings.
const providersChanged = useProvidersChanged();
watch(providersChanged, () => {
  if (chatEnabled.value && canUseAuthedApi.value) chatStore.refreshConnection();
});

// --- Composer: auto-growing textarea + up/down message-history recall ---
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const historyPos = ref<number | null>(null);
const historyDraft = ref('');
const MAX_INPUT_ROWS = 7;

const autoGrowInput = (): void => {
  const el = chatInputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  const cs = getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || 20;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const max = lineHeight * MAX_INPUT_ROWS + padY;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
};

// --- Composer attachments (multiple: typed/pasted files, phone-capture photos
// and project files dragged in — data URLs or stored /api/uploads/ URLs, and
// not necessarily images since #109) ---
const attachedFiles = ref<string[]>([]);
const imageInputRef = ref<HTMLInputElement | null>(null);

const openFilePicker = (): void => imageInputRef.value?.click();
const removeImage = (index: number): void => {
  attachedFiles.value.splice(index, 1);
};

// What each attached URL actually is, so a chip renders from metadata instead
// of from a failed <img> load (#112). A non-image must never be requested as a
// picture: the preview variant falls back to the ORIGINAL server-side, so the
// browser would download the whole file just to draw a broken icon.
const attachmentMeta = ref(new Map<string, InternalDragFile>());

// Attachments the history references that no longer exist (#127), mapped to the
// only thing still known about them: the filename, when the row outlived its
// bytes. Kept apart from `attachmentMeta` on purpose — that map answers "what is
// this file", and a file that is gone has no answer to give. A URL is in here
// ONLY because the server said so, so an empty map never means "the history has
// not loaded yet".
const missingAttachments = ref(new Map<string, string | null>());

// The history's own attachments, learned when a session loads. Merged with what
// the composer already knows (files attached in THIS session, before the server
// has echoed them back) so bubbles and chips both answer from metadata.
watch(
  () => chatStore.attachments,
  (list) => {
    const next = new Map(attachmentMeta.value);
    const gone = new Map<string, string | null>();
    for (const item of list) {
      if (!isAvailableAttachment(item)) {
        gone.set(item.url, item.filename);
        // Drop a stale descriptor: the same URL may have been describable
        // earlier in this session, and the newer answer is the true one.
        next.delete(item.url);
        continue;
      }
      const { status: _status, ...meta } = item;
      next.set(item.url, meta);
    }
    attachmentMeta.value = next;
    missingAttachments.value = gone;
  },
  { immediate: true, deep: true },
);

// Is this attachment known to be gone? Never a guess: a URL the server has not
// spoken about renders in its ordinary state, which is what keeps a metadata
// load in flight from looking like a deleted file.
const isMissingAttachment = (url: string | null | undefined): boolean =>
  typeof url === 'string' && missingAttachments.value.has(url);
// The filename of a missing attachment is worth showing when the row outlived
// its bytes; when even that is gone the card says only that the file is not
// there, rather than inventing a name for it.
const missingAttachmentName = (url: string): string | null =>
  missingAttachments.value.get(url) ?? null;

const isPicture = (url: string): boolean => {
  const meta = attachmentMeta.value.get(url);
  // A data URL is only ever produced by the image picker/paste path.
  return meta ? meta.isImage : url.startsWith('data:');
};
// Whether this attachment should be painted as a picture at all: it must be
// one, it must still exist, and it must not have already failed to decode.
const showsPicture = (url: string | null | undefined): boolean =>
  typeof url === 'string' &&
  !isMissingAttachment(url) &&
  isPicture(url) &&
  !brokenPreviews.value.has(url);
const attachmentName = (url: string | null | undefined): string =>
  (url ? attachmentMeta.value.get(url)?.filename : null) ??
  t('chat.attachments.unnamedFile');
const attachmentSize = (url: string | null | undefined): string => {
  const meta = url ? attachmentMeta.value.get(url) : undefined;
  return meta ? formatByteSize(meta.sizeBytes) : '';
};

// One download path for every chip, in the bubble and in the composer alike:
// the click goes through `apiDownload`, which carries auth (multiuser), honours
// the server's Content-Disposition filename and — the reason it is here (#127)
// — TURNS A FAILURE INTO A TOAST. A bare `<a download>` saves whatever comes
// back, so a deleted attachment used to arrive on disk as a .json error body.
// The element stays a real link so "open in new tab" and "save link as" work.
//
// A `data:` URL is left to the browser: it is the composer's own bytes, there
// is nothing to fetch and no request that could fail.
const downloadAttachment = async (
  url: string,
  event: MouseEvent,
): Promise<void> => {
  if (url.startsWith('data:')) return;
  event.preventDefault();
  try {
    await apiDownload(url, {}, attachmentName(url));
  } catch {
    toast.error(t('chat.attachments.downloadError'));
  }
};

// Last-resort fallback: a picture the browser cannot decode after all becomes a
// file chip too.
const brokenPreviews = ref(new Set<string>());
const onPreviewError = (url: string): void => {
  brokenPreviews.value = new Set(brokenPreviews.value).add(url);
};

// One place where a candidate is judged, so a drop, a paste and a picked file
// all give the same answer in the same words. UX only — `sendMessage`
// re-validates server-side against the ruleset of the connection that will
// actually run the turn.
const attachmentRules = useAttachmentRulesStore();
const rejectionMessage = (rejection: AttachmentRejection): string => {
  const filename = rejection.filename || t('chat.attachments.unnamedFile');
  // The numbers are formatted by the contract, the same call the server's
  // refusal makes — the sentence differs per tier, the sizes inside it must not.
  return t(
    rejection.reason === 'format'
      ? 'chat.attachments.rejected.format'
      : 'chat.attachments.rejected.size',
    attachmentRejectionParams(rejection, filename),
  );
};

// Attaches everything that passes and reports, in ONE toast, everything that
// does not — a drop of ten files must not raise ten toasts, and one bad file
// must not discard the nine good ones.
const attachCandidates = (
  candidates: { url: string; meta: InternalDragFile }[],
): void => {
  const refused: string[] = [];
  for (const { url, meta } of candidates) {
    const rejection = attachmentRules.check(meta);
    if (rejection) {
      refused.push(rejectionMessage(rejection));
      continue;
    }
    attachmentMeta.value.set(url, meta);
    if (!attachedFiles.value.includes(url)) attachedFiles.value.push(url);
  }
  if (refused.length > 0) {
    toast.error(
      `${refused.join('\n')}\n${t('chat.attachments.rejected.hint')}`,
    );
  }
};

const describeLocalFile = (file: File, url: string): InternalDragFile => ({
  url,
  mimeType: file.type,
  filename: file.name,
  isImage: file.type.startsWith('image/'),
  sizeBytes: file.size,
});

const onImageSelected = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const url = await readAsDataUrl(file);
    attachCandidates([{ url, meta: describeLocalFile(file, url) }]);
  } catch {
    // Ignore a single failed decode; keep any already-attached images.
  }
};

// Keep only scalar, non-empty string values — route params/query may hold arrays
// or nulls, which carry no useful identifier and are dropped from the context.
const toStringRecord = (
  source: Record<string, unknown>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
};

// Snapshot where the user is (route-driven, §5.3) so the agent can resolve
// deictic references against the current screen. Identifiers only — issue #3.
const pageContextSummary = usePageContextSummary();
const pageContextRefs = usePageContextRefs();

// What the assistant is currently working on (#129).
//
// Not a file detail: the context is what the chat ANSWERS about — the project
// whose data reaches the prompt, the object "this" and "here" resolve to, and,
// as one consequence among several, where an upload is filed (#125). None of it
// was stated anywhere, so a user had to infer it from the page behind the panel.
//
// Declared after `pageContextRefs` because the watcher below is immediate and
// would otherwise read it in its temporal dead zone.
//
// Resolved by the server, never re-derived here: `/api/chat/context` runs the
// same rules the turn itself runs — the `page → sticky` project rule that scopes
// the turn, the owning plugin's own resolver for naming the page object, and the
// owner lookup that decides who takes a file. A copy of any of them in the
// browser would be free to drift from the code that acts, hence the shared
// `ResolvedChatContext` rather than a local twin.
const chatContext = ref<ResolvedChatContext>({
  project: null,
  page: null,
  filing: null,
});
// Guards against a slow answer for a page the user has already left: only the
// newest request may write.
let chatContextRequest = 0;
const refreshChatContext = async (): Promise<void> => {
  const ticket = ++chatContextRequest;
  const params = new URLSearchParams();
  // The scope the next turn would run in, asked about as it stands right now
  // (#130) — the session says nothing about it any more.
  if (chatStore.projectId) params.set('projectId', chatStore.projectId);
  const refs = pageContextRefs.value ?? [];
  if (refs.length) params.set('refs', refs.join(','));
  try {
    const res = await apiFetch(`/api/chat/context?${params}`);
    if (!res.ok) return;
    const context: unknown = await res.json();
    // Checked, not asserted (§5.1): an answer that isn't the shape leaves the
    // previous one standing, like a failed request below.
    if (!isResolvedChatContext(context)) return;
    if (ticket !== chatContextRequest) return;
    chatContext.value = context;
    // The answer is also the verdict on the scope we sent: a project the server
    // would not name back is gone, and the store drops it (#130). Guarded by the
    // same ticket as the line itself, so a reply that predates a just-made pick
    // cannot clear it.
    chatStore.reconcileProject(context.project);
  } catch {
    // A failed lookup leaves the previous answer standing rather than claiming
    // there is no context — the panel must not state the reassuring thing when
    // it does not know.
  }
};
// Follows navigation without a reload (the refs are published by the view on
// screen) and follows switching to another chat. Asked only while the panel is
// open: with the assistant closed there is nothing to describe.
watch(
  [
    () => chatStore.sessionId,
    () => chatStore.projectId,
    pageContextRefs,
    isChatOpen,
    chatEnabled,
    canUseAuthedApi,
  ],
  () => {
    if (isChatOpen.value && chatEnabled.value && canUseAuthedApi.value) {
      void refreshChatContext();
    }
  },
  { immediate: true, deep: true },
);

// Walking onto a project's page makes it the assistant's scope (#130). The
// store knows nothing about routes, so the shell hands it the project the open
// view published — the same channel the prompt and the context line read, which
// is why a screen with a project ORef needs nothing else to be understood.
// Leaving that page does NOT clear it: the scope is sticky by design, and the
// line says which one is in force wherever the user goes next.
watch(
  currentProjectId,
  (id) => {
    if (id) chatStore.visitProject(id);
  },
  { immediate: true },
);

// The projects the scope can be switched to, from the line itself. Loaded when
// the panel opens rather than at boot: the shell must not fetch before login
// (§5.8), and a closed assistant needs no list.
type ChatProjectOption = { id: string; title: string };
// Checked, not asserted (§5.1) — the same discipline the context answer above
// gets: an answer that isn't the shape leaves the previous options standing
// rather than filling the picker with `undefined` labels.
const isChatProjectList = (value: unknown): value is ChatProjectOption[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    return (
      'id' in item &&
      typeof item.id === 'string' &&
      'title' in item &&
      typeof item.title === 'string'
    );
  });
const chatProjects = ref<ChatProjectOption[]>([]);
const loadChatProjects = async (): Promise<void> => {
  try {
    const res = await apiFetch('/api/projects');
    if (!res.ok) return;
    const list: unknown = await res.json();
    if (isChatProjectList(list)) chatProjects.value = list;
  } catch {
    // A missing list only costs the switcher its options; the line still states
    // the scope, which is resolved server-side.
  }
};
// Immediate, and gated on being logged in: the panel starts OPEN and
// `isEnabled` answers true before the plugin list has even arrived, so both
// values are already final at setup and a change-only watcher would never fire
// once — leaving the picker with nothing in it but "No project".
watch(
  [isChatOpen, chatEnabled, canUseAuthedApi],
  () => {
    if (isChatOpen.value && chatEnabled.value && canUseAuthedApi.value) {
      void loadChatProjects();
    }
  },
  { immediate: true },
);

// "No project" is a real absence, not a place, so it carries `empty: true` and
// is worded as one (§5.4).
const chatProjectOptions = computed(() => [
  { value: null, label: t('chat.context.noProject'), empty: true },
  ...chatProjects.value.map((project) => ({
    value: project.id,
    label: project.title,
  })),
]);

// The object half of the line: what the screen published, with its breadcrumb.
// Absent on a screen that publishes nothing, which is most of them.
const chatContextPageLabel = computed<string | null>(() => {
  const page = chatContext.value.page;
  if (!page) return null;
  return page.breadcrumb
    ? t('chat.context.pageWithin', {
        object: page.name,
        within: page.breadcrumb,
      })
    : page.name;
});

// Where an attached file would go, stated only while one is attached (#130).
// Silent otherwise: a permanent line about files on a panel with no file is
// noise, and the moment it matters is the moment before sending.
const chatFilingLabel = computed<string | null>(() => {
  if (!attachedFiles.value.length) return null;
  const filing = chatContext.value.filing;
  return filing
    ? t('chat.context.filingInto', { target: filing.name })
    : t('chat.context.filingNowhere');
});
const collectPageContext = (): PageContext => {
  const params = toStringRecord(route.params);
  const query = toStringRecord(route.query);
  const context: PageContext = {
    routeName: typeof route.name === 'string' ? route.name : undefined,
    path: route.path,
    pluginId:
      typeof route.meta.pluginId === 'string' ? route.meta.pluginId : undefined,
  };
  if (Object.keys(params).length) context.params = params;
  if (Object.keys(query).length) context.query = query;
  // Precise, view-supplied selection description (e.g. the open storage cell) that
  // the route ids can't express — see PageContext.summary.
  if (pageContextSummary.value) context.summary = pageContextSummary.value;
  // Machine-parseable counterpart: the same selection as canonical ORef(s) (#16).
  if (pageContextRefs.value) context.refs = pageContextRefs.value;
  // Bundle-freshness stamp (#15): if this debug line is missing from the browser
  // console when a message is sent, the tab runs a STALE bundle — hard-reload it.
  console.debug('[chat] pageContext v3', JSON.stringify(context));
  return context;
};

const sendMessage = (): void => {
  const text = chatInput.value;
  const images = attachedFiles.value;
  if (!text.trim() && !images.length) return;
  chatInput.value = '';
  attachedFiles.value = [];
  historyPos.value = null;
  historyDraft.value = '';
  nextTick(autoGrowInput);
  chatStore.sendMessage(text, images, collectPageContext());
};

const applyRecall = (value: string): void => {
  chatInput.value = value;
  nextTick(() => {
    const el = chatInputRef.value;
    if (el) el.selectionStart = el.selectionEnd = el.value.length;
    autoGrowInput();
  });
};

const recallPrev = (): boolean => {
  const hist = chatStore.inputHistory;
  if (!hist.length) return false;
  if (historyPos.value === null) {
    historyDraft.value = chatInput.value;
    historyPos.value = hist.length - 1;
  } else if (historyPos.value > 0) {
    historyPos.value -= 1;
  }
  applyRecall(hist[historyPos.value]);
  return true;
};

const recallNext = (): boolean => {
  if (historyPos.value === null) return false;
  const hist = chatStore.inputHistory;
  if (historyPos.value < hist.length - 1) {
    historyPos.value += 1;
    applyRecall(hist[historyPos.value]);
  } else {
    historyPos.value = null;
    applyRecall(historyDraft.value);
  }
  return true;
};

const onComposerKeydown = (e: KeyboardEvent): void => {
  const el = e.target as HTMLTextAreaElement;
  // Enter sends; Shift+Enter inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
    return;
  }
  // Up on the first line / Down on the last line recalls sent messages.
  const caretOnFirstLine =
    el.value.slice(0, el.selectionStart).indexOf('\n') === -1;
  const caretOnLastLine = el.value.slice(el.selectionEnd).indexOf('\n') === -1;
  if (e.key === 'ArrowUp' && caretOnFirstLine) {
    if (recallPrev()) e.preventDefault();
    return;
  }
  if (e.key === 'ArrowDown' && caretOnLastLine) {
    if (recallNext()) e.preventDefault();
    return;
  }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') historyPos.value = null;
};

// --- Multi-chat switcher ---
const showSessions = ref(false);

const startNewChat = (): void => {
  chatStore.newChat();
  showSessions.value = false;
};

const pickSession = (id: string): void => {
  chatStore.selectSession(id);
  showSessions.value = false;
};

const removeSession = async (id: string): Promise<void> => {
  const ok = await confirm({
    message: t('chat.deleteChatConfirm'),
    tone: 'danger',
  });
  if (!ok) return;
  chatStore.deleteSession(id);
};

const formatSessionTime = (iso: string): string =>
  new Date(iso).toLocaleString(locale.value, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const confirmTool = (msg: ChatMessage): void => {
  chatStore.confirmTool(msg);
};

const cancelTool = (msg: ChatMessage): void => {
  chatStore.cancelTool(msg);
};

const retry = (msg: ChatMessage): void => {
  chatStore.retryLastTurn(msg);
};
</script>

<template>
  <!-- App-wide notification + confirmation surfaces (teleport to body). -->
  <ToastViewport />
  <ConfirmDialog />
  <!-- Full-screen lock shown whenever the backend is unreachable (#64). -->
  <OfflineOverlay />
  <!-- Fullscreen effect while the multiuser plugin itself is being toggled. -->
  <ModeTransitionOverlay />

  <!-- Phone capture page: bare, no desktop shell. The route picks this branch;
       the inner view is held back until the backend is confirmed live so it
       never mounts against a still-booting API and renders empty (#64) — the
       offline overlay covers the gap meanwhile. -->
  <template v-if="isFullscreenRoute">
    <RouterView v-if="contentReady" />
  </template>

  <div
    v-else
    class="flex h-screen overflow-hidden bg-slate-50 text-slate-800 dark:bg-dark-950 dark:text-slate-100 transition-colors duration-300"
  >
    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex flex-col transition-all duration-300 ease-in-out border-r border-slate-200/50 dark:border-white/5 glass"
      :class="[isSidebarOpen ? 'w-64' : 'w-20']"
    >
      <!-- Brand Logo Header. Collapsed, the 80px rail cannot hold the mark and
           the burger side by side, so the mark leaves the flow and the burger
           becomes the whole header — and it is the control that brings the rail
           back, so it is shown at every width in that state. The collapsed
           padding keeps the burger the same distance from the right edge, so it
           glides with the rail instead of teleporting to its new slot. -->
      <div
        class="flex items-center h-16 border-b border-slate-200/50 dark:border-white/5"
        :class="[isSidebarOpen ? 'justify-between px-4' : 'justify-end px-6']"
      >
        <div
          v-if="isSidebarOpen"
          class="flex items-center gap-3 overflow-hidden"
        >
          <BrandMark size="md" />
          <div class="flex flex-col overflow-hidden">
            <span
              class="text-lg font-bold leading-tight tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-slate-200 dark:to-slate-400"
            >
              {{ t('common.appName') }}
            </span>
          </div>
        </div>
        <button
          @click="prefs.toggleSidebar()"
          :aria-label="
            isSidebarOpen
              ? t('header.collapseSidebar')
              : t('header.expandSidebar')
          "
          class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          :class="[isSidebarOpen ? 'hidden md:block' : 'block']"
        >
          <Menu class="w-5 h-5" />
        </button>
      </div>

      <!-- Navigation Links -->
      <!-- The gutters are the same in both states on purpose: 16px (nav) + 12px
           (item) + 1px border puts the 20px icon in the middle of the 80px
           collapsed rail, so the icon column does not shift while the rail
           animates its width. Centring the item instead would teleport the icon
           to the middle of the still-expanded rail on the first frame. -->
      <!-- Collapsed, the icon is the only thing left of the entry, so the name
           is carried by the app's own Tooltip beside it rather than by the
           browser's `title` (slow, unstyled, and nothing like the rest of the
           UI). It stands in for the label the rail is not showing, so it is set
           in that label's `text-sm`. Expanded, the text is `''` — the primitive
           then renders nothing, and the name is already on screen anyway.
           `display="contents"` keeps the link itself the flex child, so the
           `gap` between entries is unchanged (a wrapper with a box would take
           the spacing instead — and `space-y` would have applied its margin to
           a box-less wrapper, i.e. to nothing). -->
      <nav
        class="flex flex-col flex-1 px-4 py-4 gap-1.5 overflow-y-auto overflow-x-hidden"
      >
        <!-- One entry, plus the runtime sub-items a plugin may provide for it
             (#288). The chevron is a sibling of the link, never nested inside
             it: a button inside an anchor is invalid markup and swallows the
             link's own activation. -->
        <div
          v-for="item in mainNav"
          :key="item.path"
          class="flex flex-col gap-1"
        >
          <!-- The active/hover treatment sits on the ROW, not on the link: the
               chevron is a sibling (a button inside an anchor is invalid markup
               and swallows the link's activation), so a highlight painted on the
               link alone would stop short of the chevron and cut the entry in
               half. -->
          <div
            class="group flex items-center rounded-xl border transition-all duration-200"
            :class="[
              isNavActive(item.path)
                ? 'bg-brand-500/10 border-brand-500/20 font-medium'
                : 'border-transparent hover:bg-slate-100 dark:hover:bg-white/5',
            ]"
          >
            <Tooltip
              display="contents"
              placement="right"
              size="sm"
              :text="isSidebarOpen ? '' : $t(item.titleKey)"
            >
              <RouterLink
                :to="item.path"
                :aria-label="isSidebarOpen ? undefined : $t(item.titleKey)"
                class="relative flex flex-1 min-w-0 items-center gap-3 px-3 py-2.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                :class="[
                  isNavActive(item.path)
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white',
                ]"
              >
                <component
                  :is="resolveIcon(item.icon)"
                  class="w-5 h-5 transition-transform duration-300 group-hover:scale-110 shrink-0"
                  :class="[
                    isNavActive(item.path)
                      ? 'text-brand-500 dark:text-brand-400'
                      : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white',
                  ]"
                />
                <span v-if="isSidebarOpen" class="text-sm whitespace-nowrap">
                  {{ $t(item.titleKey) }}
                </span>
                <Badge
                  v-if="isSidebarOpen && navBadgeOf(item) > 0"
                  tone="brand"
                  class="ml-auto shrink-0"
                  >{{ navBadgeOf(item) }}</Badge
                >
                <!-- `role="img"`, or the label is dropped: an `aria-label` on a
                     generic with no role is ignored, and the one thing this dot
                     exists to say goes only to people who can see it. -->
                <span
                  v-else-if="navBadgeOf(item) > 0"
                  class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-500"
                  role="img"
                  :aria-label="$t('nav.hasNewItems')"
                />
              </RouterLink>
            </Tooltip>
            <Button
              v-if="hasNavChildren(item)"
              variant="ghost"
              size="icon-sm"
              class="mr-1 shrink-0"
              :aria-expanded="isNavExpanded(item)"
              :aria-label="
                $t(
                  isNavExpanded(item)
                    ? 'nav.collapseSection'
                    : 'nav.expandSection',
                  { section: $t(item.titleKey) },
                )
              "
              @click="toggleNavExpanded(item)"
            >
              <ChevronDown
                class="w-4 h-4 transition-transform duration-200"
                :class="isNavExpanded(item) ? '' : '-rotate-90'"
              />
            </Button>
          </div>
          <!-- Indented one level, against a guide rail that runs under the
               parent's icon. The rail lives on each ROW, not on the container:
               the active child then paints its own segment of it in the accent,
               which is what turns a line beside the list into a "you are here"
               track — the pattern every docs/panel sidebar uses. Rows sit flush
               (no gap) so the rail reads continuous, and only the right corners
               are rounded, or the border would break at every row. -->
          <div
            v-if="hasNavChildren(item) && isNavExpanded(item)"
            class="flex flex-col ml-6 pr-1"
          >
            <RouterLink
              v-for="child in navChildrenOf(item)"
              :key="child.id"
              :to="child.path"
              class="truncate border-l-2 rounded-r-xl pl-5 pr-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              :class="[
                isNavChildActive(child)
                  ? 'border-brand-500 dark:border-brand-400 bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium'
                  : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5',
              ]"
            >
              {{ child.label }}
            </RouterLink>
          </div>
        </div>
      </nav>

      <!-- Sidebar Footer (system nav — settings, agent capabilities) -->
      <div
        v-if="systemNav.length"
        class="flex flex-col px-4 py-3 border-t border-slate-200/50 dark:border-white/5 gap-1.5 overflow-x-hidden"
      >
        <Tooltip
          v-for="item in systemNav"
          :key="item.path"
          display="contents"
          placement="right"
          size="sm"
          :text="isSidebarOpen ? '' : $t(item.titleKey)"
        >
          <RouterLink
            :to="item.path"
            :aria-label="isSidebarOpen ? undefined : $t(item.titleKey)"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5"
            :class="[
              isNavActive(item.path)
                ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20'
                : 'border border-transparent',
            ]"
          >
            <component :is="resolveIcon(item.icon)" class="w-5 h-5 shrink-0" />
            <span v-if="isSidebarOpen" class="text-sm whitespace-nowrap">
              {{ $t(item.titleKey) }}
            </span>
          </RouterLink>
        </Tooltip>
      </div>

      <!-- Version + update badge — the last thing in the sidebar. Collapsed, the
           new-version number is `sr-only` and only the amber dot remains, so the
           same tooltip that names the nav entries says what the dot means. -->
      <Tooltip
        v-if="versionStore.version"
        display="contents"
        placement="right"
        size="sm"
        :text="versionStore.updateAvailable ? t('common.updateAvailable') : ''"
      >
        <RouterLink
          :to="{ name: 'settings-updates' }"
          class="flex items-center justify-center gap-1.5 py-2.5 border-t border-slate-200/50 dark:border-white/5 px-3 text-xxs whitespace-nowrap overflow-hidden transition-colors hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        >
          <span class="text-slate-400 dark:text-slate-500">
            v{{ versionStore.version }}
          </span>
          <span
            v-if="versionStore.updateAvailable"
            class="font-bold text-amber-500 text-glow-amber"
            :class="[isSidebarOpen ? '' : 'sr-only']"
          >
            ({{ versionStore.latestVersion }})
          </span>
          <span
            v-if="versionStore.updateAvailable && !isSidebarOpen"
            aria-hidden="true"
            class="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-lg shadow-amber-500/40"
          ></span>
        </RouterLink>
      </Tooltip>
    </aside>

    <!-- Main Container -->
    <div
      class="flex flex-col flex-1 min-w-0 min-h-screen"
      :class="[
        isSidebarOpen ? 'pl-64' : 'pl-20',
        isChatResizing ? '' : 'transition-all duration-300 ease-in-out',
      ]"
      :style="{
        paddingRight: isChatOpen && chatEnabled ? `${chatWidth}px` : '0px',
      }"
    >
      <!-- Top Header -->
      <header
        class="flex items-center justify-between h-16 px-6 glass-header sticky top-0 z-30"
      >
        <div class="flex items-center gap-4 min-w-0">
          <button
            @click="prefs.toggleSidebar()"
            :aria-label="
              isSidebarOpen
                ? t('header.collapseSidebar')
                : t('header.expandSidebar')
            "
            class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Menu class="w-5 h-5" />
          </button>
          <!-- Truncates rather than wrapping: a two-line title is what pushed
               the whole row past the header's height before #274. -->
          <h1
            class="text-lg font-semibold tracking-wide text-slate-900 dark:text-white truncate"
          >
            {{ getHeaderTitle }}
          </h1>
        </div>

        <!-- Priority overflow (#274): whatever no longer fits moves into the
             row's own «more» panel, in the order declared by HEADER_PRIORITY.
             Nothing here is breakpoint-driven — plugins contribute controls the
             shell has never seen, so only measurement can be correct. -->
        <HeaderOverflowRow ref="headerRow">
          <!-- The plugin-facing slots, one flat list off the HEADER_SLOTS
               table (#277): search (each contribution its own full-width menu
               row), then scan — where every contribution is its own overflow
               unit (the codes scan button #74, the mobile pairing QR #197).
               One shared HeaderItem per slot once fused scan and phone
               pairing into a single menu row, which read as one feature. -->
          <HeaderItem
            v-for="item in headerSlotItems"
            :id="item.id"
            :key="item.id"
            :priority="item.priority"
            :label="item.label"
            :panel-order="item.panelOrder"
            :panel-full="item.panelFull"
          >
            <component :is="item.component" />
          </HeaderItem>

          <!-- Simple/Advanced UX mode: a labelled segmented control so the
               current mode is always readable, not inferable from an icon.
               "Pro" lights up amber so the power mode is visually distinct
               from the brand-tinted "Simple". Rendered only while the uxmode
               plugin is enabled (its i18n also comes from that plugin). -->
          <HeaderItem
            v-if="uxModeEnabled"
            id="uxmode"
            :priority="HEADER_PRIORITY.uxMode"
            :label="$t('uxmode.header.group')"
            :panel-order="panelOrderFor(3, 0)"
          >
            <div
              role="group"
              :aria-label="$t('uxmode.header.group')"
              class="flex items-center h-9 p-1 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/60 dark:bg-white/5"
            >
              <button
                type="button"
                :aria-pressed="prefs.uxMode === 'simple'"
                :title="$t('uxmode.header.simpleTitle')"
                class="px-2.5 h-7 rounded-lg text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                :class="[
                  prefs.uxMode === 'simple'
                    ? 'bg-white dark:bg-white/10 text-brand-600 dark:text-brand-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                ]"
                @click="prefs.setMode('simple')"
              >
                <span class="flex items-center gap-1">
                  <Feather class="w-3.5 h-3.5" />
                  {{ $t('uxmode.header.simpleLabel') }}
                </span>
              </button>
              <button
                type="button"
                :aria-pressed="prefs.uxMode === 'advanced'"
                :title="$t('uxmode.header.advancedTitle')"
                class="px-2.5 h-7 rounded-lg text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                :class="[
                  prefs.uxMode === 'advanced'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                ]"
                @click="prefs.setMode('advanced')"
              >
                <span class="flex items-center gap-1">
                  <Zap class="w-3.5 h-3.5" />
                  {{ $t('uxmode.header.advancedLabel') }}
                </span>
              </button>
            </div>
          </HeaderItem>

          <!-- Language Selector Selectbox -->
          <HeaderItem
            id="language"
            :priority="HEADER_PRIORITY.language"
            :label="$t('header.language')"
            :panel-order="panelOrderFor(4, 0)"
          >
            <div class="w-20">
              <Select
                v-model="currentLanguage"
                :options="languageOptions"
                @change="handleLanguageChange"
                triggerClass="px-2 py-1.5 h-9 bg-slate-100/60 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 !rounded-xl text-xs font-semibold"
              />
            </div>
          </HeaderItem>

          <!-- Colour scheme picker (#236): between language and theme, since it
               is the third appearance control of the same header family. -->
          <HeaderItem
            id="scheme"
            :priority="HEADER_PRIORITY.scheme"
            :label="$t('header.scheme.choose')"
            :panel-order="panelOrderFor(5, 0)"
          >
            <Select
              :model-value="prefs.colorScheme"
              :options="schemeOptions"
              :aria-label="$t('header.scheme.choose')"
              :searchable="false"
              custom-trigger
              align="end"
              trigger-class="w-9 h-9 !justify-center rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/60 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              dropdown-class="w-48"
              @change="pickScheme"
              @highlight="previewScheme"
            >
              <template #trigger>
                <Palette class="w-4 h-4" />
              </template>
              <template #option="{ option }">
                <span class="flex min-w-0 items-center gap-2.5">
                  <!-- The swatch carries the scheme's own data-scheme, so the
                       brand/dark tokens inside preview THAT scheme (themes.css
                       re-scopes the variables), not the active one. -->
                  <span
                    :data-scheme="option.value"
                    class="flex shrink-0"
                    aria-hidden="true"
                  >
                    <i class="w-2.5 h-5 rounded-l-full bg-brand-500"></i>
                    <i
                      class="w-2.5 h-5 rounded-r-full bg-dark-800 border-y border-r border-slate-300/60 dark:border-white/10"
                    ></i>
                  </span>
                  <span class="truncate">{{ option.label }}</span>
                </span>
              </template>
            </Select>
          </HeaderItem>

          <!-- Theme switch: light / dark / system (icon-only in the header) -->
          <HeaderItem
            id="theme"
            :priority="HEADER_PRIORITY.theme"
            :label="$t('header.toggleTheme')"
            :panel-order="panelOrderFor(6, 0)"
          >
            <SegmentedControl
              v-model="themeMode"
              :options="themeOptions"
              :aria-label="$t('header.toggleTheme')"
              icon-only
            />
          </HeaderItem>

          <!-- Toggle AI Assistant Button (only when the chat plugin is enabled).
               Its priority is the one that depends on state: with the chat panel
               already open this button duplicates what the user is looking at,
               so it is the first control to give way. Closed, it outlives every
               other control — and gives up its label before its place. -->
          <HeaderItem
            v-if="chatEnabled"
            id="ai"
            :priority="aiButtonPriority"
            :label="$t('header.aiAssistant')"
            :panel-order="panelOrderFor(7, 0)"
            v-slot="{ compact, collapsed }"
          >
            <button
              @click="isChatOpen = !isChatOpen"
              :aria-label="$t('header.aiAssistant')"
              class="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 transition-all duration-300 shadow-md"
              :class="[
                isChatOpen
                  ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 shadow-brand-500/5'
                  : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10',
              ]"
            >
              <Bot class="w-5 h-5" :class="{ 'animate-bounce': !isChatOpen }" />
              <!-- Inside the panel the row already carries the name, so the
                   button drops its own label there too rather than saying it
                   twice. -->
              <span
                v-show="!compact && !collapsed"
                data-compact-drop
                class="text-sm font-medium whitespace-nowrap"
                >{{ $t('header.aiAssistant') }}</span
              >
            </button>
          </HeaderItem>

          <!-- The row's fixed terminal: the avatar. Never collapses, never
               yields its place — and hosts the collapsed controls in its menu,
               in a section above workspaces (multiuser) or as the menu's only
               content (single-user). -->
          <template #trailing>
            <HeaderItem id="user" :priority="HEADER_PRIORITY.userMenu">
              <!-- The shell owns the affordance, not the menus: the counter
                   badge (and its one-time coachmark) overlays whichever avatar
                   is rendered, so neither menu component knows it exists. -->
              <div class="relative">
                <UserMenu
                  v-if="
                    sessionStore.multiuserEnabled &&
                    sessionStore.isAuthenticated
                  "
                >
                  <template #extra>
                    <HeaderOverflowSection />
                  </template>
                </UserMenu>
                <HeaderAvatarMenu v-else />
                <HeaderOverflowBadge />
              </div>
            </HeaderItem>
          </template>
        </HeaderOverflowRow>
      </header>

      <!-- Main Content Area. Gated on the first confirmed-live backend so a
           view never mounts against a still-booting API and shows empty (#64).
           This is a first-mount gate only — once shown the view stays mounted
           across any later outage, so a mid-session reconnect never remounts it
           and never discards in-progress edits. -->
      <main class="flex-1 min-w-0 p-6 md:p-8 overflow-y-auto w-full mx-auto">
        <RouterView v-if="contentReady" />
      </main>
    </div>

    <!-- The chat column's splitter (#283). It rides on the seam rather than
         inside the panel, because the panel clips its own overflow (the drop
         overlay) and would cut the grab band in half; and it exists only while
         the panel is open, so a closed panel leaves nothing to tab into. The
         wrapper is a zero-width anchor at the seam — the handle centres itself
         on it. It takes the panel's drop handlers because it now covers the
         panel's first 8px: without them, a file let go on the seam would be
         opened by the browser instead of attached (#112, #121). Its `right`
         eases exactly like the panel's width, or the seam would arrive at the
         new position ahead of the edge it draws. -->
    <div
      v-if="chatEnabled && isChatOpen"
      class="fixed inset-y-0 z-splitter w-0"
      :class="
        isChatResizing ? '' : 'transition-[right] duration-300 ease-in-out'
      "
      :style="{ right: `${chatWidth}px` }"
      v-bind="chatDropHandlers"
    >
      <ResizeHandle
        :size="chatWidth"
        :min="CHAT_WIDTH_MIN"
        :max="prefs.chatWidthMax"
        :reset-to="CHAT_WIDTH_DEFAULT"
        :label="$t('chat.resizeColumn')"
        edge="left"
        @update:size="prefs.setChatWidth($event)"
        @update:active="isChatResizing = $event"
      />
    </div>

    <!-- AI Chat Panel (only when the chat plugin is enabled). The whole column is
         a drop zone — dragging a file anywhere over it attaches to the message. -->
    <aside
      v-if="chatEnabled"
      class="fixed inset-y-0 right-0 z-40 flex flex-col overflow-x-hidden border-l border-slate-200/50 dark:border-white/5 glass"
      :class="[
        isChatOpen ? 'translate-x-0' : 'translate-x-full',
        // The width eases with the reservation on the other side (the content
        // area's padding), so a keyboard nudge, a reset or the viewport clamp
        // move both edges together; only the drag itself drops the ease, where
        // a 300ms transition on a per-frame value drags the panel behind the
        // pointer.
        isChatResizing
          ? ''
          : 'transition-[transform,width] duration-300 ease-in-out',
      ]"
      :style="{ width: `${chatWidth}px` }"
      v-bind="chatDropHandlers"
    >
      <!-- Drop overlay covering the whole chat column -->
      <div
        v-if="isChatDragging"
        class="absolute inset-0 z-50 flex items-center justify-center bg-brand-500/10 border-2 border-dashed border-brand-500/60 pointer-events-none"
      >
        <span
          class="relative flex items-center gap-2 px-6 py-3 text-sm font-semibold text-brand-600 dark:text-brand-400"
        >
          <!-- Soft readability haze (shared `.drop-hint-haze` helper) -->
          <span
            aria-hidden="true"
            class="absolute -inset-4 rounded-full drop-hint-haze"
          />
          <Paperclip class="relative w-5 h-5" />
          <span class="relative">{{ $t('chat.dropToAttach') }}</span>
        </span>
      </div>

      <!-- Chat Header -->
      <div class="relative border-b border-slate-200/50 dark:border-white/5">
        <div class="flex items-center justify-between h-16 px-4">
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
            >
              <Bot class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <h2
                class="text-sm font-semibold text-slate-900 dark:text-white leading-tight"
              >
                {{ $t('chat.title') }}
              </h2>
              <span
                class="text-xxs flex items-center gap-1.5"
                :class="chatStatusColor"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :class="[
                    chatStatusDot,
                    chatStore.connectionStatus === 'checking'
                      ? 'animate-pulse'
                      : '',
                  ]"
                ></span>
                <span class="truncate">{{ chatStatusText }}</span>
              </span>
            </div>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              @click="startNewChat"
              :title="$t('chat.newChat')"
              class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              <Plus class="w-5 h-5" />
            </button>
            <button
              @click="showSessions = !showSessions"
              :title="$t('chat.history')"
              class="p-1.5 rounded-lg transition-colors"
              :class="
                showSessions
                  ? 'bg-slate-100 dark:bg-white/5 text-brand-600 dark:text-brand-400'
                  : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              "
            >
              <History class="w-5 h-5" />
            </button>
            <button
              @click="isChatOpen = false"
              :title="$t('header.aiAssistant')"
              class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- Chat switcher dropdown -->
        <div
          v-if="showSessions"
          class="fixed inset-0 z-40"
          @click="showSessions = false"
        ></div>
        <div
          v-if="showSessions"
          class="absolute right-3 top-[3.75rem] z-50 w-80 max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 glass shadow-xl p-1.5"
        >
          <p
            v-if="!chatStore.sessions.length"
            class="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 text-center"
          >
            {{ $t('chat.noSessions') }}
          </p>
          <div
            v-for="s in chatStore.sessions"
            :key="s.id"
            @click="pickSession(s.id)"
            class="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            :class="s.id === chatStore.sessionId ? 'bg-brand-500/10' : ''"
          >
            <MessageSquare
              class="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p
                class="text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
              >
                {{ s.title || $t('chat.untitled') }}
              </p>
              <!-- The list is one flat set of conversations since #130 (a chat
                   belongs to nobody's project), so the row carries the project
                   of its latest turn — otherwise two chats started with the
                   same question are indistinguishable. `Badge variant="label"`
                   is the chip that holds an object's OWN text and survives
                   wrapping (§5.4). -->
              <div class="flex items-center gap-1.5 min-w-0">
                <p class="text-xxs text-slate-400 dark:text-slate-500 shrink-0">
                  {{ formatSessionTime(s.createdAt) }}
                </p>
                <Badge
                  v-if="s.project"
                  variant="label"
                  class="min-w-0 truncate"
                  >{{ s.project.name }}</Badge
                >
              </div>
            </div>
            <button
              @click.stop="removeSession(s.id)"
              :title="$t('chat.deleteChat')"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-all shrink-0"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Messages Log -->
      <div
        ref="messagesRef"
        class="flex-1 p-4 overflow-y-auto overflow-x-hidden space-y-4"
      >
        <div
          v-for="msg in visibleMessages"
          :key="msg.id"
          class="flex flex-col"
          :class="[msg.role === 'user' ? 'items-end' : 'items-start']"
        >
          <!-- Tool Confirmation Card -->
          <template v-if="msg.toolCall?.type === 'tool_call_pending'">
            <div
              class="w-full max-w-[90%] rounded-2xl border border-amber-400/30 bg-amber-50/80 dark:bg-amber-500/10 p-4 space-y-3"
            >
              <div class="flex items-start gap-2">
                <ShieldAlert
                  class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                />
                <div class="space-y-0.5 min-w-0">
                  <p
                    class="text-xs font-bold text-amber-800 dark:text-amber-300"
                  >
                    {{ t('agent.permissionRequest') }}
                  </p>
                  <!-- Prefer the tool's resolved, localized sentence (ids → real
                       names); fall back to the method name + raw args only when a
                       tool ships no summary. -->
                  <p
                    v-if="msg.toolCall.summary"
                    class="text-xs text-amber-800 dark:text-amber-200 break-words"
                  >
                    {{
                      t(
                        msg.toolCall.summary.key,
                        msg.toolCall.summary.params ?? {},
                      )
                    }}
                  </p>
                  <template v-else>
                    <p
                      class="text-xxs text-amber-700 dark:text-amber-400 font-mono break-all"
                    >
                      {{ msg.toolCall.name }}
                    </p>
                    <p
                      class="text-xxs text-amber-600 dark:text-amber-500 break-words"
                    >
                      {{ t('agent.argsLabel') }}
                      {{ JSON.stringify(msg.toolCall.args) }}
                    </p>
                  </template>
                  <!-- Itemized preview (#72): the exact rows the batch write will
                       persist, so a photo-parsed order/receipt is verified line
                       by line rather than trusted as a single count. -->
                  <ul
                    v-if="msg.toolCall.summary?.lines?.length"
                    class="mt-1.5 space-y-0.5"
                  >
                    <li
                      v-for="(line, i) in msg.toolCall.summary.lines"
                      :key="`${line.text}-${i}`"
                      class="flex items-baseline justify-between gap-2 text-xxs text-amber-800 dark:text-amber-200"
                    >
                      <span class="truncate">{{ line.text }}</span>
                      <span
                        v-if="line.qty"
                        class="shrink-0 font-semibold tabular-nums"
                      >
                        {{ t('agent.qtyBadge', { qty: line.qty }) }}
                      </span>
                    </li>
                  </ul>
                  <!-- Provenance note: this data came from recognition, so the
                       user is nudged to verify it before it is written. -->
                  <p
                    v-if="msg.toolCall.recognized"
                    class="flex items-center gap-1 text-xxs text-amber-700 dark:text-amber-400"
                  >
                    <Camera class="w-3 h-3 shrink-0" />
                    {{ t('agent.recognizedHint') }}
                  </p>
                </div>
              </div>
              <!-- pl-6 = icon width (w-4) + gap-2, so the buttons line up with
                   the text column rather than under the shield icon. -->
              <div class="flex items-center gap-2 pl-6">
                <button
                  @click="confirmTool(msg)"
                  :disabled="isSending"
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  <CheckCircle class="w-3.5 h-3.5" />
                  {{ t('agent.allow') }}
                </button>
                <button
                  @click="cancelTool(msg)"
                  :disabled="isSending"
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  <XCircle class="w-3.5 h-3.5" />
                  {{ t('agent.reject') }}
                </button>
              </div>
            </div>
          </template>

          <!-- Tool activity — a compact status chip, never raw tool JSON. -->
          <template
            v-else-if="
              msg.kind === 'tool_response' ||
              msg.kind === 'tool_cancelled' ||
              msg.kind === 'tool_executing'
            "
          >
            <div
              class="self-center max-w-[90%] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xxs bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400"
            >
              <Loader
                v-if="msg.kind === 'tool_executing'"
                class="w-3 h-3 text-brand-500 shrink-0 animate-spin"
              />
              <CheckCircle
                v-else-if="msg.kind === 'tool_response'"
                class="w-3 h-3 text-emerald-500 shrink-0"
              />
              <XCircle v-else class="w-3 h-3 text-red-500 shrink-0" />
              <span class="truncate">{{ toolChipLabel(msg) }}</span>
            </div>
          </template>

          <!-- Regular Message Bubble. Text interpolation escapes any HTML in the
               model output; whitespace-pre-wrap keeps newlines and break-words
               wraps long unbreakable tokens (URLs / JSON) so they can't force
               the panel to scroll horizontally. An attached image renders above
               the text. -->
          <template v-else-if="msg.content || msg.contentKey || msg.image">
            <div
              class="max-w-[85%] min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
              :class="[
                msg.role === 'user'
                  ? 'bg-brand-600 text-white rounded-br-none shadow-md shadow-brand-600/10'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-800 dark:text-slate-200 border border-slate-200/50 dark:border-white/5 rounded-bl-none',
              ]"
            >
              <!-- The attachment is gone (#127): stated up front, and offering
                   nothing to click. Not a link, not a download — the whole bug
                   was that this card stayed live and the browser saved the
                   404's JSON body as a file. -->
              <div
                v-if="msg.image && isMissingAttachment(msg.image)"
                class="flex items-center gap-2 rounded-lg px-3 py-2 border border-dashed"
                :class="[
                  msg.role === 'user'
                    ? 'border-white/25 text-white/70'
                    : 'border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400',
                  msg.content || msg.contentKey ? 'mb-2' : '',
                ]"
              >
                <FileX class="w-4 h-4 shrink-0 opacity-70" />
                <span class="min-w-0 truncate line-through opacity-80">{{
                  missingAttachmentName(msg.image) ??
                  $t('chat.attachments.unnamedFile')
                }}</span>
                <span class="text-xxs shrink-0">{{
                  $t('chat.attachments.unavailable')
                }}</span>
              </div>
              <img
                v-else-if="msg.image && showsPicture(msg.image)"
                :src="previewUrl(msg.image, 'sm')"
                alt=""
                class="rounded-lg max-h-60 max-w-full w-auto"
                :class="{ 'mb-2': msg.content || msg.contentKey }"
                @load="onMessageImageLoad"
                @error="onPreviewError(msg.image)"
              />
              <!-- A non-image attachment is a file card, NOT an <img>: asking
                   for a preview of one falls back to the original server-side,
                   so the browser would pull the whole file down to paint a
                   broken icon. The download link stays on the bare URL — a
                   ?variant= URL serves WebP under a .webp name (#113). -->
              <a
                v-else-if="msg.image"
                :href="msg.image"
                :download="attachmentName(msg.image)"
                :title="$t('chat.attachments.download')"
                @click="downloadAttachment(msg.image, $event)"
                class="flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                :class="[
                  msg.role === 'user'
                    ? 'border-white/20 hover:bg-white/10'
                    : 'border-slate-200 dark:border-white/10 hover:bg-slate-200/50 dark:hover:bg-white/5',
                  msg.content || msg.contentKey ? 'mb-2' : '',
                ]"
              >
                <FileIcon class="w-4 h-4 shrink-0 opacity-70" />
                <span class="min-w-0 truncate">{{
                  attachmentName(msg.image)
                }}</span>
                <span class="text-xxs opacity-70 shrink-0">{{
                  attachmentSize(msg.image)
                }}</span>
                <Download class="w-3.5 h-3.5 shrink-0 opacity-70" />
              </a>
              <!-- Assistant replies are Markdown (rendered safely, no v-html);
                   user messages are shown as the literal text they typed. -->
              <MarkdownMessage
                v-if="
                  (msg.content || msg.contentKey) && msg.role === 'assistant'
                "
                :source="msg.contentKey ? $t(msg.contentKey) : msg.content"
              />
              <template v-else-if="msg.content || msg.contentKey">{{
                msg.contentKey ? $t(msg.contentKey) : msg.content
              }}</template>
            </div>
            <span
              class="text-xxs text-slate-400 dark:text-slate-500 mt-1 px-1"
              >{{ msg.time }}</span
            >
            <!-- Failed agent turn: manual retry + collapsible reason so it's
                 clear what happened and on whose side the failure occurred. -->
            <div
              v-if="msg.canRetry"
              class="mt-1.5 flex flex-col items-start gap-1.5 w-full max-w-[85%]"
            >
              <button
                @click="retry(msg)"
                :disabled="isSending"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                <RotateCcw class="w-3.5 h-3.5" />
                {{ t('agent.retry') }}
              </button>
              <details
                v-if="msg.errorDetail"
                class="w-full text-xxs text-slate-500 dark:text-slate-400"
              >
                <summary
                  class="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300"
                >
                  {{ t('agent.errorDetails') }}
                </summary>
                <pre
                  class="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/10 p-2 font-mono"
                  >{{ msg.errorDetail }}</pre
                >
              </details>
            </div>
          </template>
        </div>

        <!-- Typing indicator -->
        <div v-if="isSending" class="flex items-start">
          <div
            class="rounded-2xl rounded-bl-none px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 flex items-center gap-2"
          >
            <Loader class="w-4 h-4 text-brand-500 animate-spin" />
            <span class="text-xs text-slate-500 dark:text-slate-400">{{
              liveStageText ?? t('agent.thinking')
            }}</span>
          </div>
        </div>
      </div>

      <!-- Chat Input Footer -->
      <div
        class="p-4 border-t border-slate-200/50 dark:border-white/5 bg-slate-50/50 dark:bg-dark-900/40"
      >
        <form @submit.prevent="sendMessage" class="space-y-2">
          <!-- Attached image previews (typed/pasted + phone-capture photos) -->
          <div v-if="attachedFiles.length" class="flex flex-wrap gap-2">
            <div
              v-for="(img, i) in attachedFiles"
              :key="i"
              class="relative inline-block"
            >
              <img
                v-if="isPicture(img) && !brokenPreviews.has(img)"
                :src="previewUrl(img, 'xs')"
                alt=""
                class="h-20 w-20 object-cover rounded-lg border border-slate-200 dark:border-white/10"
                @error="onPreviewError(img)"
              />
              <!-- Metadata, not a failed load, decides this: requesting a
                   preview of a non-image downloads the original (#112). The
                   chip carries the same three things as the one in the history
                   bubble — name, size and a download — so the user can check
                   what they picked up before spending a turn on it. The link
                   stays on the bare URL: a ?variant= URL serves WebP under a
                   .webp name (#113). -->
              <a
                v-else
                :href="img"
                :download="attachmentName(img)"
                :title="`${attachmentName(img)} — ${$t('chat.attachments.download')}`"
                @click="downloadAttachment(img, $event)"
                class="h-20 w-20 p-1.5 flex flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <div class="flex items-center gap-1">
                  <FileIcon
                    class="w-5 h-5 text-slate-400 dark:text-slate-500"
                  />
                  <Download
                    class="w-3 h-3 text-slate-400 dark:text-slate-500"
                  />
                </div>
                <span
                  class="w-full text-xxs text-center text-slate-500 dark:text-slate-400 truncate"
                  >{{ attachmentName(img) }}</span
                >
                <span
                  class="w-full text-xxs text-center text-slate-400 dark:text-slate-500 truncate"
                  >{{ attachmentSize(img) }}</span
                >
              </a>
              <button
                type="button"
                :title="$t('chat.removeImage')"
                class="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-slate-700 dark:bg-slate-600 text-white shadow hover:bg-slate-800 dark:hover:bg-slate-500 transition-colors"
                @click="removeImage(i)"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>

          <div class="relative flex items-end">
            <!-- Unified "+" attach button (upload / phone). -->
            <div class="absolute left-2 bottom-2">
              <button
                type="button"
                :title="
                  captureActive
                    ? $t('capture.desktop.active')
                    : $t('chat.addAttachment')
                "
                class="p-1.5 rounded-lg transition-colors"
                :class="
                  captureActive
                    ? 'text-emerald-500 dark:text-emerald-400'
                    : 'text-slate-400 dark:text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-white/5'
                "
                @click="onAddClick"
              >
                <Loader v-if="captureActive" class="w-4 h-4 animate-spin" />
                <Paperclip v-else class="w-4 h-4" />
              </button>

              <!-- Options menu (only shown when more than one source exists).
                   Hidden with v-show, not v-if, so the capture contribution and
                   its modal stay mounted after the menu closes on select. -->
              <div
                v-if="showAttachMenu"
                class="fixed inset-0 z-40"
                @click="showAttachMenu = false"
              ></div>
              <div
                v-show="showAttachMenu"
                class="absolute bottom-full left-0 mb-2 z-50 w-56 rounded-xl border border-slate-200 dark:border-white/10 glass shadow-xl p-1.5"
              >
                <button
                  type="button"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  @click="pickUpload"
                >
                  <ImagePlus
                    class="w-4 h-4 text-slate-400 dark:text-slate-500"
                  />
                  {{ $t('chat.uploadFromComputer') }}
                </button>
                <!-- Phone-capture option, owned by the capture plugin (#58). -->
                <PluginSlot name="app.header.capture" :ctx="captureSlotCtx" />
                <button
                  v-if="chatStore.projectId"
                  type="button"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  @click="pickProjectFiles"
                >
                  <FolderGit
                    class="w-4 h-4 text-slate-400 dark:text-slate-500"
                  />
                  {{ $t('chat.fromProjectFiles') }}
                </button>
              </div>
            </div>

            <!-- Picker: attach an image already uploaded to the current project.
                 The shared Modal teleports to <body>, so it centres over the whole
                 page — the chat panel's transform would otherwise trap `fixed`
                 inside its 384px — and brings Esc/backdrop dismiss and focus
                 capture the previous hand-rolled dialog lacked. -->
            <Modal
              v-model="showProjectFilesPicker"
              :title="$t('chat.projectFilesTitle')"
              width="2xl"
            >
              <div class="max-h-[60vh] overflow-y-auto">
                <div
                  v-if="loadingProjectFiles"
                  class="flex justify-center py-8"
                >
                  <Spinner :label="$t('chat.projectFilesLoading')" />
                </div>
                <p
                  v-else-if="projectFilesList.length === 0"
                  class="text-center text-xs text-slate-500 dark:text-slate-400 py-8"
                >
                  {{ $t('chat.projectFilesEmpty') }}
                </p>
                <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  <button
                    v-for="f in projectFilesList"
                    :key="f.id"
                    type="button"
                    :title="f.filename || ''"
                    class="aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-white/5 hover:ring-2 hover:ring-brand-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-all"
                    @click="attachProjectFile(f)"
                  >
                    <img
                      :src="previewUrl(f.url, 'xs')"
                      :alt="f.filename || ''"
                      loading="lazy"
                      class="w-full h-full object-cover"
                    />
                  </button>
                </div>
              </div>
            </Modal>
            <textarea
              ref="chatInputRef"
              v-model="chatInput"
              rows="1"
              :placeholder="$t('chat.placeholder')"
              @input="autoGrowInput"
              @keydown="onComposerKeydown"
              class="w-full glass-input rounded-xl pl-10 pr-12 py-3 text-sm leading-5 resize-none"
            ></textarea>
            <button
              type="submit"
              :disabled="isSending"
              class="absolute right-2 bottom-2 p-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors shadow-md shadow-brand-500/20 disabled:opacity-50"
            >
              <Loader v-if="isSending" class="w-4 h-4 animate-spin" />
              <Send v-else class="w-4 h-4" />
            </button>
            <input
              ref="imageInputRef"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onImageSelected"
            />
          </div>
        </form>
        <div class="flex items-center gap-1.5 mt-2.5 text-xxs text-slate-500">
          <Sparkles class="w-3.5 h-3.5 text-brand-500 dark:text-brand-400" />
          <span>{{ $t('chat.contextHint') }}</span>
        </div>
        <!-- …and what that context currently IS (#129). Under the promise it
             makes concrete, because the promise alone left the user inferring
             the answer from the page behind the panel.

             Both halves, always (#130): the object the screen published, and
             the project scope in force. The line used to state whichever one
             was more specific, which hid the project — and the project is the
             half the user cannot see on screen, since it follows them off the
             page they picked it on. The object half is read-only (it IS the
             screen), the project half is a control, because a sticky scope with
             no way to change or drop it can only be escaped by navigating.

             Shown in a single-user install too, unconditionally: the line says
             what the assistant is working on, which is worth as much with one
             user as with ten. Only the sharing angle — an upload joining a
             project others in the grant can see — is moot without the multiuser
             overlay, and the wording never leans on it. -->
        <p
          class="flex items-center gap-1.5 mt-1 text-xxs text-slate-500 dark:text-slate-400"
        >
          <FolderGit class="w-3 h-3 shrink-0 opacity-70" />
          <span v-if="chatContextPageLabel" class="min-w-0 truncate">{{
            chatContextPageLabel
          }}</span>
          <span
            v-if="chatContextPageLabel"
            aria-hidden="true"
            class="opacity-60"
            >·</span
          >
          <Select
            :model-value="chatStore.projectId"
            :options="chatProjectOptions"
            custom-trigger
            :aria-label="$t('chat.context.projectPicker')"
            trigger-class="min-w-0 rounded-lg px-1 -mx-1 focus-visible:ring-2 focus-visible:ring-brand-500/40 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            dropdown-class="text-sm"
            align="end"
            @update:model-value="chatStore.setProject($event)"
          >
            <template #trigger>
              <span class="truncate">{{
                chatContext.project
                  ? $t('chat.context.project', {
                      project: chatContext.project.name,
                    })
                  : $t('chat.context.noProject')
              }}</span>
              <ChevronDown class="w-3 h-3 shrink-0 ml-0.5 opacity-70" />
            </template>
          </Select>
        </p>
        <!-- Where an attached file will land, said before it is sent and only
             while there is one (#130). The answer is not always the project any
             more: an item on screen takes its own pictures. -->
        <p
          v-if="chatFilingLabel"
          class="flex items-center gap-1.5 mt-1 text-xxs text-slate-500 dark:text-slate-400"
        >
          <Paperclip class="w-3 h-3 shrink-0 opacity-70" />
          <span class="min-w-0 truncate">{{ chatFilingLabel }}</span>
        </p>
      </div>
    </aside>
  </div>
</template>
