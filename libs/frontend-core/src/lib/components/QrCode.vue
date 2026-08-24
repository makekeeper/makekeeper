<script setup lang="ts">
// The app's QR code (#263). Every code the product draws comes from here —
// print labels, the phone-bridge modal, device pairing — so they cannot drift
// into three different sizes and error-correction levels again.
//
// The SVG is inline rather than an <img src="data:…">, and that is the whole
// point: an image is opaque to the cascade, so a code drawn as one can follow
// neither the light/dark theme nor the active colour scheme (#236). Inline, the
// modules and the finder patterns take their colour from Tailwind utilities and
// repaint themselves when either changes, with no JavaScript involved.
//
// Geometry (and the reasoning behind each radius) lives in `qr-code.ts`.
import { ref, computed, watch } from 'vue';
import { buildQrGeometry, createQrMatrix, type QrGeometry } from '../qr-code';

const props = withDefaults(
  defineProps<{
    /** The string to encode — normally a URL. */
    value: string;
    /**
     * `themed` follows the interface theme and colour scheme; `print` is ink on
     * paper — black on white whatever the interface is doing. The themed
     * variant also falls back to black on white when printed, so a screen that
     * happens to be printed never sends a tinted code to a printer.
     */
    variant?: 'themed' | 'print';
    /** Announced name; omit for a code that merely repeats an adjacent link. */
    label?: string;
  }>(),
  { variant: 'themed', label: '' },
);

const geometry = ref<QrGeometry | null>(null);

// Guarded by a token rather than a flag: `value` can change again while the
// encoder chunk is still loading, and a late answer must not overwrite a newer
// one (nor paint after the component is gone).
let latest = 0;
watch(
  () => props.value,
  async (value) => {
    const token = ++latest;
    const matrix = await createQrMatrix(value).catch(() => null);
    if (token !== latest) return;
    geometry.value = matrix ? buildQrGeometry(matrix) : null;
  },
  { immediate: true },
);

const viewBox = computed<string>(() =>
  geometry.value
    ? `0 0 ${geometry.value.size} ${geometry.value.size}`
    : '0 0 1 1',
);

// The palette follows the theme through the ACCENT and a tint, never by
// inverting. A light-on-dark code is the obvious way to "support dark mode" and
// it is the wrong one: the app's own scanner is ZXing, which does not invert,
// and `QrCode.spec.ts` records that every inverted rendering it was offered
// failed to decode at every size tested. So the code keeps reading as a
// piece of paper in both themes — dark mode tints that paper with the scheme's
// lightest step instead of turning it into a hole.
//
// The accent is pinned at `brand-600` — the app's accent-on-light step — and
// not one step lighter: at `brand-500` the finder patterns stop binarising and
// codes drop out at some sizes in five of the six schemes. 600 is the floor,
// not a preference.
//
// This is where the implementation parts company with the design handoff, which
// ships three fixed palettes (`amber`, `cream`, `mono`). Two of them would be a
// second identity beside the six schemes the app already has, and the amber one
// is inverted; the ticket asks for codes that follow the CHOSEN theme, so the
// scheme's own tokens stand in for the two screen palettes. The handoff's
// `mono` survives as the print variant.
//
// One object rather than four parallel ternaries: a variant is a palette, and
// adding one should be a single entry here.
const palette = computed(() => {
  const themed = {
    plate: 'fill-white dark:fill-brand-50 print:fill-white',
    // The data modules carry the payload, so they take the strongest contrast
    // available and stay the same near-black in both themes.
    module: 'fill-slate-900',
    accentFill: 'fill-brand-600 print:fill-slate-900',
    accentStroke: 'stroke-brand-600 print:stroke-slate-900',
  };
  const print = {
    plate: 'fill-white',
    module: 'fill-slate-900',
    accentFill: 'fill-slate-900',
    accentStroke: 'stroke-slate-900',
  } satisfies typeof themed;
  return props.variant === 'print' ? print : themed;
});
</script>

<template>
  <svg
    :viewBox="viewBox"
    xmlns="http://www.w3.org/2000/svg"
    shape-rendering="geometricPrecision"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : true"
  >
    <!-- Nothing is painted until the matrix arrives. Every call site gives the
         code a fixed box, so there is no layout shift to guard against — and a
         plate painted early is a white card flashing on a dark surface. -->
    <template v-if="geometry">
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        :rx="geometry.plateRadius"
        :class="palette.plate"
      />
      <path :d="geometry.modulesPath" :class="palette.module" />
      <path
        :d="geometry.finderRingPath"
        fill-rule="evenodd"
        :class="palette.accentFill"
      />
      <path :d="geometry.finderPupilPath" :class="palette.accentFill" />
      <!-- Window first, then ring, then the mark: the window knocks the data
           modules out behind the mark so nothing shows through it. -->
      <template v-if="geometry.centre">
        <rect
          :x="geometry.centre.window.x"
          :y="geometry.centre.window.y"
          :width="geometry.centre.window.size"
          :height="geometry.centre.window.size"
          :rx="geometry.centre.window.radius"
          :class="palette.plate"
        />
        <rect
          :x="geometry.centre.ring.x"
          :y="geometry.centre.ring.y"
          :width="geometry.centre.ring.size"
          :height="geometry.centre.ring.size"
          :rx="geometry.centre.ring.radius"
          :stroke-width="geometry.centre.ring.width"
          fill="none"
          :class="palette.accentStroke"
        />
        <rect
          v-for="(cell, index) in geometry.centre.mark"
          :key="index"
          :x="cell.x"
          :y="cell.y"
          :width="cell.size"
          :height="cell.size"
          :class="palette.accentFill"
        />
      </template>
    </template>
  </svg>
</template>
