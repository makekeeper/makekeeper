<script setup lang="ts">
import { computed, type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import Spinner from './Spinner.vue';

// The one dashboard stat tile: an icon chip, a small label and a key figure.
// Plugins compose their `stat`-sized dashboard widgets from this primitive so
// every tile keeps the same geometry, tones and focus treatment. `to` turns
// the whole tile into a router link.
const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    icon: Component;
    to?: RouteLocationRaw;
    tone?: 'brand' | 'amber' | 'emerald' | 'red';
    loading?: boolean;
  }>(),
  {
    to: undefined,
    tone: 'brand',
    loading: false,
  },
);

// Static class maps — Tailwind only generates classes it can see verbatim.
const CHIP_TONES = {
  brand: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
} as const;

const HOVER_TONES = {
  brand: 'hover:border-brand-500/20',
  amber: 'hover:border-amber-500/20',
  emerald: 'hover:border-emerald-500/20',
  red: 'hover:border-red-500/20',
} as const;

const chipClass = computed(() => CHIP_TONES[props.tone]);
const hoverClass = computed(() => HOVER_TONES[props.tone]);
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    class="glass-card rounded-2xl p-5 flex items-center gap-4 transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
    :class="hoverClass"
  >
    <div
      class="w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform duration-300 shrink-0"
      :class="chipClass"
    >
      <component :is="icon" class="w-6 h-6" />
    </div>
    <div class="min-w-0">
      <span
        class="text-xs text-slate-500 dark:text-slate-400 block font-medium truncate"
      >
        {{ label }}
      </span>
      <Spinner v-if="loading" size="sm" class="mt-2" />
      <span
        v-else
        class="text-2xl font-bold text-slate-900 dark:text-white leading-none mt-1 block"
      >
        {{ value }}
      </span>
    </div>
  </component>
</template>
