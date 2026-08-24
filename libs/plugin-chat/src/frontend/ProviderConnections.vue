<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  Select,
  Button,
  Badge,
  Modal,
  SecretInput,
  Spinner,
  Switch,
  secretPatch,
  useConfirm,
  useToastStore,
  useSessionStore,
  notifyProvidersChanged,
  apiFetch,
  type SecretAction,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import {
  PROXY_LABEL_SEGMENTS,
  PROXY_LABEL_PLACEHOLDER,
  composeNormalizedProxyLabel,
  formatProxyLabelSegments,
  isProxyEndpoint,
  parseProxyLabelSegments,
  type ProxyLabelSegment,
} from '../proxy-label';
import {
  Check,
  Bot,
  Plus,
  Pencil,
  X,
  Zap,
  ShieldCheck,
  Trash2,
  Info,
  ChevronDown,
  Pin,
} from '@lucide/vue';

// One list of AI connections (instance or the caller's personal ones) with
// its create/edit modal. Mounted by AiProviderSettings — once for a regular
// user or the single-user mode, twice for a multiuser admin (who is BOTH the
// instance administrator and the owner of their own workspace).
const props = defineProps<{ personal: boolean }>();

const { t } = useI18n();
const confirm = useConfirm();
const toast = useToastStore();
const session = useSessionStore();

const personal = computed<boolean>(() => props.personal);
const apiBase = computed<string>(() =>
  personal.value ? '/api/chat/providers/personal' : '/api/chat/providers',
);
// The inherited pinned row makes sense only for users who do NOT manage the
// instance list themselves (an admin sees it as the section below).
const pinnedEnabled = computed<boolean>(
  () => personal.value && !session.isAdmin,
);

type ProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'custom';

// OpenAI vision/reasoning knobs — kept as local unions (mirrors ProviderType
// above), in sync with the backend providers.dto IMAGE_DETAILS/REASONING_EFFORTS.
type ImageDetail = 'auto' | 'high';
type ReasoningEffort = 'default' | 'low' | 'medium' | 'high';

// Public provider shape returned by the API — the raw apiKey is never sent to
// the client; `hasApiKey` tells us whether a secret is stored so we can offer a
// "leave blank to keep current" flow when editing.
interface ProviderConfig {
  id: string;
  name: string;
  provider: ProviderType;
  baseUrl: string | null;
  modelName: string;
  organizationId: string | null;
  apiVersion: string | null;
  imageDetail: string | null;
  reasoningEffort: string | null;
  isDefault: boolean;
  hasApiKey: boolean;
  ownerUserId: string | null;
  sharedWith: string;
  proxyLabel: string | null;
  proxyLabelSegments: string | null;
  proxyHeaderName: string | null;
}

interface ProviderForm {
  name: string;
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  organizationId: string;
  apiVersion: string;
  imageDetail: ImageDetail;
  reasoningEffort: ReasoningEffort;
  proxyLabel: string;
  // All three rows, always — membership is the `on` flag and order is the array
  // order, which is exactly what the column stores (#226).
  proxyRows: ProxyRow[];
  proxyHeaderName: string;
}

interface ProxyRow {
  key: ProxyLabelSegment;
  on: boolean;
}

type FieldRule = 'required' | 'optional' | 'hidden';

interface FieldRules {
  baseUrl: FieldRule;
  apiKey: FieldRule;
  organizationId: FieldRule;
  apiVersion: FieldRule;
  imageDetail: FieldRule;
  reasoningEffort: FieldRule;
}

