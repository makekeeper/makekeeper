<script setup lang="ts">
import { h, type VNode } from 'vue';
import { renderMarkdown } from './markdown';

const props = defineProps<{ source: string }>();

// renderMarkdown turns the model reply into an escaped VNode tree (no v-html → no
// injection). A functional component wraps it so a plain <script setup> can render
// the programmatic tree via <component :is>.
const root = (): VNode =>
  h(
    'div',
    { class: 'space-y-2 break-words text-sm leading-relaxed' },
    renderMarkdown(props.source),
  );
</script>

<template>
  <component :is="root" />
</template>
