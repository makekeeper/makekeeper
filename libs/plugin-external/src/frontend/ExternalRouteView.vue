<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ExternalScreen from './ExternalScreen.vue';

// The component every routed external screen mounts. The (pluginId, screen)
// pair travels in the route's `meta` — one component serves every external
// screen of every external plugin, so registering a new one at runtime is
// pure data, never a new bundle.

const route = useRoute();

const pluginId = computed<string>(() =>
  typeof route.meta['externalPluginId'] === 'string'
    ? route.meta['externalPluginId']
    : '',
);
const screen = computed<string>(() =>
  typeof route.meta['externalScreen'] === 'string'
    ? route.meta['externalScreen']
    : '',
);
</script>

<template>
  <ExternalScreen
    :key="`${pluginId}:${screen}`"
    :plugin-id="pluginId"
    :screen="screen"
    surface="screen"
    with-header
  />
</template>