// Which parameters each provider actually needs. Must stay in sync with the
// backend PROVIDER_FIELD_RULES. modelName and name are required for all.
const fieldRulesMap: Record<ProviderType, FieldRules> = {
  gemini: {
    baseUrl: 'optional',
    apiKey: 'required',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  openai: {
    baseUrl: 'optional',
    apiKey: 'required',
    organizationId: 'optional',
    apiVersion: 'hidden',
    imageDetail: 'optional',
    reasoningEffort: 'optional',
  },
  anthropic: {
    baseUrl: 'optional',
    apiKey: 'required',
    organizationId: 'hidden',
    apiVersion: 'optional',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  ollama: {
    baseUrl: 'required',
    apiKey: 'hidden',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
  custom: {
    baseUrl: 'required',
    apiKey: 'optional',
    organizationId: 'hidden',
    apiVersion: 'hidden',
    imageDetail: 'hidden',
    reasoningEffort: 'hidden',
  },
};

// Anthropic's `anthropic-version` header value — a sensible current default.
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

const defaultUrls: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434',
  custom: '',
};

const defaultModels: Record<ProviderType, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5',
  ollama: 'llama3.1',
  custom: '',
};

// Provider display names are brand nouns (technical identifiers), except the
// two that need translation.
const providerOptions = computed(() => [
  { value: 'gemini', label: 'Google Gemini API' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'ollama', label: t('providerSettings.ollamaLocal') },
  { value: 'custom', label: t('providerSettings.customGatewayOption') },
]);
const providerLabel = (type: ProviderType): string =>
  providerOptions.value.find((o) => o.value === type)?.label ?? type;

const reasoningEfforts: readonly ReasoningEffort[] = [
  'default',
  'low',
  'medium',
  'high',
];

const isReasoningEffort = (value: string | null): value is ReasoningEffort =>
  value !== null && (reasoningEfforts as readonly string[]).includes(value);

const providers = ref<ProviderConfig[]>([]);
// The connection a regular user inherits — the workspace owner's guest-shared
// one, else the admin's instance default — pinned read-only at the top.
interface SharedConnection {
  connection: ProviderConfig;
  source: 'workspace-owner' | 'instance';
}
const sharedConnection = ref<SharedConnection | null>(null);
const loading = ref(true);
const loadError = ref('');

// The inherited connection is what the assistant actually uses while none of
// the user's own connections is selected (an own selection wins).
const sharedIsActive = computed<boolean>(
  () =>
    sharedConnection.value !== null &&
    !providers.value.some((p) => p.isDefault),
);

// Selecting the pinned row = deselecting every own connection.
const useShared = async (): Promise<void> => {
  const response = await apiFetch(`${apiBase.value}/default/clear`, {
    method: 'PATCH',
  }).catch(() => null);
  if (response?.ok) {
    await fetchProviders();
    notifyProvidersChanged();
  } else {
    toast.error(t('providerSettings.saveError'));
  }
};

// --- Modal form state -------------------------------------------------------
const showForm = ref(false);
const formError = ref('');
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
// Collapsed by default — the how-to-get-a-key guide is reference material.
const showGuide = ref(false);

// Null editingId = "create new" mode; a provider id = editing that provider.
const editingId = ref<string | null>(null);
const editingHasApiKey = ref(false);
// While editing a provider that already has a stored key, `SecretInput` shows a
// shielded mask instead of an input until the user chooses what to do with it.
// Blank means "keep" on the wire, so removal needs its own state — otherwise a
// stored key could never be dropped without deleting the connection (#220).
const keyAction = ref<SecretAction>('keep');

const emptyForm = (): ProviderForm => ({
  name: '',
  provider: 'gemini',
  apiKey: '',
  baseUrl: defaultUrls.gemini,
  modelName: defaultModels.gemini,
  organizationId: '',
  apiVersion: '',
  imageDetail: 'auto',
  reasoningEffort: 'default',
  proxyLabel: '',
  // Default: the connection segment alone. The user and project segments send
  // the operator's own data to a third party, so they stay opt-in.
  proxyRows: PROXY_LABEL_SEGMENTS.map((key) => ({ key, on: key === 'label' })),
  proxyHeaderName: '',
});

const form = reactive<ProviderForm>(emptyForm());

const rules = computed<FieldRules>(() => fieldRulesMap[form.provider]);
const isEditing = computed(() => editingId.value !== null);

// ── Proxy request labelling (#230) ──────────────────────────────────────────

// Whether the label would actually be sent — the same test the backend applies
// (#228). The block itself is ALWAYS rendered so the modal's height never
// depends on what is typed into the endpoint field; this only drives the
// disabled state and its explanation.
const proxyLabelActive = computed(() =>
  isProxyEndpoint(form.baseUrl, defaultUrls[form.provider]),
);

// The `user` segment distinguishes nothing while there is exactly one user, and
// a constant segment would fragment the proxy's report the day the overlay is
// switched on. The backend still substitutes the placeholder for a null caller.
const canLabelUser = computed(() => session.multiuserEnabled);

const proxyRowEnabled = (row: ProxyRow): boolean =>
  row.on && (row.key !== 'user' || canLabelUser.value);

const toggleProxyRow = (row: ProxyRow): void => {
  if (row.key === 'user' && !canLabelUser.value) return;
  row.on = !row.on;
};

// Sample values, so the preview shows the shape of a real label rather than an
// abstraction. The live values are per-request and only the server knows them.
const proxySampleUser = computed(
  () =>
    session.user?.displayName ||
    session.user?.username ||
    t('providerSettings.proxyLabel.sampleUser'),
);

// Normalisation happens on the SERVER: the transliteration tables are files it
// reads at startup, and a browser bundle cannot carry "whatever is in the
// folder". The form sends the raw values (debounced) and composes its preview
// from the returned parts; only placeholder/joining logic runs locally.
const proxyNormalized = ref<Partial<Record<ProxyLabelSegment, string>>>({});
let proxyNormalizeTimer: ReturnType<typeof setTimeout> | undefined;
let proxyNormalizeSeq = 0;

const refreshProxyNormalized = (): void => {
  if (!proxyLabelActive.value) return;
  clearTimeout(proxyNormalizeTimer);
  proxyNormalizeTimer = setTimeout(async () => {
    const seq = ++proxyNormalizeSeq;
    const values = [
      form.proxyLabel,
      proxySampleUser.value,
      t('providerSettings.proxyLabel.sampleProject'),
    ];
    try {
      const response = await apiFetch(
        '/api/chat/providers/proxy-label/normalize',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        },
      );
      if (!response.ok || seq !== proxyNormalizeSeq) return;
      const data = (await response.json()) as { normalized: string[] };
      proxyNormalized.value = {
        label: data.normalized[0],
        user: data.normalized[1],
        project: data.normalized[2],
      };
    } catch {
      // A stale preview beats an error surface for a passive hint; the next
      // keystroke retries anyway.
    }
  }, 250);
};

