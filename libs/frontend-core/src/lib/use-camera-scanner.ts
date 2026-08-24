import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue';
import type { IScannerControls } from '@zxing/browser';
// Type-only (erased at runtime); the enum VALUES come from the dynamic import
// below, so ZXing never enters a bundle that does not open a camera.
import type { DecodeHintType } from '@zxing/library';

// A live rear camera that decodes barcodes and can hand back a still frame
// (#200). Extracted as a shared primitive because two surfaces now need the very
// same camera: the phone-bridge scan page and the mobile intake screen.
//
// ZXing rather than the native BarcodeDetector: the native one is Chromium-only,
// and half the phones that will run this are iOS Safari.
//
// Note the deliberate limitation of `capture()`: it grabs a frame from the live
// preview, which is the resolution the camera is streaming, not a full-quality
// photo. That is the right trade for recognition — a 1080p frame is plenty for a
// model to read a label, and it keeps the flow to one tap.

// Formats worth trying. A narrower set decodes 1D barcodes off a live camera far
// more reliably than "everything", and these cover our own labels plus the
// retail symbologies a vendor SKU actually carries.
const SCAN_FORMAT_NAMES = [
  'QR_CODE',
  'CODE_128',
  'CODE_39',
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
] as const;

// How far a digital crop may go when the camera has no zoom of its own. Beyond
// roughly this the frame is mush, and the same ceiling as the capture surface's
// (`DIGITAL_ZOOM_MAX` there) keeps the two cameras feeling alike.
const DIGITAL_ZOOM_MAX = 4;
const DIGITAL_ZOOM_STEP = 0.1;

// What the CAMERA can do about zoom by itself. Non-standard: Android Chrome
// reports it, iOS Safari does not — which is why a digital fallback exists
// rather than the control simply vanishing on half the phones.
export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

// Parse a track's capabilities into a usable zoom range. Exported and pure
// because it is the one part of the camera worth testing: everything else needs
// a real device.
export function readZoomRange(capabilities: unknown): ZoomRange | null {
  if (typeof capabilities !== 'object' || capabilities === null) return null;
  const zoom: unknown = Reflect.get(capabilities, 'zoom');
  if (typeof zoom !== 'object' || zoom === null) return null;

  const min: unknown = Reflect.get(zoom, 'min');
  const max: unknown = Reflect.get(zoom, 'max');
  const step: unknown = Reflect.get(zoom, 'step');
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  // A camera that reports a range it cannot move within has no zoom to offer.
  if (!(max > min)) return null;
  return {
    min,
    max,
    // Some drivers omit the step; a hundredth of the range is a sane slider.
    step: typeof step === 'number' && step > 0 ? step : (max - min) / 100,
  };
}

export interface CameraScanner {
  // Bind this to the `<video>` element the preview renders into.
  videoRef: Ref<HTMLVideoElement | null>;
  // True once the camera is streaming; false before start and after a failure.
  active: Ref<boolean>;
  // Set when the camera could not be opened at all (denied, absent, insecure
  // context). The caller decides what to say about it — this layer holds no
  // strings.
  failed: Ref<boolean>;
  start: () => Promise<void>;
  stop: () => void;
  // A JPEG data URL of the current frame, or null when nothing is streaming.
  capture: () => string | null;
  // Always present: the camera's own range where it has one, a digital crop
  // range otherwise. Zoom is never unavailable — reading a shelf label from two
  // metres is the ordinary case, not a luxury.
  zoomRange: ComputedRef<ZoomRange>;
  zoom: Ref<number>;
  setZoom: (value: number) => void;
  // Bind to the `<video>`: empty for a camera zooming itself, a CSS scale for
  // the digital crop, so the preview shows what `capture()` will keep.
  videoStyle: ComputedRef<Record<string, string>>;
}

