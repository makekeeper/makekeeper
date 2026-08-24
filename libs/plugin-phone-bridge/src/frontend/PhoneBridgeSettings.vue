<script setup lang="ts">
import {
  computed,
  onMounted,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  ref,
} from 'vue';
import {
  apiFetch,
  Button,
  SegmentedControl,
  onReactivated,
  useToastStore,
} from '@makekeeper/frontend-core';
import type { SegmentedOption } from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import {
  Play,
  Square,
  Download,
  Trash2,
  Globe,
  CheckCircle,
  XCircle,
  Save,
  Activity,
  Zap,
  Power,
} from '@lucide/vue';
import type {
  PhoneBridgeSettingsPublic,
  TunnelMode,
  TunnelState,
  TunnelStatus,
} from '@makekeeper/plugin-contract';
import {
  isPhoneBridgeSettingsPublic,
  isTunnelMode,
  isTunnelStatus,
} from '@makekeeper/plugin-contract';

// Settings surface for the phone-bridge plugin (#77). Three clear groups: the
// tunnel Mode, the live Connection status/controls, and the Cloudflared binary
// (install state + one-click download + optional custom path).

const { t } = useI18n();
const toast = useToastStore();

const STATUS_POLL_MS = 3000;

const mode = ref<TunnelMode>('off');
const cloudflaredPath = ref<string>('');
const idleTtl = ref<number>(5);
const status = ref<TunnelStatus | null>(null);
const isSavingPath = ref(false);
// Which manual control is in flight, so only that button spins.
const controlAction = ref<'start' | 'stop' | null>(null);
// Which binary action (download/delete) is running, so only that button spins.
const binaryAction = ref<'download' | 'delete' | null>(null);
// Persistent result shown to the right of the Download / Delete buttons.
const binaryResult = ref<{ tone: 'ok' | 'error'; key: string } | null>(null);

// Three-position segmented control (On / Auto / Off). Icons are static; the
// label re-resolves through t() when the locale changes.
const MODE_ICONS = { on: Activity, auto: Zap, off: Power } satisfies Record<
  TunnelMode,
  typeof Activity
>;
const MODE_ORDER: readonly TunnelMode[] = ['on', 'auto', 'off'];
const modeSegments = computed<SegmentedOption<TunnelMode>[]>(() =>
  MODE_ORDER.map((value) => ({
    value,
    label: t(`phoneBridge.settings.modes.${value}`),
    icon: MODE_ICONS[value],
  })),
);

// Active-segment tint per mode: on = green (always up), auto = brand blue,
// off = red (disabled). The unselected segments share the muted style.
const activeSegClass: Record<TunnelMode, string> = {
  on: 'bg-emerald-500 text-white shadow-sm',
  auto: 'bg-brand-500 text-white shadow-sm',
  off: 'bg-red-500 text-white shadow-sm',
};

// The mode currently being applied (null when idle). `on` blocks until the
// tunnel has actually started (the backend awaits the launch), so we spin the
// target segment and freeze the control meanwhile.
const switchingTo = ref<TunnelMode | null>(null);

const isRunning = computed<boolean>(() => status.value?.state === 'running');
const isStarting = computed<boolean>(() => status.value?.state === 'starting');
const binaryPresent = computed<boolean>(
  () => status.value?.binaryPresent === true,
);
// `off` mode dims the live Connection group (nothing to run/control).
const controlsDisabled = computed<boolean>(() => mode.value === 'off');
// The idle-TTL only applies to Auto mode; elsewhere it stays visible but inert.
const idleDisabled = computed<boolean>(() => mode.value !== 'auto');

let pollTimer: ReturnType<typeof setInterval> | null = null;

const stateLabel = computed<string>(() => {
  const s: TunnelState = status.value?.state ?? 'disabled';
  return t(`phoneBridge.settings.states.${s}`);
});

