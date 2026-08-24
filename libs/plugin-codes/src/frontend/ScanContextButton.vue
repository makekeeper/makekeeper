<script setup lang="ts">
// Contextual "Scan with phone" trigger (#74, reworked in #79): mounted into a
// host-declared slot (`manifest.codes.scan.slot`) via a manifest-driven
// contribution. The host supplies, through the slot ctx, the actions the phone
// should offer and an `onScan(ref, actionKey, rawValue)` handler that applies
// the chosen one.
//
// This owns NO session: it hands the request to `useScanSessionStore`, and the
// always-mounted header host runs it. That is what lets the user start a scan at
// a storage cell and then walk the desktop elsewhere — the phone keeps filing
// into the cell it was pointed at, because the context is captured at start, not
// re-read from whatever screen is open.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ScanContextSlotCtx } from '@makekeeper/plugin-contract';
import { Button, useConfirm } from '@makekeeper/frontend-core';
import { ScanLine } from '@lucide/vue';
import { useScanSessionStore } from './scan-session';
import { useScanEndConfirm } from './useScanEndConfirm';

// The props ARE the slot ctx: typing against the contract (rather than
// re-spelling its fields) is what keeps host and contributor from drifting.
// `originRef` is the canonical ORef of what the scan is for — see `isMine`.
const props = defineProps<ScanContextSlotCtx>();

const { t } = useI18n();
const session = useScanSessionStore();
const confirm = useConfirm();
const confirmEnd = useScanEndConfirm();

// Live only while THIS trigger's request is the one running — a session started
// elsewhere must not make every scan button in the app spin. Matched by the
// context's ORef, not by handler identity: leaving the page and coming back
// rebuilds the component (new closure), but the cell it points at is the same,
// so the spinner is still there on return. Falls back to handler identity for a
// host that declares no ref.
const isMine = computed<boolean>(() => {
  if (!session.active || !session.request) return false;
  return props.originRef
    ? session.request.originRef === props.originRef
    : session.request.handler === props.onScan;
});

// Only ONE phone is attached at a time, so a click here while another context
// is running is a RETARGET, not a second session: the paired phone keeps its
// page and camera and simply starts filing into this context. Never silent
// though — the running context is named and the switch confirmed.
const onClick = async (): Promise<void> => {
  if (isMine.value) {
    if (await confirmEnd()) session.end();
    return;
  }
  const handler = props.onScan;
  if (!handler) return;
  const request = {
    actions: props.actions ?? [],
    contextLabel: props.contextLabel ?? t('codes.scan.title'),
    originRef: props.originRef,
    handler,
  };
  if (session.active) {
    const retarget = await confirm({
      message: t('codes.scan.retargetSession', {
        context: session.request?.contextLabel ?? t('codes.scan.title'),
      }),
      confirmLabel: t('codes.scan.retargetConfirm'),
    });
    if (!retarget) return;
    // Keeps the paired phone exactly where it is — it just starts filing into
    // this context instead, and says so on screen.
    session.retarget(request);
    return;
  }
  session.start(request);
};
</script>

<template>
  <!-- No handler, no button: a host may declare the slot without wiring
       `onScan` (it is optional in the ctx), and a trigger that cannot do
       anything is worse than no trigger at all.
       While the session is live the button spins (the phone page is open) and
       doubles as "Done", so `busy` rather than `loading`: it must stay clickable
       to end the session. -->
  <Button
    v-if="onScan"
    variant="secondary"
    size="sm"
    :icon-left="ScanLine"
    :busy="isMine"
    @click="onClick"
  >
    {{ isMine ? $t('codes.scan.finish') : $t('codes.scan.contextButton') }}
  </Button>
</template>
