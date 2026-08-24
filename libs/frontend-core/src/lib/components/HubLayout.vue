<script setup lang="ts">
import { RouterView } from 'vue-router';
import PageTabs from './PageTabs.vue';
import { useHubTabs, useHubRedirect } from '../navigation';

// The layout every tabbed hub shares (#110): the hub's visible tabs as a tab
// bar over a `<RouterView>` for the active tab. The tab set is declared data —
// the hub owner's own tabs plus whatever another plugin contributes with
// `hub: '<hubId>'` — so a hub never knows its guests.
//
// Content hubs and container hubs use the same layout: the redirect is inert
// unless the hub root has no tab of its own (Settings' General tab IS
// `/settings`, so nothing fires; `/access` forwards to its first visible tab).
const props = defineProps<{
  // The hub this layout renders, matching the `hubId` on its sidebar entry.
  hubId: string;
  // The hub's own route path, i.e. the tab bar's root.
  path: string;
  // i18n key naming the hub, used as the tab bar's accessible name.
  labelKey: string;
}>();

const tabs = useHubTabs(props.hubId);
useHubRedirect(props.path, tabs);
</script>

<template>
  <div class="space-y-6">
    <PageTabs :tabs="tabs" :ariaLabel="$t(labelKey)" />
    <RouterView />
  </div>
</template>