const proxyPreview = computed(() =>
  composeNormalizedProxyLabel(
    form.proxyRows.filter(proxyRowEnabled).map((row) => row.key),
    proxyNormalized.value,
  ),
);

const proxyRowValue = (row: ProxyRow): string =>
  proxyNormalized.value[row.key] || PROXY_LABEL_PLACEHOLDER;

watch(
  // proxyLabelActive flips when the endpoint stops being the vendor's, and the
  // modal opening resets the form — both must (re)prime the preview.
  [() => form.proxyLabel, () => showForm.value, () => proxyLabelActive.value],
  refreshProxyNormalized,
);

// Mouse-only reordering, by decision — no keyboard equivalent is offered.
const proxyDragKey = ref<ProxyLabelSegment | null>(null);
// The INSERTION SLOT (0..length) the pointer currently designates, drawn as a
// bar between rows — not a highlight of a row, which never says on which side
// of it the dragged row would land. Upper half of a row means before it, lower
// half means after.
const proxyDropIndex = ref<number | null>(null);

const endProxyDrag = (): void => {
  proxyDragKey.value = null;
  proxyDropIndex.value = null;
};

const onProxyRowDragOver = (event: DragEvent, index: number): void => {
  if (!proxyDragKey.value) return;
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  const rect = el.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  proxyDropIndex.value = index + (before ? 0 : 1);
};

// dragleave bubbles up from every child a drag passes over; clearing on each of
// those wipes the indicator the instant it appears. Only a leave whose
// destination is outside the list means the drag really left it.
const onProxyListLeave = (event: DragEvent): void => {
  const { relatedTarget, currentTarget } = event;
  if (
    relatedTarget instanceof Node &&
    currentTarget instanceof Node &&
    currentTarget.contains(relatedTarget)
  ) {
    return;
  }
  proxyDropIndex.value = null;
};

const onProxyDrop = (): void => {
  const dragged = proxyDragKey.value;
  const slot = proxyDropIndex.value;
  endProxyDrag();
  if (!dragged || slot === null) return;
  const from = form.proxyRows.findIndex((row) => row.key === dragged);
  if (from === -1) return;
  const rows = [...form.proxyRows];
  const [moved] = rows.splice(from, 1);
  // Removing the dragged row shifts every slot after it up by one.
  rows.splice(slot > from ? slot - 1 : slot, 0, moved);
  form.proxyRows = rows;
};

const fetchProviders = async (): Promise<void> => {
  try {
    loading.value = true;
    loadError.value = '';
    const response = await apiFetch(apiBase.value);
    if (response.ok) {
      providers.value = (await response.json()) as ProviderConfig[];
    } else {
      loadError.value = t('providerSettings.loadError');
    }
    if (pinnedEnabled.value) {
      const shared = await apiFetch('/api/chat/providers/shared').catch(
        () => null,
      );
      // Nest serializes a null result as an empty body — parse defensively.
      const raw = shared && shared.ok ? await shared.text() : '';
      sharedConnection.value = raw
        ? (JSON.parse(raw) as SharedConnection | null)
        : null;
    }
  } catch {
    loadError.value = t('providerSettings.loadError');
  } finally {
    loading.value = false;
  }
};

const resetFormState = (): void => {
  formError.value = '';
  testResult.value = null;
  keyAction.value = 'keep';
  showGuide.value = false;
};

const openCreate = (): void => {
  editingId.value = null;
  editingHasApiKey.value = false;
  resetFormState();
  Object.assign(form, emptyForm());
  showForm.value = true;
};

const openEdit = (p: ProviderConfig): void => {
  editingId.value = p.id;
  editingHasApiKey.value = p.hasApiKey;
  resetFormState();
  form.name = p.name;
  form.provider = p.provider;
  form.baseUrl = p.baseUrl ?? '';
  form.modelName = p.modelName;
  form.organizationId = p.organizationId ?? '';
  form.apiVersion = p.apiVersion ?? '';
  form.imageDetail = p.imageDetail === 'high' ? 'high' : 'auto';
  form.reasoningEffort = isReasoningEffort(p.reasoningEffort)
    ? p.reasoningEffort
    : 'default';
  form.proxyLabel = p.proxyLabel ?? '';
  form.proxyHeaderName = p.proxyHeaderName ?? '';
  // Enabled segments first, in their stored order (that order is the operator's
  // and is significant), then the switched-off ones so every row stays present.
  const enabled = parseProxyLabelSegments(p.proxyLabelSegments);
  form.proxyRows = [
    ...enabled.map((key) => ({ key, on: true })),
    ...PROXY_LABEL_SEGMENTS.filter((key) => !enabled.includes(key)).map(
      (key) => ({
        key,
        on: false,
      }),
    ),
  ];
  // Never populate the secret back into the form — editing keeps it unless the
  // user explicitly replaces it.
  form.apiKey = '';
  showForm.value = true;
};

// A key is on file only while editing a connection that has one — a new
// connection has nothing to keep, replace or drop.
const hasStoredKey = computed<boolean>(
  () => isEditing.value && editingHasApiKey.value,
);

// Removing the key is only offered where the provider can work without one —
// today that is `custom` alone. #220 phrased the action as applying to "any
// provider whose key you want to drop", but a required-key provider without a
// key is not a connection that can be saved at all: `validate()` rejects it, so
// the button could only ever lead to an error. Deliberately narrower than the
// ticket's wording; a keyless openai/anthropic/gemini connection would need the
// field rules to change first.
const canRemoveKey = computed<boolean>(
  () => hasStoredKey.value && rules.value.apiKey === 'optional',
);

