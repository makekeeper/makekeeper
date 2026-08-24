<script setup lang="ts">
import { HubLayout } from '@makekeeper/frontend-core';

// The Settings hub (#110): one sidebar entry, sub-sections as tabs — this
// plugin's own (General/Agent/Plugins/Updates) plus whatever another plugin
// contributes with `hub: 'settings'` (e.g. the exchange plugin's Export /
// Import), so nothing here knows its guests. A content hub: its main tab
// (General) is `/settings` itself, so landing here forwards nowhere.
</script>

<template>
  <HubLayout hubId="settings" path="/settings" labelKey="nav.settings" />
</template>
