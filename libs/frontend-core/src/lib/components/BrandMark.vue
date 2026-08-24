<script setup lang="ts">
import { computed } from 'vue';
import {
  BRAND_MARK_CELL,
  BRAND_MARK_CELLS,
  BRAND_MARK_PITCH,
  BRAND_MARK_SIZE,
} from '../brand-mark';

// The one place the app signs itself (#260) — the sidebar rail, the login
// screen, the phone's front door. It renders the LOCKUP, not just the glyph:
// the mark knocked out in white on the accent tile, decided once here so the
// three surfaces cannot drift apart (they did, when each hand-rolled a tile
// around whatever Lucide icon stood in for the logo).
//
// Inline SVG rather than `<img src="logo-mono.svg">` on purpose: the accent
// comes from `brand-*` (i.e. the active colour scheme's `--mk-brand-*`), and an
// `<img>` is opaque to the cascade. The gradient is the same one the sidebar
// tile has always worn — light and dark share it, because it is drawn from the
// accent, which each scheme defines for both themes.
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    /**
     * `lockup` is the mark as it signs the app: the glyph knocked out in white
     * on the accent tile. `glyph` is the bare geometry in `currentColor`, for
     * the one case that has its own container already — the header's avatar
     * circle in single-user mode (#274), where the product signs a seat that
     * belongs to no person. A caller wanting the mark inside its own shape
     * takes this rather than re-deriving the geometry.
     */
    variant?: 'lockup' | 'glyph';
    /** Decorative by default: every current usage sits beside the app's name. */
    label?: string;
  }>(),
  { size: 'md', variant: 'lockup', label: '' },
);

const tileClass = computed<string>(() => {
  const map = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-11 h-11 rounded-xl',
  } satisfies Record<NonNullable<typeof props.size>, string>;
  return map[props.size];
});

const glyphClass = computed<string>(() => {
  const map = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  } satisfies Record<NonNullable<typeof props.size>, string>;
  return map[props.size];
});

const viewBox = `0 0 ${BRAND_MARK_SIZE} ${BRAND_MARK_SIZE}`;
const cells = BRAND_MARK_CELLS.map(([column, row]) => ({
  key: `${column}-${row}`,
  x: column * BRAND_MARK_PITCH,
  y: row * BRAND_MARK_PITCH,
}));
const cell = BRAND_MARK_CELL;
</script>

<template>
  <!-- `currentColor` rather than a literal, so the knocked-out treatment
       survives anyone restyling the tile — and so the bare `glyph` variant
       simply inherits whatever colour its own container sets. -->
  <svg
    v-if="variant === 'glyph'"
    :class="glyphClass"
    :viewBox="viewBox"
    fill="currentColor"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : true"
  >
    <rect
      v-for="c in cells"
      :key="c.key"
      :x="c.x"
      :y="c.y"
      :width="cell"
      :height="cell"
    />
  </svg>

  <span
    v-else
    class="flex items-center justify-center shrink-0 bg-gradient-to-tr from-brand-600 to-brand-400 text-white shadow-lg shadow-brand-500/20"
    :class="tileClass"
  >
    <svg
      :class="glyphClass"
      :viewBox="viewBox"
      fill="currentColor"
      :role="label ? 'img' : undefined"
      :aria-label="label || undefined"
      :aria-hidden="label ? undefined : true"
    >
      <rect
        v-for="c in cells"
        :key="c.key"
        :x="c.x"
        :y="c.y"
        :width="cell"
        :height="cell"
      />
    </svg>
  </span>
</template>