// Applied when the provider dropdown changes: reset connection-specific defaults
// and clear fields that don't apply to the newly selected provider.
const applyProviderDefaults = (): void => {
  form.baseUrl = defaultUrls[form.provider];
  form.modelName = defaultModels[form.provider];
  form.organizationId = '';
  form.apiVersion =
    form.provider === 'anthropic' ? DEFAULT_ANTHROPIC_VERSION : '';
  form.imageDetail = 'auto';
  form.reasoningEffort = 'default';
  // A staged key removal belongs to the provider it was staged for; a key the
  // user already typed is still theirs to keep.
  if (keyAction.value === 'remove') keyAction.value = 'keep';
  testResult.value = null;
};

const testConnection = async (): Promise<void> => {
  testing.value = true;
  testResult.value = null;

  const payload: Record<string, string> = { provider: form.provider };
  if (isEditing.value && editingId.value) payload.id = editingId.value;
  if (form.apiKey) payload.apiKey = form.apiKey;
  if (rules.value.baseUrl !== 'hidden' && form.baseUrl.trim()) {
    payload.baseUrl = form.baseUrl.trim();
  }
  if (rules.value.organizationId !== 'hidden' && form.organizationId.trim()) {
    payload.organizationId = form.organizationId.trim();
  }
  if (rules.value.apiVersion !== 'hidden' && form.apiVersion.trim()) {
    payload.apiVersion = form.apiVersion.trim();
  }

  try {
    const response = await apiFetch(`${apiBase.value}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const data = (await response.json()) as { ok: boolean; error?: string };
      testResult.value = data.ok
        ? { ok: true, message: t('providerSettings.testSuccess') }
        : {
            ok: false,
            message: t('providerSettings.testFailed', {
              error: data.error ?? '',
            }),
          };
    } else {
      testResult.value = {
        ok: false,
        message: t('providerSettings.testFailed', {
          error: `HTTP ${response.status}`,
        }),
      };
    }
  } catch {
    testResult.value = { ok: false, message: t('providerSettings.testError') };
  } finally {
    testing.value = false;
  }
};

const setDefault = async (id: string): Promise<void> => {
  const response = await apiFetch(`${apiBase.value}/${id}/default`, {
    method: 'PATCH',
  }).catch(() => null);
  if (response?.ok) {
    await fetchProviders();
    notifyProvidersChanged();
  } else {
    toast.error(t('providerSettings.saveError'));
  }
};

const handleDeleteProvider = async (p: ProviderConfig): Promise<void> => {
  const ok = await confirm({
    message: t('providerSettings.deleteConfirmNamed', { name: p.name }),
    tone: 'danger',
  });
  if (!ok) return;
  const response = await apiFetch(`${apiBase.value}/${p.id}`, {
    method: 'DELETE',
  }).catch(() => null);
  if (response?.ok) {
    toast.success(t('providerSettings.deleted'));
    await fetchProviders();
    notifyProvidersChanged();
  } else {
    toast.error(t('providerSettings.saveError'));
  }
};

const validateForm = (): string => {
  if (!form.name.trim()) return t('providerSettings.validation.nameRequired');
  if (!form.modelName.trim())
    return t('providerSettings.validation.modelRequired');
  if (rules.value.baseUrl === 'required' && !form.baseUrl.trim()) {
    return t('providerSettings.validation.baseUrlRequired');
  }
  // An API key is satisfied in edit mode if one is already stored — unless the
  // user staged its removal.
  const keyMissing =
    !form.apiKey && !(hasStoredKey.value && keyAction.value !== 'remove');
  if (rules.value.apiKey === 'required' && keyMissing) {
    return t('providerSettings.validation.apiKeyRequired');
  }
  return '';
};

const buildPayload = (): Record<string, string | null> => {
  const payload: Record<string, string | null> = {
    name: form.name.trim(),
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    modelName: form.modelName.trim(),
  };
  // The key is the one field where blank means "keep current": it never
  // round-trips to the client, so an untouched form has nothing to send.
  // Dropping it takes an explicit null — via the trash button or by saving an
  // emptied box, both only where the provider can work keyless. A key is taken
  // exactly as typed — its edge characters are the provider's business.
  const key = secretPatch(keyAction.value, form.apiKey, {
    trim: false,
    emptyClears: canRemoveKey.value,
  });
  if (key !== undefined) payload.apiKey = key;
  // Every other optional field is sent even when empty, so clearing one
  // actually clears it; the backend collapses a blank value to null (#220).
  if (rules.value.organizationId !== 'hidden') {
    payload.organizationId = form.organizationId.trim();
  }
  if (rules.value.apiVersion !== 'hidden') {
    payload.apiVersion = form.apiVersion.trim();
  }
  // Sent even at their default value so switching back to "auto"/"default"
  // propagates; the backend collapses those sentinels to null.
  if (rules.value.imageDetail !== 'hidden') {
    payload.imageDetail = form.imageDetail;
  }
  if (rules.value.reasoningEffort !== 'hidden') {
    payload.reasoningEffort = form.reasoningEffort;
  }
  // Sent even when blank so clearing the label actually clears it. The segment
  // list is sent as its canonical string — including "" for "every segment off",
  // which is a real state and must not be read back as the default.
  payload.proxyLabel = form.proxyLabel.trim();
  payload.proxyLabelSegments = formatProxyLabelSegments(
    form.proxyRows.filter(proxyRowEnabled).map((row) => row.key),
  );
  payload.proxyHeaderName = form.proxyHeaderName.trim();
  return payload;
};

const submitForm = async (): Promise<void> => {
  const error = validateForm();
  if (error) {
    formError.value = error;
    return;
  }
  formError.value = '';
  saving.value = true;

  const url = isEditing.value
    ? `${apiBase.value}/${editingId.value}`
    : apiBase.value;
  const method = isEditing.value ? 'PATCH' : 'POST';

  try {
    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    if (response.ok) {
      toast.success(t('providerSettings.saved'));
      showForm.value = false;
      await fetchProviders();
      notifyProvidersChanged();
    } else {
      formError.value = t('providerSettings.saveError');
    }
  } catch {
    formError.value = t('providerSettings.saveError');
  } finally {
    saving.value = false;
  }
};

// Credential sharing is owner-controlled on every level. The three sharing
// levels are a ladder ('everyone' already covers workspace guests), so the
// two switches are mutually exclusive: enabling one narrows/widens the level,
// disabling drops to private.
const showSharing = computed(() => session.multiuserEnabled);
const setSharing = async (
  p: ProviderConfig,
  level: 'workspace-guests' | 'everyone',
  next: boolean,
): Promise<void> => {
  const previous = p.sharedWith;
  p.sharedWith = next ? level : 'none';
  const response = await apiFetch(`${apiBase.value}/${p.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sharedWith: p.sharedWith }),
  }).catch(() => null);
  if (!response || !response.ok) {
    p.sharedWith = previous;
    toast.error(t('providerSettings.saveError'));
  }
};

