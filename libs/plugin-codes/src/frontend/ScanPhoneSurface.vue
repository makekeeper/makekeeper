<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, Loader, AlertTriangle, MapPin, ScanLine } from '@lucide/vue';
import { apiFetch } from '@makekeeper/frontend-core';
import { extractDeepLinkCode } from '../code-format';
import type { IScannerControls } from '@zxing/browser';
// Type-only (erased at runtime — no bundle cost); the enum VALUES come from the
// dynamic import below so ZXing stays out of the desktop bundle.
import type { DecodeHintType } from '@zxing/library';
import {
  isPhoneBridgeScanSessionData,
  parseObjectRef,
  type PhoneBridgeMessage,
  type PhoneBridgeScanAction,
} from '@makekeeper/plugin-contract';

// Codes' phone scan surface (#74): contributed into the bridge shell's
// `phone-bridge.surface.scan` slot. The shell owns the token handshake and hands
// this a thin relay API (`submit`/`close`); this owns the camera. It decodes a
// QR/barcode with ZXing (pure-JS, so it works on every phone browser incl. iOS
// Safari — the native BarcodeDetector is Chromium-only), then PAUSES and shows
// what it saw + what it resolves to, and only relays to the desktop once the user
// confirms — so an accidental wrong code never navigates the desktop, and the
// session stays open to try again. ZXing is dynamically imported so it only loads
// on the phone, not in the desktop bundle.

const props = defineProps<{
  token: string;
  contextLabel: string;
  // The desktop's session bootstrap data (#79) — narrowed below, never trusted:
  // it arrives over the public phone route.
  data?: unknown;
  submit: (payload: unknown) => Promise<PhoneBridgeMessage | null>;
  close: () => Promise<void>;
}>();

const { t } = useI18n();

type Phase = 'scanning' | 'preview' | 'sent' | 'error';
const phase = ref<Phase>('scanning');
const errorKey = ref<string>('codes.scan.cameraError');

const decoded = ref<string>('');
// What to SHOW the user: our QR encodes a `/c/<code>` deep-link, but the long URL
// is noise — display just the short code, matching how a 1D barcode (raw code)
// already reads. The full decoded value is still what gets relayed/resolved.
const shownCode = computed<string>(
  () => extractDeepLinkCode(decoded.value) ?? decoded.value,
);
// What the host offers for a scanned code here (#79). Empty for the global scan
// button, which has no context — then the surface keeps its "Open" behaviour.
const actions = computed<PhoneBridgeScanAction[]>(() =>
  isPhoneBridgeScanSessionData(props.data) ? props.data.actions : [],
);
// A contextual session files many codes in a row; the desktop ends it.
const isBatch = computed<boolean>(() => actions.value.length > 0);

const checking = ref(false);
// True when the preview lookup itself failed (backend unreachable / error) — as
// opposed to a successful lookup that found no match. Keeps a valid code from
// being mislabelled "not in the system" when it's really a transport hiccup.
const previewFailed = ref(false);
interface ScanPreview {
  ref: string | null;
  displayName: string | null;
  breadcrumb: string | null;
}
// "Nothing resolved yet" — one shape, so the three reset sites cannot drift.
const emptyPreview = (): ScanPreview => ({
  ref: null,
  displayName: null,
  breadcrumb: null,
});
const preview = ref<ScanPreview>(emptyPreview());

// The scanned object's entity type, from the canonical ref the preview resolved.
// An action declares which types it accepts, so a mis-scan (the shelf's own
// label, an order) is caught here — on the phone, before anything is relayed.
const scannedEntityType = computed<string | null>(
  () =>
    (preview.value.ref ? parseObjectRef(preview.value.ref) : null)
      ?.entityType ?? null,
);

const isApplicable = (action: PhoneBridgeScanAction): boolean =>
  !action.entityTypes?.length ||
  (scannedEntityType.value !== null &&
    action.entityTypes.includes(scannedEntityType.value));

const hasApplicableAction = computed<boolean>(() =>
  actions.value.some(isApplicable),
);
const isRelaying = ref(false);

const videoRef = ref<HTMLVideoElement | null>(null);
let controls: IScannerControls | null = null;
// The camera keeps running across the preview step; this gates the decode
// callback so a frozen preview isn't overwritten by the next frame.
let paused = false;
let stopped = false;

const stop = (): void => {
  stopped = true;
  controls?.stop();
  controls = null;
};