const stateColor = computed<string>(() => {
  switch (status.value?.state) {
    case 'running':
      return 'text-emerald-500 dark:text-emerald-400';
    case 'starting':
      return 'text-amber-500 dark:text-amber-400';
    case 'error':
      return 'text-red-500 dark:text-red-400';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
});

const applyStatus = (body: unknown): void => {
  if (isTunnelStatus(body)) status.value = body;
};

const applySettings = (body: unknown): void => {
  if (!isPhoneBridgeSettingsPublic(body)) return;
  mode.value = body.tunnelMode;
  cloudflaredPath.value = body.cloudflaredPath ?? '';
  idleTtl.value = body.tunnelIdleTtlMinutes;
};

const refreshStatus = async (): Promise<void> => {
  const res = await apiFetch('/api/phone-bridge/tunnel').catch(() => null);
  if (res && res.ok) applyStatus(await res.json().catch(() => null));
};

const loadSettings = async (): Promise<void> => {
  const res = await apiFetch('/api/phone-bridge/settings').catch(() => null);
  if (res && res.ok) applySettings(await res.json().catch(() => null));
  await refreshStatus();
};

const patchSettings = async (
  patch: Partial<PhoneBridgeSettingsPublic>,
): Promise<boolean> => {
  const res = await apiFetch('/api/phone-bridge/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => null);
  const ok = res?.ok === true;
  if (ok) applySettings(await res.json().catch(() => null));
  await refreshStatus();
  return ok;
};

// `SegmentedControl` widens its emitted value to `string`, so narrow it back
// through the contract guard rather than casting.
const onModeChange = async (value: string): Promise<void> => {
  if (!isTunnelMode(value)) return;
  const next = value;
  const prev = mode.value;
  if (next === prev || switchingTo.value !== null) return;
  // Highlight the choice at once — for `on` the request blocks until the tunnel
  // has started, and waiting for that to paint the selection feels unresponsive.
  mode.value = next;
  switchingTo.value = next;
  try {
    const ok = await patchSettings({ tunnelMode: next });
    if (!ok) {
      mode.value = prev; // roll back an optimistic switch that failed
      toast.error(t('phoneBridge.settings.toast.saveFailed'));
    }
  } finally {
    switchingTo.value = null;
  }
};

const saveIdleTtl = async (): Promise<void> => {
  const clamped = Math.min(1440, Math.max(1, Math.round(idleTtl.value || 5)));
  idleTtl.value = clamped;
  const ok = await patchSettings({ tunnelIdleTtlMinutes: clamped });
  toast[ok ? 'success' : 'error'](
    t(
      ok
        ? 'phoneBridge.settings.toast.saved'
        : 'phoneBridge.settings.toast.saveFailed',
    ),
  );
};

const savePath = async (): Promise<void> => {
  isSavingPath.value = true;
  try {
    const ok = await patchSettings({
      cloudflaredPath: cloudflaredPath.value.trim(),
    });
    toast[ok ? 'success' : 'error'](
      t(
        ok
          ? 'phoneBridge.settings.toast.saved'
          : 'phoneBridge.settings.toast.saveFailed',
      ),
    );
  } finally {
    isSavingPath.value = false;
  }
};

const control = async (action: 'start' | 'stop'): Promise<void> => {
  controlAction.value = action;
  try {
    const res = await apiFetch(`/api/phone-bridge/tunnel/${action}`, {
      method: 'POST',
    }).catch(() => null);
    const ok = res?.ok === true;
    if (ok) applyStatus(await res.json().catch(() => null));
    else {
      await refreshStatus();
      toast.error(t('phoneBridge.settings.toast.controlFailed'));
    }
  } finally {
    controlAction.value = null;
  }
};

// Explicit key map — the verb forms are irregular (download→downloaded,
// delete→deleted), so building keys by concatenation would break.
const BINARY_RESULT_KEYS = {
  download: {
    ok: 'downloadedOk',
    error: 'downloadedError',
    toastOk: 'downloadDone',
    toastError: 'downloadFailed',
  },
  delete: {
    ok: 'deletedOk',
    error: 'deletedError',
    toastOk: 'deleteDone',
    toastError: 'deleteFailed',
  },
} as const;

// How long the inline result stays before fading out (transient, like a toast).
const RESULT_TIMEOUT_MS = 4000;
let resultTimer: ReturnType<typeof setTimeout> | null = null;

// Download/delete the managed cloudflared binary. Outcome is surfaced via the
// button spinner, a toast, a transient inline result next to the buttons, and the
// install-state row updating.
const runBinaryAction = async (
  action: 'download' | 'delete',
): Promise<void> => {
  binaryAction.value = action;
  binaryResult.value = null;
  if (resultTimer) clearTimeout(resultTimer);
  try {
    const res = await apiFetch(`/api/phone-bridge/tunnel/${action}`, {
      method: 'POST',
    }).catch(() => null);
    const ok = res?.ok === true;
    if (ok) applyStatus(await res.json().catch(() => null));
    else await refreshStatus();
    const keys = BINARY_RESULT_KEYS[action];
    binaryResult.value = {
      tone: ok ? 'ok' : 'error',
      key: `phoneBridge.settings.${ok ? keys.ok : keys.error}`,
    };
    toast[ok ? 'success' : 'error'](
      t(`phoneBridge.settings.toast.${ok ? keys.toastOk : keys.toastError}`),
    );
    resultTimer = setTimeout(() => {
      binaryResult.value = null;
      resultTimer = null;
    }, RESULT_TIMEOUT_MS);
  } finally {
    binaryAction.value = null;
  }
};

const downloadBinary = (): Promise<void> => runBinaryAction('download');
const deleteBinaryFile = (): Promise<void> => runBinaryAction('delete');

// The tunnel status poll runs only while this panel is on screen. Settings is
// a section layout now (#266) and keeps its panes alive, so a panel that is
// merely closed is never unmounted — a poll started on mount would keep asking
// the backend for a tunnel nobody is looking at, forever.
const startPolling = (): void => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    refreshStatus().catch(() => undefined);
  }, STATUS_POLL_MS);
};

