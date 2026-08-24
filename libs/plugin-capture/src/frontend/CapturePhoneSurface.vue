<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Camera, Check, Loader, AlertTriangle, ZoomIn } from '@lucide/vue';
import type { PhoneBridgeMessage } from '@makekeeper/plugin-contract';

// Capture's phone surface (#77): contributed into the bridge shell's
// `phone-bridge.surface.capture` slot. The shell owns the token handshake and
// hands this a thin relay API (`submit`/`close`); this owns the camera. It opens
// the rear camera via getUserMedia (requires a secure context — see
// docs/tls-public-access.md), offers zoom (hardware where supported, otherwise a
// digital crop), and relays each downscaled frame through `submit({ image })`.

const JPEG_QUALITY = 0.85;
const DIGITAL_ZOOM_MAX = 4;

// getCapabilities()/getSettings() don't type the non-standard `zoom` member, and
// applyConstraints has no typed slot for it — these interop shims bridge that.
interface ZoomRange {
  min: number;
  max: number;
  step: number;
}
type CapabilitiesWithZoom = MediaTrackCapabilities & { zoom?: ZoomRange };
type SettingsWithZoom = MediaTrackSettings & { zoom?: number };
type ZoomConstraints = { advanced: Array<{ zoom: number }> };

// A saved photo the phone echoes as a thumbnail.
interface Shot {
  id: string;
  url: string;
}

const props = defineProps<{
  token: string;
  contextLabel: string;
  submit: (payload: unknown) => Promise<PhoneBridgeMessage | null>;
  close: () => Promise<void>;
}>();

const { t } = useI18n();

type Phase = 'ready' | 'error' | 'done';

const phase = ref<Phase>('ready');
const errorKey = ref<string>('capture.errors.camera');
const shots = ref<Shot[]>([]);
const isUploading = ref(false);

const videoRef = ref<HTMLVideoElement | null>(null);
let stream: MediaStream | null = null;
let videoTrack: MediaStreamTrack | null = null;

// Zoom: `hardwareZoom` drives the camera via applyConstraints; otherwise a
// digital crop (CSS scale for preview + source crop on capture).
const zoom = ref(1);
const zoomMin = ref(1);
const zoomMax = ref(1);
const zoomStep = ref(0.1);
const hardwareZoom = ref(false);
const zoomSupported = computed<boolean>(() => zoomMax.value > zoomMin.value);
const videoStyle = computed<Record<string, string>>(() =>
  hardwareZoom.value ? {} : { transform: `scale(${zoom.value})` },
);

const stopStream = (): void => {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    videoTrack = null;
  }
};

const setupZoom = (): void => {
  const caps =
    videoTrack && typeof videoTrack.getCapabilities === 'function'
      ? (videoTrack.getCapabilities() as CapabilitiesWithZoom)
      : {};
  if (videoTrack && caps.zoom && caps.zoom.max > caps.zoom.min) {
    hardwareZoom.value = true;
    zoomMin.value = caps.zoom.min;
    zoomMax.value = caps.zoom.max;
    zoomStep.value = caps.zoom.step || 0.1;
    const settings = videoTrack.getSettings() as SettingsWithZoom;
    zoom.value = settings.zoom ?? caps.zoom.min;
  } else {
    // Digital zoom fallback — always available.
    hardwareZoom.value = false;
    zoomMin.value = 1;
    zoomMax.value = DIGITAL_ZOOM_MAX;
    zoomStep.value = 0.1;
    zoom.value = 1;
  }
};

const applyZoom = async (): Promise<void> => {
  if (hardwareZoom.value && videoTrack) {
    // Cast: the zoom constraint is non-standard and absent from the DOM types.
    const constraints: ZoomConstraints = { advanced: [{ zoom: zoom.value }] };
    try {
      await videoTrack.applyConstraints(
        constraints as unknown as MediaTrackConstraints,
      );
    } catch {
      // Some devices reject mid-stream zoom changes — ignore.
    }
  }
  // Digital zoom needs no camera call: the CSS transform + capture crop react
  // to `zoom` directly.
};

const startCamera = async (): Promise<void> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    phase.value = 'error';
    errorKey.value = 'capture.errors.insecure';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    videoTrack = stream.getVideoTracks()[0] ?? null;
    setupZoom();
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      await videoRef.value.play().catch(() => undefined);
    }
  } catch {
    phase.value = 'error';
    errorKey.value = 'capture.errors.camera';
  }
};

// Draw the current video frame to a canvas, applying the digital-zoom crop
// (when hardware zoom isn't used). The crop is captured at its native
// resolution: the backend stores what it receives as the original and derives
// its own previews from it (#113), so throwing pixels away here would destroy
// detail nothing can recover.
const grabFrame = (): string | null => {
  const video = videoRef.value;
  if (!video || !video.videoWidth) return null;
  const z = hardwareZoom.value ? 1 : zoom.value;
  const srcW = video.videoWidth / z;
  const srcH = video.videoHeight / z;
  const srcX = (video.videoWidth - srcW) / 2;
  const srcY = (video.videoHeight - srcH) / 2;
  const w = Math.round(srcW);
  const h = Math.round(srcH);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
};

