<script setup lang="ts">
import { computed } from 'vue';
import { X } from '@lucide/vue';
import { isHexColor, isTagColor, type TagColor } from '../tag-colors';

// A tag pill. Colour is either a palette tone (mapped to full Tailwind class
// literals — real design-system steps, light + dark, scannable by Tailwind per
// §5.4) OR a user-picked "#rrggbb" hex, rendered via an inline style. The hex
// case is the one sanctioned §5.4 exception: it is user content, not a UI token,
// so it cannot live in the Tailwind config.
const props = withDefaults(
  defineProps<{
    name: string;
    color?: string;
    removable?: boolean;
    compact?: boolean;
  }>(),
  { color: 'slate', removable: false, compact: false },
);

const emit = defineEmits<{ (e: 'remove'): void }>();

const TONE_CLASS = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  orange:
    'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  emerald:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet:
    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  brand:
    'bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
} satisfies Record<TagColor, string>;

// Tone → token classes; hex → none (the inline style drives colour); anything
// else → slate.
const toneClass = computed<string>(() =>
  isTagColor(props.color)
    ? TONE_CLASS[props.color]
    : isHexColor(props.color)
      ? ''
      : TONE_CLASS.slate,
);

// For a hex colour: a faint tint of it as the background (`+22` ≈ 13% alpha) and
// the full colour as the text — readable in both themes.
const customStyle = computed<Record<string, string> | undefined>(() =>
  isHexColor(props.color)
    ? { backgroundColor: `${props.color}22`, color: props.color }
    : undefined,
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full font-semibold"
    :class="[
      toneClass,
      compact ? 'px-2 py-0.5 text-xxs' : 'px-2.5 py-1 text-xs',
    ]"
    :style="customStyle"
  >
    <slot>{{ name }}</slot>
    <button
      v-if="removable"
      type="button"
      class="rounded-full p-0.5 -mr-1 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      :aria-label="$t('tags.chip.remove', { name })"
      @click.stop="emit('remove')"
    >
      <X class="w-3 h-3" />
    </button>
  </span>
</template>