// A code was decoded: freeze, show it, and resolve it for a preview.
const onDecoded = async (value: string): Promise<void> => {
  if (paused || stopped) return;
  paused = true;
  decoded.value = value;
  phase.value = 'preview';
  checking.value = true;
  previewFailed.value = false;
  preview.value = emptyPreview();
  try {
    const res = await apiFetch('/api/codes/scan/preview', {
      method: 'POST',
      public: true,
      headers: { 'Content-Type': 'application/json' },
      // The bridge session token gates this public route (server-side): only a
      // phone in a live scan session may resolve object names.
      body: JSON.stringify({ value, token: props.token }),
    });
    // 410: the desktop ended this session (or started another one) while the
    // camera was still up. Say so instead of pretending the code is unknown —
    // and stop the camera, since nothing can be relayed any more.
    if (res.status === 410) {
      stop();
      phase.value = 'error';
      errorKey.value = 'codes.scan.sessionEnded';
      return;
    }
    if (res.ok) {
      const data: {
        ref: string | null;
        displayName: string | null;
        breadcrumb: string | null;
      } = await res.json();
      preview.value = {
        ref: data.ref,
        displayName: data.displayName,
        breadcrumb: data.breadcrumb,
      };
    } else {
      previewFailed.value = true;
    }
  } catch {
    // Network hiccup — the user can still confirm on the raw value.
    previewFailed.value = true;
  } finally {
    checking.value = false;
  }
};

// The desktop can re-point a live session at another context (#79) — the phone
// must never keep filing into a cell the user has moved on from without saying
// so. The banner is transient; the action buttons update on their own, since
// they are computed from the session data the shell re-read.
const RETARGET_NOTICE_MS = 5000;
const retargetNotice = ref<string>('');
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// Watch the WHOLE context, not just its label: two cells can carry the same
// label, and swapping the actions under the user without a word is exactly what
// this banner exists to prevent. Serialized because the shell re-reads the
// session on every nudge, so the objects are new each time even when unchanged.
const contextSignature = computed<string>(() =>
  JSON.stringify({ label: props.contextLabel, actions: actions.value }),
);

watch(contextSignature, (next, previous) => {
  if (!previous || next === previous || !props.contextLabel) return;
  retargetNotice.value = props.contextLabel;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    retargetNotice.value = '';
  }, RETARGET_NOTICE_MS);
});

// How long the "relayed" acknowledgement stays up before the camera resumes.
const BATCH_ACK_MS = 1200;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

// Resume scanning without tearing down the camera (instant, no re-prompt).
const scanAgain = (): void => {
  decoded.value = '';
  preview.value = emptyPreview();
  phase.value = 'scanning';
  isRelaying.value = false;
  paused = false;
};

// User confirmed: relay the code (and, in a contextual session, the action they
// picked) to the desktop, which applies it. The phone does NOT close here —
// closing immediately after the relay races the desktop's poll and can drop the
// message.
//
// A contextual session files a whole shelf in one go (#79), so the camera stays
// up and the surface returns to scanning after a brief acknowledgement; the
// desktop ends the session. Without host actions this stays single-shot: the
// desktop navigates away and closes.
const relay = async (action: PhoneBridgeScanAction | null): Promise<void> => {
  if (isRelaying.value) return;
  isRelaying.value = true;
  try {
    await props.submit({ value: decoded.value, action: action?.key });
    phase.value = 'sent';
    if (isBatch.value) {
      resumeTimer = setTimeout(scanAgain, BATCH_ACK_MS);
    } else {
      stop();
    }
  } catch {
    isRelaying.value = false;
  }
};

onMounted(async () => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    phase.value = 'error';
    errorKey.value = 'codes.scan.unsupported';
    return;
  }
  const video = videoRef.value;
  if (!video) return;
  try {
    // Lazy-load ZXing (kept out of the desktop bundle). It opens the rear camera
    // via getUserMedia, attaches it to our <video>, and decodes continuously.
    const { BrowserMultiFormatReader, BarcodeFormat } = await import(
      '@zxing/browser'
    );
    const { DecodeHintType: DecodeHint } = await import('@zxing/library');
    if (stopped) return;
    // Restrict to the formats we actually use (our QR + Code128) plus the common
    // retail 1D symbologies a manufacturer SKU might carry, and turn on
    // TRY_HARDER — 1D barcodes off a live camera decode far more reliably with a
    // narrower format set and the exhaustive scan enabled.
    const hints = new Map<DecodeHintType, unknown>([
      [
        DecodeHint.POSSIBLE_FORMATS,
        [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ],
      ],
      [DecodeHint.TRY_HARDER, true],
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    controls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: 'environment' },
          // A higher-res frame gives the 1D reader enough bar detail to decode.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      video,
      (result) => {
        if (result) void onDecoded(result.getText());
      },
    );
    // Unmounted while the camera was starting up.
    if (stopped) controls.stop();
  } catch {
    phase.value = 'error';
    errorKey.value = 'codes.scan.cameraError';
  }
});

onBeforeUnmount(() => {
  if (resumeTimer) clearTimeout(resumeTimer);
  if (noticeTimer) clearTimeout(noticeTimer);
  stop();
});
</script>