const stopPolling = (): void => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

onMounted(async () => {
  await loadSettings();
  startPolling();
});
onActivated(startPolling);
// Coming BACK to the section: the status on screen is as old as the moment it
// was left, so it is refreshed once rather than waited for. Skipped on the
// first activation, which is the mount that just loaded it.
onReactivated(() => {
  refreshStatus().catch(() => undefined);
});
onDeactivated(stopPolling);
onBeforeUnmount(() => {
  stopPolling();
  if (resultTimer) clearTimeout(resultTimer);
});
</script>

<template>
  <div class="space-y-6">
    <!-- Static, translator-authored copy with an inline link — rendered like
         the provider guides in plugin-chat (HTML in the i18n string). -->
    <p
      class="text-xs text-slate-500 dark:text-slate-400"
      v-html="t('phoneBridge.settings.intro')"
    ></p>

    <!-- ── Mode ─────────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <label
        class="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {{ t('phoneBridge.settings.modeLabel') }}
      </label>
      <SegmentedControl
        :model-value="mode"
        :options="modeSegments"
        :aria-label="t('phoneBridge.settings.modeLabel')"
        :active-class="activeSegClass"
        :busy-value="switchingTo"
        size="lg"
        full-width
        @change="onModeChange"
      />
      <p class="text-xxs text-slate-400 dark:text-slate-500">
        {{ t(`phoneBridge.settings.modeHints.${mode}`) }}
      </p>
    </section>

    <!-- ── Connection ───────────────────────────────────────────────────── -->
    <section
      class="space-y-2 transition-opacity"
      :class="
        controlsDisabled ? 'opacity-50 pointer-events-none select-none' : ''
      "
      :aria-disabled="controlsDisabled"
    >
      <h3
        class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {{ t('phoneBridge.settings.sectionConnection') }}
      </h3>
      <div class="glass-card rounded-2xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-slate-700 dark:text-slate-300">
            {{ t('phoneBridge.settings.statusLabel') }}
          </span>
          <span
            class="flex items-center gap-1.5 text-sm font-semibold"
            :class="stateColor"
          >
            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            {{ stateLabel }}
          </span>
        </div>
        <a
          v-if="status?.url"
          :href="status.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 break-all text-xs text-brand-600 hover:underline dark:text-brand-400"
        >
          <Globe class="h-3.5 w-3.5 shrink-0" />{{ status.url }}
        </a>
        <div class="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            :icon-left="Play"
            :loading="controlAction === 'start'"
            :disabled="
              controlAction !== null ||
              switchingTo !== null ||
              isRunning ||
              isStarting ||
              !binaryPresent
            "
            @click="control('start')"
          >
            {{ t('phoneBridge.settings.start') }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :icon-left="Square"
            :loading="controlAction === 'stop'"
            :disabled="
              controlAction !== null ||
              switchingTo !== null ||
              (!isRunning && !isStarting)
            "
            @click="control('stop')"
          >
            {{ t('phoneBridge.settings.stop') }}
          </Button>
        </div>

        <!-- Idle timeout — Auto only; stays visible but disabled otherwise. -->
        <div
          class="space-y-2 border-t border-slate-200 pt-3 transition-opacity dark:border-white/10"
          :class="idleDisabled ? 'opacity-50 select-none' : ''"
          :aria-disabled="idleDisabled"
        >
          <label
            for="pb-idle-ttl"
            class="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            {{ t('phoneBridge.settings.idleTtlLabel') }}
          </label>
          <div class="flex items-center gap-2">
            <input
              id="pb-idle-ttl"
              v-model.number="idleTtl"
              type="number"
              min="1"
              max="1440"
              :disabled="idleDisabled"
              class="w-24 glass-input rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed"
              @change="saveIdleTtl"
            />
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{ t('phoneBridge.settings.idleTtlUnit') }}
            </span>
          </div>
          <p class="text-xxs text-slate-400 dark:text-slate-500">
            {{ t('phoneBridge.settings.idleTtlHint') }}
          </p>
        </div>
      </div>
    </section>

    <!-- ── Cloudflared binary ───────────────────────────────────────────── -->
    <section class="space-y-2">
      <h3
        class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {{ t('phoneBridge.settings.sectionBinary') }}
      </h3>
      <div class="glass-card rounded-2xl p-4 space-y-4">
        <!-- Install state — label left, status right (mirrors Connection). -->
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-slate-700 dark:text-slate-300">
            {{ t('phoneBridge.settings.statusLabel') }}
          </span>
          <span
            class="flex items-center gap-1.5 text-sm font-semibold"
            :class="
              binaryPresent
                ? 'text-emerald-500 dark:text-emerald-400'
                : 'text-amber-500 dark:text-amber-400'
            "
          >
            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            {{
              binaryPresent
                ? t('phoneBridge.settings.binaryInstalled')
                : t('phoneBridge.settings.binaryNotFound')
            }}
          </span>
        </div>

        <!-- Install / Delete, with the result shown to their right -->
        <div class="space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              :variant="binaryPresent ? 'secondary' : 'primary'"
              :icon-left="Download"
              :loading="binaryAction === 'download'"
              :disabled="binaryAction !== null"
              @click="downloadBinary"
            >
              {{ t('phoneBridge.settings.download') }}
            </Button>
            <Button
              size="sm"
              variant="danger"
              :icon-left="Trash2"
              :loading="binaryAction === 'delete'"
              :disabled="binaryAction !== null || !status?.managedBinaryPresent"
              @click="deleteBinaryFile"
            >
              {{ t('phoneBridge.settings.delete') }}
            </Button>
            <span
              v-if="binaryResult"
              class="flex items-center gap-1 text-xxs"
              :class="
                binaryResult.tone === 'ok'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              "
            >
              <CheckCircle
                v-if="binaryResult.tone === 'ok'"
                class="h-3 w-3 shrink-0"
              />
              <XCircle v-else class="h-3 w-3 shrink-0" />
              {{ t(binaryResult.key) }}
            </span>
          </div>
          <p class="break-all text-xxs text-slate-400 dark:text-slate-500">
            {{
              t('phoneBridge.settings.binaryPathValue', {
                path:
                  binaryPresent && status?.binaryPath
                    ? status.binaryPath
                    : t('phoneBridge.settings.binaryNotFound'),
              })
            }}
          </p>
        </div>

        <!-- Custom path (optional) -->
        <div
          class="space-y-1.5 border-t border-slate-200 pt-3 dark:border-white/10"
        >
          <label
            for="pb-binary-path"
            class="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            {{ t('phoneBridge.settings.binaryPathLabel') }}
          </label>
          <div class="flex items-center gap-2">
            <input
              id="pb-binary-path"
              v-model="cloudflaredPath"
              type="text"
              :placeholder="t('phoneBridge.settings.binaryPathPlaceholder')"
              class="flex-1 glass-input rounded-xl px-3 py-2 text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              :icon-left="Save"
              :loading="isSavingPath"
              @click="savePath"
            >
              {{ t('common.save') }}
            </Button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
