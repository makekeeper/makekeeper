<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { TriangleAlert } from '@lucide/vue';
import {
  PHONE_BRIDGE_UPDATE_EVENT,
  phoneBridgeRoom,
  type PhoneBridgeContext,
  type CreatePhoneBridgeSessionResponse,
  isPhoneBridgeResultsResponse,
  isCreatePhoneBridgeSessionResponse,
} from '@makekeeper/plugin-contract';
import { apiFetch } from '../api';
import { useRealtime } from '../realtime';
import Button from './Button.vue';
import CopyableLink from './CopyableLink.vue';
import Modal from './Modal.vue';
import QrCode from './QrCode.vue';
import Spinner from './Spinner.vue';

// Desktop "connect from phone" primitive (#77, generalized from the capture
// flow's CaptureButton). Renders ONLY the QR modal and exposes open()/isActive,
// so a consumer plugin drops it into whatever trigger it owns (a chat-composer
// menu row, an import card, …). It opens a bridge session for the given
// `context.kind`, warms a tunnel if needed, shows the QR, auto-closes once the
// phone connects, then streams each relayed message's `data` up via @message —
// push-first (realtime nudge on room `phone-bridge:<token>`) with a slow poll
// fallback sharing one cursor dedup path.

const POLL_INTERVAL_MS = 15000;

const props = defineProps<{ context: PhoneBridgeContext }>();
const emit = defineEmits<{ (e: 'message', data: unknown): void }>();

const { t } = useI18n();
const router = useRouter();

type Phase = 'creating' | 'warmup' | 'ready';

const isModalOpen = ref(false);
const phase = ref<Phase>('creating');
const warmupLeft = ref(0);
const session = ref<CreatePhoneBridgeSessionResponse | null>(null);
const errorKey = ref<string | null>(null);
// True while the phone is connected and the session is live (background poll
// running) — drives a pulsing icon so the user sees the link is active.
const isActive = ref(false);

const realtime = useRealtime();
let subscribedRoom: string | null = null;

let cursor = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let warmupTimer: ReturnType<typeof setInterval> | null = null;

// A phone cannot use this address: a local host is unreachable from the phone,
// and a non-HTTPS address blocks the camera (getUserMedia needs a secure
// context). When either holds, scanning can't start — we replace the (useless)
// QR with an actionable notice pointing at the tunnel setting / PUBLIC_BASE_URL.
const urlIssueKey = computed<string | null>(() => {
  const u = session.value?.url ?? '';
  if (/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(u)) {
    return 'phoneBridge.desktop.localWarning';
  }
  if (u.startsWith('http://')) return 'phoneBridge.desktop.insecureWarning';
  return null;
});

const onRealtimeUpdate = (): void => {
  poll().catch(() => undefined);
};

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (subscribedRoom) {
    realtime.unsubscribe(subscribedRoom);
    realtime.off(PHONE_BRIDGE_UPDATE_EVENT, onRealtimeUpdate);
    subscribedRoom = null;
  }
};