<template>
  <div class="flex-1 relative min-h-0 bg-black overflow-hidden">
    <!-- Persistent camera layer: kept mounted across scanning/preview so the
         ZXing binding to this <video> is never torn down (unmounting it on a
         phase change froze the surface on "scan again"). Overlays sit on top. -->
    <video
      v-show="phase === 'scanning' || phase === 'preview'"
      ref="videoRef"
      autoplay
      playsinline
      muted
      class="absolute inset-0 w-full h-full object-cover"
    />

    <!-- The desktop switched this session to another context. -->
    <div
      v-if="retargetNotice"
      class="absolute inset-x-0 top-0 z-10 px-4 py-3 bg-brand-500/90 text-white text-sm font-semibold text-center"
    >
      {{ t('codes.scan.retargeted', { context: retargetNotice }) }}
    </div>

    <!-- Scanning overlay: title, constrained scan window, hint. -->
    <div v-if="phase === 'scanning'" class="absolute inset-0 flex flex-col">
      <p class="px-6 pt-4 text-center text-sm text-slate-200 drop-shadow">
        {{ contextLabel || t('codes.scan.title') }}
      </p>
      <div class="flex-1 flex items-center justify-center">
        <!-- Centered box with the rest dimmed, so the user aims one code. -->
        <div
          class="w-64 max-w-[78%] aspect-[5/3] rounded-xl border-2 border-brand-400/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]"
        />
      </div>
      <p class="px-6 py-4 text-center text-xs text-slate-300 drop-shadow">
        {{ t('codes.scan.hint') }}
      </p>
    </div>

    <!-- Preview + confirm (over a dimmed frozen frame). -->
    <div
      v-else-if="phase === 'preview'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center px-6 bg-black/70 backdrop-blur-sm"
    >
      <div
        class="w-full max-w-xs rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3"
      >
        <p class="text-xs uppercase tracking-wider text-slate-400">
          {{ t('codes.scan.seeing') }}
        </p>
        <p class="text-base font-mono font-semibold text-white break-all">
          {{ shownCode }}
        </p>

        <div
          v-if="checking"
          class="flex items-center justify-center gap-2 text-sm text-slate-400 pt-1"
        >
          <Loader class="w-4 h-4 animate-spin" />
          {{ t('codes.scan.checking') }}
        </div>
        <template v-else>
          <div v-if="preview.displayName" class="pt-1 space-y-1">
            <p class="text-xs uppercase tracking-wider text-emerald-400/80">
              {{ t('codes.scan.found') }}
            </p>
            <p class="text-sm font-semibold text-white">
              {{ preview.displayName }}
            </p>
            <p
              v-if="preview.breadcrumb"
              class="flex items-center justify-center gap-1 text-xs text-slate-400"
            >
              <MapPin class="w-3.5 h-3.5" />
              {{ preview.breadcrumb }}
            </p>
          </div>
          <p v-else-if="previewFailed" class="pt-1 text-xs text-slate-400">
            {{ t('codes.scan.checkFailed') }}
          </p>
          <p v-else class="pt-1 text-xs text-amber-300/90">
            {{ t('codes.scan.notInSystem') }}
          </p>
        </template>
      </div>

      <div class="w-full max-w-xs flex flex-col gap-2">
        <!-- Contextual session (#79): the host's actions, resolved in the
             phone's own locale. An action that doesn't accept what was scanned
             stays disabled, so the mis-scan is caught here and not on the
             desktop nobody is looking at. -->
        <template v-if="actions.length">
          <button
            v-for="action in actions"
            :key="action.key"
            type="button"
            :disabled="isRelaying || !isApplicable(action)"
            class="flex items-center justify-center gap-2 h-12 rounded-xl bg-brand-500 text-white font-semibold active:scale-95 transition-transform disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
            @click="relay(action)"
          >
            <Loader v-if="isRelaying" class="w-5 h-5 animate-spin" />
            <template v-else>
              {{ t(action.labelKey, action.labelParams ?? {}) }}
            </template>
          </button>
          <p
            v-if="!checking && !hasApplicableAction"
            class="text-xs text-amber-300/90 text-center"
          >
            {{ t('codes.scan.notApplicable') }}
          </p>
        </template>
        <button
          v-else
          type="button"
          :disabled="isRelaying"
          class="flex items-center justify-center gap-2 h-12 rounded-xl bg-brand-500 text-white font-semibold active:scale-95 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          @click="relay(null)"
        >
          <Loader v-if="isRelaying" class="w-5 h-5 animate-spin" />
          <template v-else>
            {{ t('codes.scan.open') }}
          </template>
        </button>
        <button
          type="button"
          :disabled="isRelaying"
          class="flex items-center justify-center gap-2 h-11 rounded-xl border border-white/15 text-slate-200 active:scale-95 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          @click="scanAgain"
        >
          <ScanLine class="w-4 h-4" />
          {{ t('codes.scan.again') }}
        </button>
      </div>
    </div>

    <!-- Relayed to the desktop -->
    <div
      v-else-if="phase === 'sent'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8"
    >
      <Check class="w-12 h-12 text-emerald-400" />
      <p class="text-sm text-slate-200">
        {{ t('codes.scan.relayed') }}
      </p>
      <p class="text-xs text-slate-400 break-all font-mono">
        {{ shownCode }}
      </p>
    </div>

    <!-- Camera / permission error -->
    <div
      v-else
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8"
    >
      <AlertTriangle class="w-10 h-10 text-red-400" />
      <p class="text-sm text-slate-300">
        {{ t(errorKey) }}
      </p>
    </div>
  </div>
</template>
