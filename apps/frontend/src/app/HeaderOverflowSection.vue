<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { HEADER_OVERFLOW } from './header-overflow';

// The section of the avatar menu that receives the header's collapsed controls
// (#274). Mounting claims the teleport target, unmounting releases it — the
// menu body exists only while the menu is open, and `HeaderItem` hides a
// collapsed control whenever there is nowhere to send it.
// `divider` separates the section from what follows it — the workspaces block
// in the multiuser menu. The single-user menu has nothing below, so no rule.
withDefaults(defineProps<{ divider?: boolean }>(), { divider: true });

const body = ref<HTMLElement | null>(null);
const overflow = inject(HEADER_OVERFLOW, null);

const count = computed(() => overflow?.collapsedCount.value ?? 0);

onMounted(() => {
  if (body.value) overflow?.attachPanel(body.value);
});
onBeforeUnmount(() => overflow?.detachPanel());
</script>

<template>
  <div
    v-show="count > 0"
    class="px-2 py-2"
    :class="divider ? 'border-b border-slate-100 dark:border-white/5' : ''"
  >
    <p
      class="px-2 pb-1 text-xxs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500"
    >
      {{ $t('header.more') }}
    </p>
    <div ref="body" class="flex flex-col gap-0.5"></div>
  </div>
</template>