const clearWarmup = (): void => {
  if (warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
};

const startPolling = (): void => {
  stopPolling();
  const token = session.value?.token;
  if (token) {
    subscribedRoom = phoneBridgeRoom(token);
    realtime.subscribe(subscribedRoom);
    realtime.on(PHONE_BRIDGE_UPDATE_EVENT, onRealtimeUpdate);
  }
  pollTimer = setInterval(() => {
    poll().catch(() => undefined);
  }, POLL_INTERVAL_MS);
  // First pass immediately — setInterval alone would wait a full period.
  poll().catch(() => undefined);
};

const poll = async (): Promise<void> => {
  const token = session.value?.token;
  if (!token) return;
  const res = await apiFetch(
    `/api/phone-bridge/sessions/${token}/results?since=${encodeURIComponent(cursor)}`,
  ).catch(() => null);
  if (!res || !res.ok) return;
  const data: unknown = await res.json().catch(() => null);
  if (!isPhoneBridgeResultsResponse(data)) return;
  for (const message of data.messages) emit('message', message.data);
  cursor = data.cursor;

  // The phone has opened the link — the QR is no longer needed. Hide the modal,
  // but keep polling in the background so messages still reach the host, and
  // mark the session active so the trigger icon pulses.
  if (data.status === 'active') {
    if (isModalOpen.value) isModalOpen.value = false;
    isActive.value = true;
  }

  // The phone finished (or the session expired) — stop the background poll.
  if (data.status === 'closed' || data.status === 'expired') {
    isActive.value = false;
    stopPolling();
  }
};

const open = async (): Promise<void> => {
  stopPolling();
  clearWarmup();
  isModalOpen.value = true;
  isActive.value = false;
  phase.value = 'creating';
  errorKey.value = null;
  cursor = '';
  session.value = null;

  let data: CreatePhoneBridgeSessionResponse;
  try {
    const res = await apiFetch('/api/phone-bridge/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The desktop's own origin is the ground truth for how the app is
      // publicly reached; the backend trusts it over forwarded headers and can
      // skip the tunnel when we are already on HTTPS (#93).
      body: JSON.stringify({
        context: props.context,
        origin: window.location.origin,
      }),
    });
    if (!res.ok) {
      errorKey.value = 'phoneBridge.desktop.createFailed';
      return;
    }
    const body: unknown = await res.json().catch(() => null);
    if (!isCreatePhoneBridgeSessionResponse(body)) {
      errorKey.value = 'phoneBridge.desktop.createFailed';
      return;
    }
    data = body;
  } catch {
    errorKey.value = 'phoneBridge.desktop.createFailed';
    return;
  }
  session.value = data;

  if (data.warmupSeconds > 0) {
    phase.value = 'warmup';
    warmupLeft.value = data.warmupSeconds;
    warmupTimer = setInterval(() => {
      warmupLeft.value -= 1;
      if (warmupLeft.value <= 0) {
        clearWarmup();
        phase.value = 'ready';
        startPolling();
      }
    }, 1000);
  } else {
    phase.value = 'ready';
    startPolling();
  }
};

// Re-point the LIVE session at the host's current context (#79) instead of
// closing it: the phone stays on its page, camera up, and picks the new label
// and actions up on its next read. A dead session simply reports failure — the
// caller then decides whether to open a fresh one.
const updateContext = async (): Promise<boolean> => {
  const token = session.value?.token;
  if (!token) return false;
  const res = await apiFetch(`/api/phone-bridge/sessions/${token}/context`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contextLabel: props.context.contextLabel,
      data: props.context.data,
    }),
  }).catch(() => null);
  return Boolean(res?.ok);
};

// User dismissed the modal before the phone opened the link — end the session.
const cancel = async (): Promise<void> => {
  stopPolling();
  clearWarmup();
  const token = session.value?.token;
  isModalOpen.value = false;
  isActive.value = false;
  session.value = null;
  if (token) {
    await apiFetch(`/api/phone-bridge/sessions/${token}/close`, {
      method: 'POST',
    }).catch(() => undefined);
  }
};

// From the "can't scan" notice: close the session/modal and take the user to
// Settings, where the tunnel (or PUBLIC_BASE_URL guidance) lives. The tunnel
// panel is admin-only, so a non-admin lands on Settings without it — the copy
// still explains the PUBLIC_BASE_URL / reverse-proxy remedy.
const goToSettings = async (): Promise<void> => {
  await cancel();
  // The query names the phone-bridge section of the settings host, which opens
  // it directly (the tunnel config lives there). It used to be a
  // `#settings-phone-bridge` hash the host expanded and scrolled to; the host
  // is a section layout now and still redirects that form (#266).
  router
    .push({ name: 'settings', query: { section: 'phone-bridge' } })
    .catch(() => undefined);
};