onMounted(() => {
  fetchProviders();
});
</script>

<template>
  <div class="space-y-4">
    <!-- Header row: context + the single primary action -->
    <div class="flex items-start justify-between gap-4">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{
          personal
            ? $t('providerSettings.personal.subtitle')
            : $t('providerSettings.instanceSubtitle')
        }}
      </p>
      <Button size="sm" :icon-left="Plus" @click="openCreate">
        {{ $t('providerSettings.newConnection') }}
      </Button>
    </div>

    <div v-if="loading" class="flex justify-center py-10">
      <Spinner :label="$t('common.loading')" />
    </div>

    <p v-else-if="loadError" class="text-xs text-red-500 dark:text-red-400">
      {{ loadError }}
    </p>

    <template v-else>
      <div
        v-if="providers.length > 0 || sharedConnection"
        class="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-white/5"
      >
        <!-- Inherited from the administrator: pinned, read-only -->
        <div
          v-if="sharedConnection"
          class="flex items-center gap-4 px-5 py-4 bg-slate-50/60 dark:bg-white/[0.03]"
          :class="sharedIsActive ? 'bg-brand-500/5 dark:bg-brand-500/5' : ''"
        >
          <input
            type="radio"
            name="active-connection"
            class="w-4 h-4 shrink-0 accent-brand-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            :checked="sharedIsActive"
            :aria-label="$t('providerSettings.setDefaultTitle')"
            :title="$t('providerSettings.setDefaultTitle')"
            @change="useShared"
          />
          <span
            class="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-200/60 dark:bg-white/5 text-slate-500 dark:text-slate-400 shrink-0"
          >
            <Bot class="w-5 h-5" />
          </span>
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <Pin
                class="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <span class="text-sm font-bold text-slate-900 dark:text-white">
                {{ sharedConnection.connection.name }}
              </span>
              <Badge tone="neutral">
                {{
                  sharedConnection.source === 'workspace-owner'
                    ? $t('providerSettings.sharedFromOwner')
                    : $t('providerSettings.sharedFromAdmin')
                }}
              </Badge>
              <Badge v-if="sharedIsActive" tone="brand">
                {{ $t('providerSettings.active') }}
              </Badge>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ providerLabel(sharedConnection.connection.provider) }}
              <span class="font-mono"
                >· {{ sharedConnection.connection.modelName }}</span
              >
            </p>
          </div>
        </div>

        <!-- The caller's own connections -->
        <div
          v-for="p in providers"
          :key="p.id"
          class="flex items-center gap-4 px-5 py-4"
          :class="p.isDefault ? 'bg-brand-500/5' : ''"
        >
          <!-- The active connection is a single choice — a radio group, not a
             star: one look tells which is selected and how to change it. -->
          <input
            type="radio"
            name="active-connection"
            class="w-4 h-4 shrink-0 accent-brand-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            :checked="p.isDefault"
            :aria-label="$t('providerSettings.setDefaultTitle')"
            :title="$t('providerSettings.setDefaultTitle')"
            @change="setDefault(p.id)"
          />

          <span
            class="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400 shrink-0"
          >
            <Bot class="w-5 h-5" />
          </span>

          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-bold text-slate-900 dark:text-white">
                {{ p.name }}
              </span>
              <Badge v-if="p.isDefault" tone="brand">
                {{ $t('providerSettings.active') }}
              </Badge>
              <span
                v-if="p.hasApiKey"
                :title="$t('providerSettings.keySaved')"
                class="inline-flex shrink-0"
              >
                <ShieldCheck class="w-3.5 h-3.5 text-emerald-500" />
              </span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
              {{ providerLabel(p.provider) }}
              <span class="font-mono">· {{ p.modelName }}</span>
            </p>
          </div>

          <!-- Dedicated middle columns: sharing toggles align across cards -->
          <div
            v-if="showSharing && !personal"
            class="flex items-center gap-2 shrink-0 w-36"
          >
            <Switch
              :model-value="p.sharedWith === 'everyone'"
              :aria-label="$t('providerSettings.sharing.withEveryone')"
              @update:model-value="(v: boolean) => setSharing(p, 'everyone', v)"
            />
            <span class="text-xxs text-slate-500 dark:text-slate-400">
              {{ $t('providerSettings.sharing.withEveryone') }}
            </span>
          </div>
          <div v-if="showSharing" class="flex items-center gap-2 shrink-0 w-40">
            <Switch
              :model-value="p.sharedWith === 'workspace-guests'"
              :aria-label="$t('providerSettings.sharing.withGuests')"
              @update:model-value="
                (v: boolean) => setSharing(p, 'workspace-guests', v)
              "
            />
            <span class="text-xxs text-slate-500 dark:text-slate-400">
              {{ $t('providerSettings.sharing.withGuests') }}
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              :icon-left="Pencil"
              :aria-label="$t('providerSettings.editTitle')"
              @click="openEdit(p)"
            />
            <Button
              variant="danger"
              size="sm"
              :icon-left="Trash2"
              :aria-label="$t('providerSettings.deleteTitle')"
              @click="handleDeleteProvider(p)"
            />
          </div>
        </div>
      </div>

      <!-- No connections of your own yet — invite the first one -->
      <button
        v-if="providers.length === 0"
        type="button"
        class="w-full glass-card rounded-2xl px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400 hover:border-brand-500/30 border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        @click="openCreate"
      >
        <Bot class="w-6 h-6 mx-auto mb-2 text-brand-500/60" />
        {{ $t('providerSettings.emptyList') }}
      </button>
    </template>

    <!-- Create / edit modal -->
    <Modal
      v-model="showForm"
      :title="
        isEditing
          ? $t('providerSettings.editConnectionTitle', { name: form.name })
          : $t('providerSettings.newConnection')
      "
      width="3xl"
    >
      <form class="space-y-5" @submit.prevent="submitForm">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Name -->
          <div class="space-y-1.5">
            <label
              for="prov-name"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.connectionName') }}
              <span class="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              id="prov-name"
              v-model="form.name"
              type="text"
              required
              :placeholder="$t('providerSettings.namePlaceholder')"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <!-- Provider -->
          <div class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.aiProvider') }}
            </label>
            <Select
              v-model="form.provider"
              :options="providerOptions"
              @change="applyProviderDefaults"
            />
          </div>

          <!-- Model -->
          <div class="space-y-1.5">
            <label
              for="prov-model"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.modelName') }}
              <span class="text-red-500" aria-hidden="true">*</span>
            </label>
            <input
              id="prov-model"
              v-model="form.modelName"
              type="text"
              required
              :placeholder="defaultModels[form.provider] || 'model-id'"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <!-- Base URL -->
          <div v-if="rules.baseUrl !== 'hidden'" class="space-y-1.5">
            <label
              for="prov-url"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.endpoint') }}
              <span
                v-if="rules.baseUrl === 'required'"
                class="text-red-500"
                aria-hidden="true"
                >*</span
              >
              <span
                v-else
                class="text-slate-400 dark:text-slate-500 font-normal"
              >
                {{ $t('providerSettings.optional') }}
              </span>
            </label>
            <input
              id="prov-url"
              v-model="form.baseUrl"
              type="text"
              placeholder="https://..."
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <!-- Organization ID (OpenAI only) -->
          <div v-if="rules.organizationId !== 'hidden'" class="space-y-1.5">
            <label
              for="prov-org"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.organizationId') }}
              <span class="text-slate-400 dark:text-slate-500 font-normal">
                {{ $t('providerSettings.optional') }}
              </span>
            </label>
            <input
              id="prov-org"
              v-model="form.organizationId"
              type="text"
              placeholder="org-..."
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <!-- API Version (Anthropic only) -->
          <div v-if="rules.apiVersion !== 'hidden'" class="space-y-1.5">
            <label
              for="prov-ver"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.apiVersion') }}
              <span class="text-slate-400 dark:text-slate-500 font-normal">
                {{ $t('providerSettings.optional') }}
              </span>
            </label>
            <input
              id="prov-ver"
              v-model="form.apiVersion"
              type="text"
              placeholder="2023-06-01"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
            />
          </div>

          <!-- Image detail (OpenAI vision fidelity) -->
          <div v-if="rules.imageDetail !== 'hidden'" class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.imageDetail') }}
            </label>
            <Select
              v-model="form.imageDetail"
              :options="[
                {
                  value: 'auto',
                  label: $t('providerSettings.imageDetailOptions.auto'),
                },
                {
                  value: 'high',
                  label: $t('providerSettings.imageDetailOptions.high'),
                },
              ]"
            />
            <p class="text-xxs text-slate-500 dark:text-slate-400">
              {{ $t('providerSettings.imageDetailHint') }}
            </p>
          </div>

          <!-- Reasoning effort (OpenAI reasoning models) -->
          <div v-if="rules.reasoningEffort !== 'hidden'" class="space-y-1.5">
            <label
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.reasoningEffort') }}
            </label>
            <Select
              v-model="form.reasoningEffort"
              :options="[
                {
                  value: 'default',
                  label: $t('providerSettings.reasoningEffortOptions.default'),
                },
                {
                  value: 'low',
                  label: $t('providerSettings.reasoningEffortOptions.low'),
                },
                {
                  value: 'medium',
                  label: $t('providerSettings.reasoningEffortOptions.medium'),
                },
                {
                  value: 'high',
                  label: $t('providerSettings.reasoningEffortOptions.high'),
                },
              ]"
            />
            <p class="text-xxs text-slate-500 dark:text-slate-400">
              {{ $t('providerSettings.reasoningEffortHint') }}
            </p>
          </div>

          <!-- API Key -->
          <div
            v-if="rules.apiKey !== 'hidden'"
            class="sm:col-span-2 space-y-1.5"
          >
            <label
              for="prov-key"
              class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
            >
              {{ $t('providerSettings.apiKey') }}
              <span
                v-if="rules.apiKey === 'required'"
                class="text-red-500"
                aria-hidden="true"
                >*</span
              >
              <span
                v-else
                class="text-slate-400 dark:text-slate-500 font-normal"
              >
                {{ $t('providerSettings.optional') }}
              </span>
            </label>

            <SecretInput
              id="prov-key"
              v-model="form.apiKey"
              v-model:action="keyAction"
              :stored="hasStoredKey"
              :removable="canRemoveKey"
              mono
              :placeholder="$t('providerSettings.keyPlaceholder')"
            />
            <p
              class="text-xxs text-slate-500 dark:text-slate-400 leading-relaxed"
            >
              {{ $t('providerSettings.keyHint') }}
            </p>
          </div>

          <!-- Proxy request labelling (#230). ALWAYS rendered, never v-if'd on
               the endpoint: appearing and disappearing while the URL is typed
               made the centred modal jump. While the endpoint is the vendor's
               own the whole fieldset is disabled instead, and the hint line
               says why — it swaps text rather than appearing, so the height
               never changes. -->
          <fieldset
            v-if="rules.baseUrl !== 'hidden'"
            :disabled="!proxyLabelActive"
            class="sm:col-span-2 rounded-2xl border border-slate-200 dark:border-dark-700 p-4 space-y-3 min-w-0"
            :class="proxyLabelActive ? '' : 'opacity-60'"
          >
            <p
              class="text-xxs"
              :class="
                proxyLabelActive
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-amber-700 dark:text-amber-400'
              "
            >
              {{
                proxyLabelActive
                  ? $t('providerSettings.proxyLabel.labelHint')
                  : $t('providerSettings.proxyLabel.disabledHint')
              }}
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- What the operator writes -->
              <div class="space-y-1.5 min-w-0">
                <label
                  for="prov-proxy-label"
                  class="text-xs font-bold text-slate-700 dark:text-slate-300 block"
                >
                  {{ $t('providerSettings.proxyLabel.label') }}
                  <span class="text-slate-400 dark:text-slate-500 font-normal">
                    {{ $t('providerSettings.optional') }}
                  </span>
                </label>
                <input
                  id="prov-proxy-label"
                  v-model="form.proxyLabel"
                  type="text"
                  placeholder="makekeeper-prod"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />

                <label
                  for="prov-proxy-header"
                  class="text-xs font-bold text-slate-700 dark:text-slate-300 block pt-2"
                >
                  {{ $t('providerSettings.proxyLabel.headerName') }}
                  <span class="text-slate-400 dark:text-slate-500 font-normal">
                    {{ $t('providerSettings.optional') }}
                  </span>
                </label>
                <input
                  id="prov-proxy-header"
                  v-model="form.proxyHeaderName"
                  type="text"
                  placeholder="x-my-proxy-tag"
                  class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
                <p class="text-xxs text-slate-500 dark:text-slate-400">
                  {{ $t('providerSettings.proxyLabel.headerNameHint') }}
                </p>
              </div>

              <!-- What will actually leave -->
              <div class="space-y-1.5 min-w-0">
                <!-- Deliberately NOT hidden behind a filled label: the
                     connection segment can itself be switched off, so a user-
                     or project-only label is a legitimate configuration, and
                     the empty case is stated in words in the preview. -->
                <p class="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {{ $t('providerSettings.proxyLabel.segments') }}
                </p>
                <ul
                  class="rounded-xl overflow-hidden border border-slate-200 dark:border-dark-700"
                  @dragleave="onProxyListLeave"
                >
                  <li
                    v-for="(row, index) in form.proxyRows"
                    :key="row.key"
                    :draggable="proxyLabelActive"
                    class="relative flex items-center gap-3 px-3 py-2 bg-white/60 dark:bg-dark-800/40 border-t first:border-t-0 border-slate-200 dark:border-dark-700"
                    :class="[
                      proxyLabelActive ? 'cursor-grab' : '',
                      proxyDragKey === row.key ? 'opacity-40' : '',
                    ]"
                    @dragstart="proxyDragKey = row.key"
                    @dragend="endProxyDrag"
                    @dragenter.prevent
                    @dragover.prevent="onProxyRowDragOver($event, index)"
                    @drop.prevent="onProxyDrop"
                  >
                    <!-- Insertion bar: WHERE the dragged row will land, not
                         which row the pointer happens to cover. Before this
                         row, or — for the last row only — after it. -->
                    <span
                      v-if="proxyDropIndex === index"
                      aria-hidden="true"
                      class="absolute inset-x-0 top-0 h-0.5 bg-brand-500 pointer-events-none"
                    ></span>
                    <span
                      v-if="
                        index === form.proxyRows.length - 1 &&
                        proxyDropIndex === form.proxyRows.length
                      "
                      aria-hidden="true"
                      class="absolute inset-x-0 bottom-0 h-0.5 bg-brand-500 pointer-events-none"
                    ></span>
                    <span
                      aria-hidden="true"
                      class="text-slate-400 dark:text-slate-500 select-none"
                      >⠿</span
                    >
                    <Switch
                      :model-value="proxyRowEnabled(row)"
                      :disabled="
                        !proxyLabelActive ||
                        (row.key === 'user' && !canLabelUser)
                      "
                      :aria-label="
                        $t(`providerSettings.proxyLabel.segment.${row.key}`)
                      "
                      @update:model-value="toggleProxyRow(row)"
                    />
                    <span
                      class="text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {{ $t(`providerSettings.proxyLabel.segment.${row.key}`) }}
                    </span>
                    <span
                      class="ml-auto font-mono text-xxs text-slate-500 dark:text-slate-400 truncate"
                    >
                      {{ proxyRowValue(row) }}
                    </span>
                  </li>
                </ul>
                <p class="text-xxs text-slate-500 dark:text-slate-400">
                  {{ $t('providerSettings.proxyLabel.orderHint') }}
                </p>

                <div
                  class="rounded-xl px-3 py-2 bg-slate-100/70 dark:bg-dark-800/60"
                >
                  <p
                    class="text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                  >
                    {{ $t('providerSettings.proxyLabel.preview') }}
                  </p>
                  <!-- The empty case is stated in words: a dead configuration
                       must not read as an invisible one. -->
                  <p
                    v-if="!proxyPreview.hasContent"
                    class="text-xs text-amber-700 dark:text-amber-400 mt-0.5"
                  >
                    {{ $t('providerSettings.proxyLabel.previewEmpty') }}
                  </p>
                  <p
                    v-else
                    class="font-mono text-xs text-slate-800 dark:text-slate-200 mt-0.5 break-all"
                  >
                    {{ proxyPreview.value }}
                  </p>
                </div>
              </div>
            </div>
          </fieldset>
        </div>

        <!-- Collapsible how-to guide: reference material, not a wall of text -->
        <div class="rounded-2xl border border-slate-200 dark:border-white/10">
          <button
            type="button"
            :aria-expanded="showGuide"
            class="w-full flex items-center gap-2 px-4 py-3 text-left text-xs font-bold text-slate-700 dark:text-slate-300 rounded-2xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            @click="showGuide = !showGuide"
          >
            <Info class="w-4 h-4 text-brand-500 shrink-0" />
            {{ $t(`providerSettings.guides.${form.provider}.title`) }}
            <ChevronDown
              class="w-4 h-4 ml-auto text-slate-400 transition-transform duration-200 shrink-0"
              :class="{ '-rotate-90': !showGuide }"
            />
          </button>
          <ol
            v-show="showGuide"
            class="list-decimal pl-9 pr-4 pb-4 space-y-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400"
          >
            <li
              v-for="(step, index) in $tm(
                `providerSettings.guides.${form.provider}.steps`,
              )"
              :key="index"
              v-html="$rt(step)"
            ></li>
          </ol>
        </div>

        <p v-if="formError" class="text-xs text-red-500 dark:text-red-400">
          {{ formError }}
        </p>

        <div
          class="flex flex-col sm:flex-row sm:items-center justify-end gap-2 pt-1"
        >
          <!-- Result of the minimal connection test — inside the buttons row,
               filling its free left half, so appearing does not change the
               form's height and the buttons stay put under the pointer. -->
          <p
            v-if="testResult"
            class="text-xs flex items-center gap-1.5 min-w-0 sm:mr-auto"
            :class="
              testResult.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-500 dark:text-red-400'
            "
          >
            <Check v-if="testResult.ok" class="w-3.5 h-3.5 shrink-0" />
            <X v-else class="w-3.5 h-3.5 shrink-0" />
            <span class="break-all">{{ testResult.message }}</span>
          </p>
          <Button
            variant="secondary"
            type="button"
            :icon-left="Zap"
            :loading="testing"
            @click="testConnection"
          >
            {{ $t('providerSettings.testConnection') }}
          </Button>
          <Button variant="secondary" type="button" @click="showForm = false">
            {{ $t('providerSettings.cancel') }}
          </Button>
          <Button type="submit" :icon-left="Check" :loading="saving">
            {{
              isEditing
                ? $t('providerSettings.saveChanges')
                : $t('providerSettings.saveConnection')
            }}
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