const shoot = async (): Promise<void> => {
  if (isUploading.value) return;
  const image = grabFrame();
  if (!image) return;
  isUploading.value = true;
  try {
    const message = await props.submit({ image });
    // The strip shows the frame we still hold in memory, not the stored copy.
    // This page runs on a paired phone with no session of its own, and serving
    // an attachment now requires one (#123) — but nothing here needs the server
    // round-trip: the bytes on screen are the bytes we just sent.
    if (message) {
      shots.value = [{ id: message.id, url: image }, ...shots.value];
    }
  } catch {
    // A transient relay failure leaves the viewfinder open to retry.
  } finally {
    isUploading.value = false;
  }
};

const finish = async (): Promise<void> => {
  stopStream();
  await props.close();
  phase.value = 'done';
};

// Prevent the browser from pinch-zooming the page (which would hide the camera
// controls) — the capture surface zooms the camera instead. Restored on leave.
let prevViewport: string | null = null;
const preventGesture = (e: Event): void => e.preventDefault();

const lockPageZoom = (): void => {
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) {
    prevViewport = vp.getAttribute('content');
    vp.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
    );
  }
  document.addEventListener('gesturestart', preventGesture);
};

const unlockPageZoom = (): void => {
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && prevViewport !== null) vp.setAttribute('content', prevViewport);
  document.removeEventListener('gesturestart', preventGesture);
};

onMounted(() => {
  lockPageZoom();
  startCamera();
});
onBeforeUnmount(() => {
  stopStream();
  unlockPageZoom();
});
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0" style="touch-action: none">
    <!-- Camera / permission error -->
    <div
      v-if="phase === 'error'"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"
    >
      <AlertTriangle class="w-10 h-10 text-red-400" />
      <p class="text-sm text-slate-300">
        {{ t(errorKey) }}
      </p>
    </div>

    <!-- Done -->
    <div
      v-else-if="phase === 'done'"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"
    >
      <Check class="w-12 h-12 text-emerald-400" />
      <p class="text-sm text-slate-300">
        {{ t('capture.done', { count: shots.length }) }}
      </p>
    </div>

    <!-- Viewfinder -->
    <template v-else>
      <div class="relative flex-1 overflow-hidden bg-black">
        <video
          ref="videoRef"
          autoplay
          playsinline
          muted
          :style="videoStyle"
          class="absolute inset-0 w-full h-full object-cover origin-center"
        />

        <!-- Thumbnails strip (top) -->
        <div
          v-if="shots.length"
          class="absolute top-2 left-2 right-2 flex gap-2 overflow-x-auto"
        >
          <img
            v-for="s in shots"
            :key="s.id"
            :src="s.url"
            alt=""
            class="h-16 w-16 object-cover rounded-lg border border-white/20 shrink-0"
          />
        </div>

        <!-- Zoom slider (bottom) -->
        <div
          v-if="zoomSupported"
          class="absolute bottom-3 left-4 right-4 flex items-center gap-3 rounded-full bg-black/40 backdrop-blur px-3 py-2"
        >
          <ZoomIn class="w-4 h-4 text-white/80 shrink-0" />
          <input
            v-model.number="zoom"
            type="range"
            :min="zoomMin"
            :max="zoomMax"
            :step="zoomStep"
            class="flex-1 accent-white"
            @input="applyZoom"
          />
          <span class="text-xs text-white/80 w-9 text-right shrink-0"
            >{{ zoom.toFixed(1) }}×</span
          >
        </div>
      </div>

      <!-- Controls -->
      <div
        class="flex items-center justify-between px-6 h-24 border-t border-white/10 shrink-0"
      >
        <span class="w-16 text-xs text-slate-400">
          {{ t('capture.shotCount', { count: shots.length }) }}
        </span>
        <button
          :disabled="isUploading"
          :aria-label="t('capture.shoot')"
          class="flex items-center justify-center w-16 h-16 rounded-full bg-white text-slate-900 shadow-lg active:scale-95 transition-transform disabled:opacity-60"
          @click="shoot"
        >
          <Loader v-if="isUploading" class="w-7 h-7 animate-spin" />
          <Camera v-else class="w-7 h-7" />
        </button>
        <button
          :disabled="!shots.length"
          class="w-16 flex flex-col items-center gap-1 text-xs text-emerald-400 disabled:text-slate-600"
          @click="finish"
        >
          <Check class="w-6 h-6" />
          {{ t('capture.finish') }}
        </button>
      </div>
    </template>
  </div>
</template>
