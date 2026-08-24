<script setup lang="ts">
// Generic host for cross-plugin UI contributions (#58): renders every enabled
// plugin's contribution registered for `name`, in `order`. The host passes
// slot-specific data and callbacks through `ctx`, spread onto each
// contribution as props — the slot's contract (documented in docs/plugins.md)
// defines what a contributor may expect. Purely structural, so it adds no
// wrapper element of its own.
import { useSlotContributions } from '../contributions';

const props = defineProps<{
  name: string;
  // `object`, not `Record<string, unknown>`: a slot's contract is a declared
  // interface in plugin-contract (an interface has no implicit index signature),
  // and hosts should pass that type rather than an untyped literal.
  ctx?: object;
}>();

const contributions = useSlotContributions(props.name);
</script>

<template>
  <component
    :is="contribution.component"
    v-for="(contribution, index) in contributions"
    :key="`${contribution.pluginId}:${index}`"
    v-bind="props.ctx"
  />
</template>