// `onDecode` fires for every successful read, which for a live camera means
// repeatedly while the code stays in view — callers debounce by acting once and
// calling `stop()`, or by ignoring a value they already have.
export function useCameraScanner(
  onDecode: (value: string) => void,
): CameraScanner {
  const videoRef = ref<HTMLVideoElement | null>(null);
  const active = ref(false);
  const failed = ref(false);
  const hardwareRange = ref<ZoomRange | null>(null);
  const zoom = ref(1);

  // The camera's own range when it has one, else the digital crop's.
  const zoomRange = computed<ZoomRange>(
    () =>
      hardwareRange.value ?? {
        min: 1,
        max: DIGITAL_ZOOM_MAX,
        step: DIGITAL_ZOOM_STEP,
      },
  );

  // A digital crop has to be shown as well as taken, or the preview lies about
  // what the shot will contain.
  // Annotated return type rather than `computed<T>(...)`: the generic form makes
  // TS pick the writable-computed overload for a getter whose branches are `{}`
  // and `{ transform }`, and reject it. (The capture surface carries the same
  // error today from the same pattern.)
  const videoStyle = computed(
    (): Record<string, string> =>
      hardwareRange.value ? {} : { transform: `scale(${zoom.value})` },
  );
  let controls: IScannerControls | null = null;
  let stopped = false;

  // The live video track, which is what carries zoom. ZXing owns the stream, so
  // it is read back off the element rather than kept in parallel.
  const videoTrack = (): MediaStreamTrack | null => {
    const source = videoRef.value?.srcObject;
    if (!(source instanceof MediaStream)) return null;
    return source.getVideoTracks()[0] ?? null;
  };

  const stop = (): void => {
    stopped = true;
    controls?.stop();
    controls = null;
    active.value = false;
    hardwareRange.value = null;
    zoom.value = 1;
  };

  const setZoom = (value: number): void => {
    const range = zoomRange.value;
    zoom.value = Math.min(range.max, Math.max(range.min, value));

    // A digital crop needs no camera call at all: the preview transform and the
    // capture crop both read `zoom` directly.
    const track = videoTrack();
    if (!hardwareRange.value || !track) return;

    // `zoom` is not in the standard constraint type, so it is set reflectively
    // rather than cast through it (§5.1).
    const constraint: MediaTrackConstraintSet = {};
    Reflect.set(constraint, 'zoom', zoom.value);
    void track.applyConstraints({ advanced: [constraint] }).catch(() => {
      // Some devices reject a mid-stream zoom change. Nothing to tell the user:
      // the picture simply stays where it was.
    });
  };

  const start = async (): Promise<void> => {
    stopped = false;
    failed.value = false;

    // The caller usually reveals the preview and starts the camera in the same
    // breath — `scanning = true; start()` — and Vue has not created the element
    // yet at that point. Waiting a tick is the difference between a working
    // scanner and a black rectangle that looks like a broken camera.
    let video = videoRef.value;
    if (!video) {
      await nextTick();
      video = videoRef.value;
    }
    if (!video) return;
    try {
      const { BrowserMultiFormatReader, BarcodeFormat } = await import(
        '@zxing/browser'
      );
      const { DecodeHintType: DecodeHint } = await import('@zxing/library');
      // Unmounted while the camera was starting up.
      if (stopped) return;

      const hints = new Map<DecodeHintType, unknown>([
        [
          DecodeHint.POSSIBLE_FORMATS,
          SCAN_FORMAT_NAMES.map((name) => BarcodeFormat[name]),
        ],
        [DecodeHint.TRY_HARDER, true],
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            // A higher-res frame gives the 1D reader enough bar detail, and
            // gives `capture()` something a model can actually read.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        video,
        (result) => {
          if (result) onDecode(result.getText());
        },
      );
      if (stopped) {
        controls.stop();
        return;
      }
      active.value = true;

      const track = videoTrack();
      hardwareRange.value = readZoomRange(track?.getCapabilities?.());
      zoom.value = zoomRange.value.min;
    } catch {
      failed.value = true;
      active.value = false;
    }
  };

  const capture = (): string | null => {
    const video = videoRef.value;
    if (!video || video.videoWidth === 0) return null;

    // Under a digital crop, take the centre of the frame at its NATIVE
    // resolution — the same region the scaled preview is showing. Cropping
    // rather than scaling up is what keeps a zoomed label readable to the model.
    const factor = hardwareRange.value ? 1 : zoom.value;
    const sourceWidth = video.videoWidth / factor;
    const sourceHeight = video.videoHeight / factor;
    const sourceX = (video.videoWidth - sourceWidth) / 2;
    const sourceY = (video.videoHeight - sourceHeight) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWidth);
    canvas.height = Math.round(sourceHeight);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    // JPEG, not PNG: this is a photograph, and the difference is megabytes on a
    // connection that may be a phone in a basement.
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  onBeforeUnmount(stop);

  return {
    videoRef,
    active,
    failed,
    start,
    stop,
    capture,
    zoomRange,
    zoom,
    setZoom,
    videoStyle,
  };
}
