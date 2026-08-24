import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import type {
  PhoneBridgeScanAction,
  ScanResultHandler,
} from '@makekeeper/plugin-contract';

// A live scan session outlives the button that started it (#79). The bridge
// session is owned by ONE always-mounted host (codes' header button), and this
// store is the seam: a contextual trigger anywhere in the app describes the
// session it wants, and the host runs it. Otherwise the session would die the
// moment the user navigated away from the view that opened it — the phone would
// keep relaying scans into nothing, which is exactly what "I opened the QR at
// the shelf, then walked the desktop elsewhere" must NOT do.
//
// Deliberately in-memory only: a session is tied to a running page, and its
// handler is a closure. A reload ends it, as it already ends the phone's side.

export interface ScanSessionRequest {
  // What the phone may do with a scanned code, shown as its confirm buttons.
  actions: PhoneBridgeScanAction[];
  // Session label shown on the phone, already i18n-resolved by the requester.
  contextLabel: string;
  // Canonical ORef of the object the session is for. Identity that survives
  // navigation: the trigger and the status indicator re-attach to a running
  // session by this ref after their view was unmounted and rebuilt.
  originRef?: string;
  // Applied per confirmed scan — the host's `onScan`, captured at start.
  handler: ScanResultHandler;
}

export const useScanSessionStore = defineStore('codes-scan-session', () => {
  // The contextual session in flight, or null for a plain global scan.
  const request = ref<ScanSessionRequest | null>(null);
  // True while the phone is connected — drives every trigger's spinner.
  const active = ref(false);
  // Nonces rather than booleans: the host reacts to each command once, even
  // when two identical requests follow each other.
  const openNonce = ref(0);
  const closeNonce = ref(0);
  const retargetNonce = ref(0);

  const start = (req: ScanSessionRequest | null): void => {
    request.value = req;
    openNonce.value += 1;
  };

  const end = (): void => {
    closeNonce.value += 1;
  };

  // Point the RUNNING session at a new context instead of closing it: the phone
  // is already paired and in the user's hand, so making them close the page,
  // reopen the camera and rescan a fresh QR just to switch cells is the wrong
  // trade. The host pushes the new context; the phone picks it up over its own
  // realtime channel.
  const retarget = (req: ScanSessionRequest): void => {
    request.value = req;
    retargetNonce.value += 1;
  };

  // The host reports the session is over (ended, expired, or the phone closed).
  const clear = (): void => {
    request.value = null;
    active.value = false;
  };

  return {
    request,
    active,
    openNonce,
    closeNonce,
    retargetNonce,
    start,
    end,
    retarget,
    clear,
  } satisfies {
    request: Ref<ScanSessionRequest | null>;
    active: Ref<boolean>;
    openNonce: Ref<number>;
    closeNonce: Ref<number>;
    retargetNonce: Ref<number>;
    start: (req: ScanSessionRequest | null) => void;
    end: () => void;
    retarget: (req: ScanSessionRequest) => void;
    clear: () => void;
  };
});
