<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import {
  CopyableLink,
  Modal,
  QrCode,
  Spinner,
  apiErrorMessage,
  apiJson,
  useDateFormat,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import type { DevicePairingOffer } from '@makekeeper/plugin-contract';
import { useMobilePairingStore } from './pairing-store';

// THE pairing dialog — literally one instance behind every "pair a phone"
// affordance in the app (the header QR button and the Devices section, #261).
// It used to exist twice, and the copy in Devices was the poorer one: it awaited
// the POST before opening anything, so the button did nothing visible for as
// long as bringing a tunnel up takes, and it never noticed the phone actually
// pairing.
//
// The QR carries the address AND a one-time pairing code, so a single scan both
// opens the app and connects the phone.
//
// The three phases exist because on an instance with no permanent address,
// asking for a QR STARTS a tunnel, and the tunnel's name is not resolvable for
// the first few seconds. A QR painted immediately would send the person to
// "site not found" and teach them the feature is broken — so the dialog shows
// the tunnel coming up, counts the wait down, and only then reveals the code.

type Phase = 'preparing' | 'warmup' | 'ready';

// Mounted ONCE for the whole app (by MobilePairButton, the plugin's permanent
// presence in the shell). Every trigger goes through the store, so there is one
// dialog, one live code and one poller no matter where pairing was started.
const pairing = useMobilePairingStore();

const { t } = useI18n();
const dates = useDateFormat();
const toast = useToastStore();

const offer = ref<DevicePairingOffer | null>(null);
const phase = ref<Phase>('preparing');
const warmupLeft = ref(0);

let warmupTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// How often the desktop asks whether the phone has taken the offer up. The same
// cadence the phone-bridge dialog polls at — fast enough to feel immediate, slow
// enough to be invisible.
const POLL_MS = 3000;

const clearWarmup = (): void => {
  if (warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
};

const clearPoll = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

const reset = (): void => {
  clearWarmup();
  clearPoll();
  offer.value = null;
  phase.value = 'preparing';
};

const dismiss = (): void => {
  reset();
  pairing.close();
};

// `dismiss`, not `reset`: leaving the store open while the only dialog goes away
// would leave the app believing pairing is on screen when nothing is, and the
// watch below — which fires on a CHANGE — would never re-open it on remount.
onBeforeUnmount(dismiss);

const checkPaired = async (): Promise<void> => {
  const current = offer.value;
  if (!current) return;

  if (Date.now() >= new Date(current.expiresAt).getTime()) {
    dismiss();
    toast.info(t('mobile.pairQr.expired'));
    return;
  }
  try {
    const status = await apiJson<{ redeemed: boolean }>(
      `/api/devices/pairing-code/${current.id}`,
    );
    if (status.redeemed) {
      dismiss();
      pairing.notifyPaired();
      toast.success(t('mobile.pairQr.paired'));
    }
  } catch {
    // A failed poll is not worth interrupting anyone: the next one decides, and
    // the expiry check above closes the dialog either way.
  }
};

const start = async (): Promise<void> => {
  reset();
  try {
    // The server resolves the address — and brings a tunnel up if that is the
    // only way a phone can reach this instance.
    const created = await apiJson<DevicePairingOffer>(
      '/api/devices/pairing-code',
      { method: 'POST' },
    );
    offer.value = created;
    // A QR is a live credential painted on a monitor. It closes itself the
    // moment the phone takes it up — and when it expires unused, rather than
    // sitting there inviting the next person who walks past.
    pollTimer = setInterval(() => {
      void checkPaired();
    }, POLL_MS);
    if (created.warmupSeconds > 0) {
      phase.value = 'warmup';
      warmupLeft.value = created.warmupSeconds;
      warmupTimer = setInterval(() => {
        warmupLeft.value -= 1;
        if (warmupLeft.value <= 0) {
          clearWarmup();
          phase.value = 'ready';
        }
      }, 1000);
    } else {
      phase.value = 'ready';
    }
  } catch (err) {
    dismiss();
    toast.error(apiErrorMessage(err, t('mobile.pairQr.error')));
  }
};

// Opening the dialog IS the request: the modal is on screen from the press,
// showing the spinner, because a button that does nothing visible for ten
// seconds reads as a broken button.
watch(
  () => pairing.isOpen,
  (open) => {
    if (open) void start();
    else reset();
  },
  // The store outlives this component, so a mount that lands on an already-open
  // store has to pick the request up rather than render an empty modal.
  { immediate: true },
);
</script>

<template>
  <Modal
    :model-value="pairing.isOpen"
    :title="$t('mobile.pairQr.title')"
    @update:model-value="dismiss"
  >
    <!-- Bringing a tunnel up, then waiting for its name to resolve. -->
    <div
      v-if="phase !== 'ready'"
      class="flex flex-col items-center justify-center gap-3 py-10 text-center"
    >
      <Spinner />
      <span class="text-xs text-slate-500 dark:text-slate-400">
        {{
          phase === 'warmup'
            ? $t('mobile.pairQr.warmup', { seconds: warmupLeft })
            : $t('mobile.pairQr.preparing')
        }}
      </span>
      <p
        v-if="phase === 'warmup'"
        class="text-xxs text-slate-400 dark:text-slate-500 max-w-[15rem]"
      >
        {{ $t('mobile.pairQr.warmupNote') }}
      </p>
    </div>

    <!-- What the code IS comes before the code itself, the way its sibling
         phone-bridge dialog reads (#271): an explanation printed underneath is
         one the person only meets after they have already decided whether to
         point a camera at it. -->
    <div v-else-if="offer" class="space-y-4 text-center">
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{ $t('mobile.pairQr.description') }}
      </p>
      <QrCode
        :value="offer.url"
        :label="$t('mobile.pairQr.alt')"
        class="mx-auto w-60 h-60"
      />
      <CopyableLink :url="offer.url" :hint="$t('mobile.pairQr.linkHint')" />
      <p class="text-xs text-slate-500 dark:text-slate-400">
        {{
          $t('common.validUntil', {
            when: dates.time(offer.expiresAt),
          })
        }}
      </p>
    </div>
  </Modal>
</template>
