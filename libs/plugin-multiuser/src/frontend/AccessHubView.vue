<script setup lang="ts">
import { HubLayout } from '@makekeeper/frontend-core';

// The Access hub (#110): a pure CONTAINER — it has no content of its own, so
// landing on `/access` forwards to the first tab the current user may see
// (admin → Users, regular user → Sharing).
</script>

<template>
  <HubLayout hubId="access" path="/access" labelKey="nav.access" />
</template>
