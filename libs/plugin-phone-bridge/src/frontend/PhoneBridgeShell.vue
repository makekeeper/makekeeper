<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  apiFetch,
  PluginSlot,
  getSlotContributions,
  usePluginsStore,
  setRealtimeGuestToken,
  reconnectRealtime,
  useRealtime,
} from '@makekeeper/frontend-core';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Loader, AlertTriangle } from '@lucide/vue';
import type { PhoneBridgeMessage } from '@makekeeper/plugin-contract';
import {
  PHONE_BRIDGE_UPDATE_EVENT,
  phoneBridgeRoom,
  isPhoneBridgeMessage,
  isPhoneBridgeSessionInfo,
} from '@makekeeper/plugin-contract';

// The phone-side shell (#77), mounted full-screen at /d/:token. It validates the
// token, then renders the surface a consumer plugin contributed for the
// session's `kind` (slot `phone-bridge.surface.<kind>`), handing it a thin relay
// API. The bridge owns the handshake; the surface owns the camera/scanner UI and
// what it relays. The phone carries no user token — the session token IS the auth.

const route = useRoute();
const { t } = useI18n();

type Phase = 'checking' | 'invalid' | 'ready';

const phase = ref<Phase>('checking');
const kind = ref<string>('');
const contextLabel = ref<string>('');
const sessionData = ref<unknown>(undefined);

const token = computed<string>(() =>
  typeof route.params.token === 'string' ? route.params.token : '',
);

// The surface registered for this session's kind (empty when the consumer plugin
// is disabled/absent — then there is nothing to render). Computed reactively
// because `kind` is only known after the token check resolves — a fixed
// useSlotContributions(slotName) would capture the empty pre-fetch slot name.
const plugins = usePluginsStore();
const slotName = computed<string>(() => `phone-bridge.surface.${kind.value}`);
const surfaces = computed(() =>
  kind.value
    ? getSlotContributions(slotName.value).filter((c) =>
        plugins.isEnabled(c.pluginId),
      )
    : [],
);

// Relay one payload to the bridge; returns the echoed message (a thumbnail ref,
// …) or null. A 410 means the session ended — flip to the invalid screen.
const submit = async (payload: unknown): Promise<PhoneBridgeMessage | null> => {
  const res = await apiFetch(
    `/api/phone-bridge/sessions/${token.value}/messages`,
    {
      method: 'POST',
      public: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    },
  ).catch(() => null);
  if (!res) return null;
  if (res.status === 410) {
    phase.value = 'invalid';
    return null;
  }
  if (!res.ok) return null;
  // The echo is either a message envelope or null; anything else is untrusted noise.
  const body: unknown = await res.json().catch(() => null);
  return isPhoneBridgeMessage(body) ? body : null;
};

const close = async (): Promise<void> => {
  await apiFetch(`/api/phone-bridge/sessions/${token.value}/close`, {
    method: 'POST',
    public: true,
  }).catch(() => undefined);
};

// When the phone tab is closed / navigated away, tell the bridge so the desktop
// stops waiting (otherwise its live indicator spins until the session TTL). A
// beacon survives the unload where a normal fetch would be cancelled;
// `closeSession` nudges the desktop's realtime room, so it reacts at once. We
// skip bfcache freezes (`persisted`) — a brief mobile app-switch shouldn't kill
// a session the user is about to return to.
const onPageHide = (event: PageTransitionEvent): void => {
  if (event.persisted || !token.value) return;
  const url = `/api/phone-bridge/sessions/${token.value}/close`;
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(url);
  } else {
    void close();
  }
};

onMounted(() => window.addEventListener('pagehide', onPageHide));
onBeforeUnmount(() => window.removeEventListener('pagehide', onPageHide));

const slotCtx = computed(() => ({
  token: token.value,
  contextLabel: contextLabel.value,
  // The desktop's surface-specific bootstrap data (#79), handed over verbatim —
  // the shell never interprets it; the surface narrows it with its own guard.
  data: sessionData.value,
  submit,
  close,
}));

