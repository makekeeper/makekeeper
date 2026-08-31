<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown } from '@lucide/vue';

// A titled block that folds away — the shape a page uses for material that is
// read once and then never again (reference, recipes, "how do I get this
// value"), so it stops competing with the controls the page exists for.
//
// Controlled, never self-managed: the owner holds the open flag, because the
// thing that opens a fold is rarely the fold itself (a link elsewhere on the
// page, a route, a validation error inside it). `reveal()` is the other half of
// that — scroll to the block and put focus on its toggle, so a link that opens
// it also takes the reader there.
//
// The content is hidden with `v-show`, not `v-if`: state inside a fold (a
// picked tab, a typed field) has to survive being closed, and a block whose
// height is measured while it is open must keep that height.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    // Ties the toggle to the region it controls; also the anchor an in-page link
    // can point at.
    contentId: string;
    // `card` is the page-level block. `inline` drops the card and its padding
    // for a fold INSIDE something that already has both — a dialog, a panel —
    // where a second card would read as a second surface.
    variant?: 'card' | 'inline';
  }>(),
  { description: undefined, variant: 'card' },
);

const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

const root = ref<HTMLElement | null>(null);
const toggle = ref<HTMLButtonElement | null>(null);

// The two halves fight each other unless both are told not to: `focus()` scrolls
// the element into view synchronously (aligned `nearest`), which aborts a smooth
// scroll already under way and lands the reader somewhere else — so the focus
// call must keep its hands off the viewport. And a glide is a motion effect: a
// reader who asked for less of it gets the jump instead.
function reveal(): void {
  // Guarded like the rest of the repo's media queries: no `matchMedia` at all
  // (jsdom, an ancient engine) answers "no preference expressed".
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.value?.scrollIntoView({
    behavior: reduced ? 'auto' : 'smooth',
    block: 'start',
  });
  toggle.value?.focus({ preventScroll: true });
}

defineExpose({ reveal });
</script>

<template>
  <section
    ref="root"
    :class="props.variant === 'card' ? 'glass-card rounded-2xl' : ''"
  >
    <h3>
      <button
        ref="toggle"
        type="button"
        class="flex w-full items-center gap-3 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :class="props.variant === 'card' ? 'p-6' : 'py-2'"
        :aria-expanded="props.open"
        :aria-controls="props.contentId"
        @click="emit('update:open', !props.open)"
      >
        <span class="min-w-0 flex-1">
          <span
            class="block font-medium text-slate-900 dark:text-slate-100"
            :class="props.variant === 'inline' ? 'text-sm' : ''"
          >
            {{ props.title }}
          </span>
          <span
            v-if="props.description"
            class="mt-1 block text-sm text-slate-500 dark:text-slate-400"
          >
            {{ props.description }}
          </span>
        </span>
        <ChevronDown
          class="h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-slate-500"
          :class="props.open ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </h3>
    <div
      v-show="props.open"
      :id="props.contentId"
      class="space-y-4"
      :class="props.variant === 'card' ? 'px-6 pb-6' : 'pb-2'"
    >
      <slot />
    </div>
  </section>
</template>