onBeforeUnmount(() => {
  stopPolling();
  clearWarmup();
});

// The host drives the flow from its own trigger and reads `isActive` to show a
// live indicator — this component renders only the modal. `end()` closes the
// session from the desktop side (e.g. once a relayed scan has been acted on),
// so a consumer doesn't have to close from the phone and race message delivery.
defineExpose({ open, isActive, end: cancel, updateContext });
</script>

<template>
  <!-- The dialog chrome is the shared primitive's, not this component's: the
       hand-rolled overlay/panel it used to carry drifted from every other modal
       in the app — a different backdrop and frame from the sibling "pair a
       phone" dialog, which is the same gesture one plugin over (#271). -->
  <!-- `confirm` rung, not the default one: a host plugin embeds the trigger
       inside its own dialog (the logistics order-import modal), so this one has
       to cover a modal rather than tie with it — which is what the hand-rolled
       overlay's z-[60] was buying. -->
  <Modal
    :model-value="isModalOpen"
    :title="t('phoneBridge.desktop.title')"
    layer="confirm"
    @update:model-value="cancel"
  >
    <div class="space-y-4">
      <!-- Error -->
      <div
        v-if="errorKey"
        class="py-8 text-center text-sm text-red-500 dark:text-red-400"
      >
        {{ t(errorKey) }}
      </div>

      <!-- Progress: creating the session / warming up the tunnel -->
      <div
        v-else-if="phase === 'creating' || phase === 'warmup'"
        class="flex flex-col items-center justify-center gap-3 py-10 text-center"
      >
        <Spinner />
        <span class="text-xs text-slate-500 dark:text-slate-400">
          {{
            phase === 'warmup'
              ? t('phoneBridge.desktop.warmup', { seconds: warmupLeft })
              : t('phoneBridge.desktop.creating')
          }}
        </span>
        <p
          v-if="phase === 'warmup'"
          class="text-xxs text-slate-400 dark:text-slate-500 max-w-[15rem]"
        >
          {{ t('phoneBridge.desktop.warmupNote') }}
        </p>
      </div>

      <template v-else-if="session">
        <!-- Can't scan: the address is unreachable/insecure for a phone.
               Replace the useless QR with an actionable notice + settings link. -->
        <div
          v-if="urlIssueKey"
          class="flex flex-col items-center gap-3 py-6 text-center"
        >
          <div
            class="flex items-center justify-center w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-500/15"
          >
            <TriangleAlert class="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {{ t('phoneBridge.desktop.cannotScanTitle') }}
          </p>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-[18rem]">
            {{ t(urlIssueKey) }}
          </p>
          <Button variant="secondary" size="sm" @click="goToSettings">
            {{ t('phoneBridge.desktop.openSettings') }}
          </Button>
        </div>

        <!-- Ready: the QR to scan -->
        <template v-else>
          <p class="text-xs text-slate-500 dark:text-slate-400 text-center">
            {{ t('phoneBridge.desktop.scanHint') }}
          </p>
          <div class="flex justify-center">
            <!-- Sized generously on purpose: a camera can only resolve what
                   the screen draws, and the branded code needs more pixels per
                   module than a plain one (#263). No `rounded-*` here — the code
                   draws its own plate, and an inline SVG ignores border-radius
                   anyway. -->
            <QrCode :value="session.url" class="w-64 h-64" />
          </div>
          <CopyableLink
            :url="session.url"
            :hint="t('phoneBridge.desktop.linkHint')"
          />
          <!-- A session dies on its own clock, so the dialog says when — the
               same last line its sibling pairing dialog ends on. Without it a
               code left on screen looks equally good an hour later. -->
          <p class="text-xs text-slate-500 dark:text-slate-400 text-center">
            {{
              t('common.validUntil', {
                when: new Date(session.expiresAt).toLocaleTimeString(),
              })
            }}
          </p>
        </template>
      </template>
    </div>
  </Modal>
</template>
