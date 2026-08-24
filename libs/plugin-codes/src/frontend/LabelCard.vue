<script setup lang="ts">
// A single printable label (#74): the chosen code representation plus the
// human-typeable short code underneath. QR encodes the permanent `/c/<code>`
// deep-link (openable by a phone's native camera); the Code128 barcode carries
// the raw short code. Reusable — the print dialog renders one (thermal) or many
// (A4 grid) of these.
import { ref, watchEffect } from 'vue';
import { QrCode } from '@makekeeper/frontend-core';
import JsBarcode from 'jsbarcode';

const props = defineProps<{
  code: string;
  url: string;
  format: 'qr' | 'barcode';
}>();

const barcodeSvg = ref<SVGSVGElement | null>(null);

watchEffect(() => {
  if (props.format === 'barcode' && barcodeSvg.value) {
    JsBarcode(barcodeSvg.value, props.code, {
      format: 'CODE128',
      displayValue: false,
      // Code128 needs a quiet zone (blank margin) on both sides or scanners —
      // ZXing included — won't decode it. Keep bars tall for camera scanning.
      margin: 12,
      height: 70,
      width: 2,
    });
  }
});
</script>

<template>
  <!-- Always-white paper surface: a printed label must stay white/black in BOTH
       themes (a `dark:` background would leak into the printout, since `.dark`
       persists on <html> while printing). So the card colours are intentionally
       theme-independent; only the on-screen preview gets a `dark:` shadow to lift
       the paper off the dark modal — shadows are not rendered when printing. -->
  <div
    class="label-card flex flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-sm dark:shadow-lg dark:shadow-black/40"
  >
    <!-- `print`: ink on paper, whatever the interface theme is doing (#263).
         Both representations are now inline SVG, so each carries a class the
         print stylesheet can size on its own — a shared `svg` selector would
         squash the square code to the barcode's strip proportions. -->
    <QrCode
      v-if="format === 'qr'"
      :value="url"
      variant="print"
      class="label-card__qr w-full max-w-[160px] aspect-square"
    />
    <svg
      v-show="format === 'barcode'"
      ref="barcodeSvg"
      class="label-card__barcode w-full max-w-[200px]"
    />
    <span class="mt-1 font-mono text-sm font-semibold tracking-wider">
      {{ code }}
    </span>
  </div>
</template>