// Re-read the session and apply whatever the desktop changed (#79): the label
// and the surface data, or the fact that it is over. The surface sees the new
// values through its ctx props, so a retarget needs no re-pairing — the phone
// stays on this page with the camera up.
const syncSession = async (): Promise<boolean> => {
  const res = await apiFetch(`/api/phone-bridge/sessions/${token.value}`, {
    public: true,
  }).catch(() => null);
  if (!res || !res.ok) {
    phase.value = 'invalid';
    return false;
  }
  const info: unknown = await res.json().catch(() => null);
  if (!isPhoneBridgeSessionInfo(info)) {
    phase.value = 'invalid';
    return false;
  }
  kind.value = info.kind;
  contextLabel.value = info.contextLabel ?? '';
  sessionData.value = info.data;
  if (info.status === 'expired' || info.status === 'closed') {
    phase.value = 'invalid';
    return false;
  }
  phase.value = 'ready';
  return true;
};

// Push, not polling: the phone joins its own bridge room as a realtime GUEST
// (its session token is the credential — it has no user account) and re-reads
// the session on every nudge, so a retarget or an end from the desktop lands
// immediately.
//
// A timer runs ONLY while the socket is down. That is the case realtime.ts warns
// about — every consumer must keep working with the socket dead — and here it is
// the worst failure this screen has: a phone still filing into a session the
// desktop already ended. So it is a fallback in the literal sense: connected ⇒
// zero periodic requests; disconnected ⇒ a modest heartbeat until push is back.
const SYNC_FALLBACK_MS = 5000;
const realtime = useRealtime();
let syncTimer: ReturnType<typeof setInterval> | null = null;
let joinedRoom: string | null = null;

const onBridgeUpdate = (): void => {
  void syncSession();
};

const stopFallback = (): void => {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
};

// Follow the socket: drop the heartbeat the moment push is available, bring it
// back if the connection dies. Re-reading once on (re)connect closes the gap for
// anything that happened while the socket was away.
watch(
  () => realtime.connected.value,
  (isConnected) => {
    if (isConnected) {
      stopFallback();
      onBridgeUpdate();
    } else if (!syncTimer) {
      syncTimer = setInterval(onBridgeUpdate, SYNC_FALLBACK_MS);
    }
  },
);

// A backgrounded tab's timers are throttled to a crawl and its socket may be
// frozen, so re-read the moment the user looks at the phone again. Event-driven,
// costs nothing while nothing happens.
const onVisible = (): void => {
  if (document.visibilityState === 'visible') onBridgeUpdate();
};

onMounted(async () => {
  if (!(await syncSession())) return;
  document.addEventListener('visibilitychange', onVisible);
  setRealtimeGuestToken(token.value);
  // The handshake credentials are read once per connection: if anything on this
  // page already opened the socket (it would have connected anonymously, or been
  // rejected outright while multiuser is on), force a fresh handshake now that
  // the guest token exists — otherwise the phone silently never gets push.
  reconnectRealtime();
  joinedRoom = phoneBridgeRoom(token.value);
  realtime.subscribe(joinedRoom);
  realtime.on(PHONE_BRIDGE_UPDATE_EVENT, onBridgeUpdate);
  // Cover the window before the socket's first connect (and the case where it
  // never comes); the watcher above drops this again as soon as push works.
  if (!realtime.connected.value) {
    syncTimer = setInterval(onBridgeUpdate, SYNC_FALLBACK_MS);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible);
  stopFallback();
  if (joinedRoom) {
    realtime.unsubscribe(joinedRoom);
    realtime.off(PHONE_BRIDGE_UPDATE_EVENT, onBridgeUpdate);
  }
  setRealtimeGuestToken(null);
});
</script>

<template>
  <div
    class="fixed inset-0 flex flex-col bg-slate-950 text-slate-100 select-none"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-4 h-14 border-b border-white/10 shrink-0"
    >
      <span class="text-sm font-semibold">{{ t('phoneBridge.title') }}</span>
      <span
        v-if="contextLabel"
        class="text-xs text-slate-400 truncate max-w-[55%]"
      >
        {{ t('phoneBridge.attachingTo', { target: contextLabel }) }}
      </span>
    </div>

    <!-- Checking -->
    <div
      v-if="phase === 'checking'"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400"
    >
      <Loader class="w-8 h-8 animate-spin" />
      <span class="text-sm">{{ t('phoneBridge.checking') }}</span>
    </div>

    <!-- Invalid / expired / no surface -->
    <div
      v-else-if="phase === 'invalid' || surfaces.length === 0"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"
    >
      <AlertTriangle class="w-10 h-10 text-amber-400" />
      <p class="text-sm text-slate-300">
        {{ t('phoneBridge.invalid') }}
      </p>
    </div>

    <!-- The consumer's phone surface for this kind -->
    <PluginSlot v-else :name="slotName" :ctx="slotCtx" />
  </div>
</template>
