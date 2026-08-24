<script setup lang="ts">
import { computed } from 'vue';

// Semantic pill badge. `tone` maps to the app's status/permission colour system
// (emerald/amber/red/slate + brand), so agent-permission levels, order statuses
// and priorities all render from one source instead of ad-hoc inline classes.
export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  // Aliases for the agent-capabilities permission levels (READ/WRITE/DESTRUCTIVE).
  | 'read'
  | 'write'
  | 'destructive'
  // A badge sitting ON a picture (the photo gallery's cover mark). The one tone
  // that carries NO `dark:` pairing, for the same reason `Button`'s overlay
  // variants do not: a photograph is its own background, so the chip has to be
  // opaque and light-on-dark in both themes or it disappears against whatever
  // the picture happens to be.
  | 'overlay';

// Two shapes, because two different jobs kept being asked of this component and
// the second one was answered with hand-classed spans instead.
//
// `status` — the small round shouty pill: a state, a permission level, a count.
// Short, uppercase, bold, and it never wraps in practice.
//
// `label` — a piece of the object's own DATA wearing a chip: a category name, a
// tag-like value. It is arbitrary text a person typed, so it is set in natural
// case at a readable size, and it MUST survive wrapping. That last part is why
// this is a variant and not a caller's `class`: a hand-rolled inline pill splits
// its background and border into one fragment per line the moment the text
// wraps, which is exactly what "Кнопки и переключатели" did in the item list.
export type BadgeVariant = 'status' | 'label';

const props = withDefaults(
  defineProps<{
    tone?: BadgeTone;
    variant?: BadgeVariant;
    uppercase?: boolean;
  }>(),
  {
    tone: 'neutral',
    variant: 'status',
    uppercase: true,
  },
);

const toneClass = computed<string>(() => {
  const map = {
    neutral: 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400',
    brand: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
    success:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    warning:
      'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    danger: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    read: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    write:
      'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    destructive: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    overlay: 'bg-brand-500/90 text-white backdrop-blur',
  } satisfies Record<BadgeTone, string>;
  // A tone this component does not know renders NEUTRAL rather than bare.
  // Callers typed their own unions and passed the colour names behind the
  // tones (`emerald`, `amber`, `red`), which looked up nothing: every status
  // badge in the external-plugins list rendered with no colour at all and
  // nothing failed. The type is exported now, and this is the belt.
  return map[props.tone] ?? map.neutral;
});

const variantClass = computed<string>(() => {
  const map = {
    status: 'px-2 py-0.5 rounded-full text-xxs font-bold tracking-wide',
    label: 'px-2.5 py-1 rounded-lg text-xs font-medium leading-snug',
  } satisfies Record<BadgeVariant, string>;
  return map[props.variant] ?? map.status;
});

// Upper-casing somebody's data mangles it — a `label` is never shouted, whatever
// the caller passes.
const isUppercase = computed<boolean>(
  () => props.variant === 'status' && props.uppercase,
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1 max-w-full"
    :class="[toneClass, variantClass, isUppercase ? 'uppercase' : '']"
  >
    <slot />
  </span>
</template>
