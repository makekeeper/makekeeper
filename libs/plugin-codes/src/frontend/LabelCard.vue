<script setup lang="ts">
// A single printable label (#74): the chosen code representation plus the
// human-typeable short code underneath. QR encodes the permanent `/c/<code>`
// deep-link (openable by a phone's native camera); the Code128 barcode carries
// the raw short code. Reusable — the print dialog renders one (thermal) or many
// (A4 grid) of these.
import { computed, ref, watchEffect } from 'vue';
import { QrCode } from '@makekeeper/frontend-core';
import { PRODUCT_NAME } from '@makekeeper/plugin-contract';
import JsBarcode from 'jsbarcode';

const props = defineProps<{
  code: string;
  url: string;
  format: 'qr' | 'barcode';
}>();

// A QR sits BESIDE its type, a barcode keeps the column above it: the
// arrangement follows the representation and nothing else gets a say.
//
// It used to be a `layout` prop the component then overruled for barcodes — a
// knob whose value was ignored half the time, with no caller ever turning it.
// The rasteriser reads the arrangement off the card's modifier class, so this
// is also the one place that decides it for both screen and print.
const isSide = computed<boolean>(() => props.format === 'qr');

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
    class="label-card flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-sm dark:shadow-lg dark:shadow-black/40"
    :class="
      isSide
        ? 'label-card--side flex-row justify-start gap-2'
        : 'flex-col justify-center'
    "
  >
    <!-- Both lines are set in the SAME family, and it is the UI sans rather
         than a monospace pairing. The mono was there to keep 0/O and 1/I apart
         in a code people type, and that job is already done upstream: the
         random half is Crockford base32, whose alphabet has no I, L, O or U.
         What is left — the prefix — is covered by tabular figures and a little
         tracking, which a 203 dpi printhead wants anyway: a 7 pt line is about
         20 dots tall and thermal ink spreads into its neighbours, so the
         letters are given room not to close up.

         The family is `font-label` (Inter alone, declared in tailwind.config)
         rather than `font-sans`, whose display face is Outfit: see the config
         for why Inter is the one that survives 20 dots of printhead.

         The product's name across the top of every label. A brand noun, so it
         comes from the one constant that owns its casing (`PRODUCT_NAME`) and
         not from a locale file — §5.5 exempts brand nouns, and a translated
         brand would be a different brand — which is also why it is NOT
         uppercased: the inner capital is the name. (And `text-transform` does
         not survive into the printed raster, so an uppercase class here would
         make the label disagree with its own preview.) Each line of type
         carries a class of its own: the print rule sizes them separately, and
         the rasteriser picks them out by name rather than by "the first
         span". -->
    <span
      v-if="!isSide"
      class="label-card__brand font-label text-xxs font-semibold tracking-label-brand tabular-nums"
    >
      {{ PRODUCT_NAME }}
    </span>
    <!-- `print`: ink on paper, whatever the interface theme is doing (#263).
         Both representations are now inline SVG, so each carries a class the
         print stylesheet can size on its own — a shared `svg` selector would
         squash the square code to the barcode's strip proportions. -->
    <!-- Beside its type the code must not be the thing that gives way: a flex
         row would otherwise shrink it to whatever the text left over (it
         collapsed to a third of its size, and the code wrapped onto two
         lines). So in that arrangement it takes a fixed share of the card —
         the same half of the width it takes on the sticker — and refuses to
         shrink. -->
    <QrCode
      v-if="format === 'qr'"
      :value="url"
      variant="print"
      class="label-card__qr aspect-square"
      :class="isSide ? 'w-1/2 shrink-0' : 'w-full max-w-[140px]'"
    />
    <svg
      v-show="format === 'barcode'"
      ref="barcodeSvg"
      class="label-card__barcode w-full max-w-[200px]"
    />
    <span
      v-if="!isSide"
      class="label-card__code mt-1 font-label text-sm font-semibold tracking-label-code tabular-nums"
    >
      {{ code }}
    </span>
    <!-- Side layout: both lines of type in their own column, left-aligned
         against the code rather than centred under it. -->
    <div v-else class="flex min-w-0 flex-col items-start gap-1">
      <!-- Both lines stay on one line each: a wrapped short code is a code
           somebody reads wrong, and on paper there is no wrapping to mimic. -->
      <span
        class="label-card__brand whitespace-nowrap font-label text-xxs font-semibold tracking-label-brand tabular-nums"
      >
        {{ PRODUCT_NAME }}
      </span>
      <span
        class="label-card__code whitespace-nowrap font-label text-sm font-semibold tracking-label-code tabular-nums"
      >
        {{ code }}
      </span>
    </div>
  </div>
</template>
