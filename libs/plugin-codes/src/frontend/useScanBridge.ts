import { computed, ref, type ComputedRef, type Ref } from 'vue';

// The imperative handle PhoneBridgeModal exposes through its template ref.
interface PhoneBridgeModalHandle {
  open: () => void;
  isActive: boolean;
  end: () => Promise<void>;
  // Re-point the live session at the modal's current `context` prop (#79).
  // False when the bridge says the session is gone — the caller then opens a
  // fresh one.
  updateContext: () => Promise<boolean>;
}

// A scan surface relays the decoded raw string and, when the host offered
// actions (#79), the key of the one the user confirmed on the phone. Narrow the
// unknown @message payload with a type guard instead of asserting its shape
// (§5.1); this mirrors the backend `isScanPayload` guard in codes.scan.ts.
interface ScanMessage {
  value: string;
  action?: string;
}

const isScanMessage = (data: unknown): data is ScanMessage =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { value?: unknown }).value === 'string' &&
  (data as ScanMessage).value.trim().length > 0 &&
  (typeof (data as { action?: unknown }).action === 'string' ||
    (data as { action?: unknown }).action === undefined);

// Shared desktop-side plumbing for a scan button (#74): owns the PhoneBridgeModal
// handle, the live-session flag, and message handling. The global header button
// and the contextual host button both use it — they differ only in what they do
// with the decoded value (the `onScan` callback), which is also responsible for
// closing the session (via `endSession`) once it is done.
//
// One session relays MANY scans (#79 batch mode): every relayed message is
// dispatched, and the session lives until someone calls `endSession` — the
// global button ends it after its single navigation, a contextual host keeps it
// open so a whole shelf can be filed in one go.
export function useScanBridge(
  onScan: (value: string, actionKey: string | null) => void,
): {
  modalRef: Ref<PhoneBridgeModalHandle | null>;
  active: ComputedRef<boolean>;
  onMessage: (data: unknown) => void;
  openScan: () => void;
  endSession: () => void;
} {
  const modalRef = ref<PhoneBridgeModalHandle | null>(null);

  // True while the phone is connected and the session is live.
  const active = computed<boolean>(() => Boolean(modalRef.value?.isActive));

  const onMessage = (data: unknown): void => {
    if (!isScanMessage(data)) return;
    onScan(data.value, data.action ?? null);
  };

  const endSession = (): void => {
    void modalRef.value?.end();
  };

  const openScan = (): void => {
    modalRef.value?.open();
  };

  return { modalRef, active, onMessage, openScan, endSession };
}
