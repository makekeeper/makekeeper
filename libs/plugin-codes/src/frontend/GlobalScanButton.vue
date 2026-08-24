<script setup lang="ts">
// The app-header scan button (#74) AND the single host of the live scan session
// (#79): contributed into the app-owned `app.header.scan` slot, it stays mounted
// for the whole desktop shell, so a session survives navigation. A contextual
// trigger elsewhere (a storage cell) only DESCRIBES the session it wants through
// `useScanSessionStore`; this owns the bridge modal, the polling and the
// dispatch. With no request it keeps its own behaviour: resolve the scanned code
// and navigate to the object it names.
//
// While a session is live the icon spins and clicking ends it — the same "Done"
// affordance the contextual trigger shows, always reachable from the header.
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PhoneBridgeContext } from '@makekeeper/plugin-contract';
import { PhoneBridgeModal } from '@makekeeper/frontend-core';
import { ScanLine, Loader } from '@lucide/vue';
import { useScanResolve } from './useScanResolve';
import { useScanBridge } from './useScanBridge';
import { useScanSessionStore } from './scan-session';
import { useScanEndConfirm } from './useScanEndConfirm';

const { t } = useI18n();
const { resolveRef, resolveAndGo } = useScanResolve();
const session = useScanSessionStore();
const confirmEnd = useScanEndConfirm();

// The session's phone-side context: a contextual request supplies the label and
// the actions the phone offers; a bare global scan supplies neither.
const context = computed<PhoneBridgeContext>(() => ({
  kind: 'scan',
  contextLabel: session.request?.contextLabel ?? t('codes.scan.title'),
  data: { actions: session.request?.actions ?? [] },
}));

const { modalRef, active, onMessage, openScan, endSession } = useScanBridge(
  (value, actionKey) => {
    const handler = session.request?.handler;
    if (handler) {
      // codes owns resolution, so the requester gets a canonical ORef.
      void resolveRef(value).then((ref) => handler(ref, actionKey, value));
    } else {
      void resolveAndGo(value).finally(endSession);
    }
  },
);

// `post` flush matters: the request is set in the same tick as the nonce, and
// the modal reads `context` from its props — opening before the re-render would
// create the session with the previous context.
watch(
  () => session.openNonce,
  () => openScan(),
  { flush: 'post' },
);
watch(
  () => session.closeNonce,
  () => endSession(),
);
// Re-point the live session instead of re-pairing. If the bridge says the
// session is gone (expired, or the phone closed it), fall back to opening a
// fresh one so the click still does what the user asked for.
watch(
  () => session.retargetNonce,
  async () => {
    const updated = await modalRef.value?.updateContext();
    if (!updated) openScan();
  },
  { flush: 'post' },
);
// Mirror the live flag back so every trigger can spin, and forget the request
// once the session is over (ended, expired, or closed from the phone).
watch(active, (isActive) => {
  session.active = isActive;
  if (!isActive) session.clear();
});

const onClick = async (): Promise<void> => {
  if (active.value) {
    if (!(await confirmEnd())) return;
    endSession();
    return;
  }
  // A header click always starts a plain global scan — never inherits a stale
  // contextual request.
  session.start(null);
};
</script>

<template>
  <button
    type="button"
    :title="active ? $t('codes.scan.finish') : $t('codes.scan.button')"
    :aria-label="active ? $t('codes.scan.finish') : $t('codes.scan.button')"
    class="p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    :class="
      active
        ? 'text-brand-500 dark:text-brand-400'
        : 'text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-white/5'
    "
    @click="onClick"
  >
    <Loader v-if="active" class="w-5 h-5 animate-spin" />
    <ScanLine v-else class="w-5 h-5" />
  </button>
  <PhoneBridgeModal ref="modalRef" :context="context" @message="onMessage" />
</template>
