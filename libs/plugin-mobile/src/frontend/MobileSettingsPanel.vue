<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '@makekeeper/frontend-core';
import PublishingSection from './PublishingSection.vue';
import DevicesSection from './DevicesSection.vue';

// Everything this plugin administers, as ONE group in Settings → General (#261)
// — the same place every other plugin's settings live. It used to own two tabs
// of its own in the Settings hub, which read as two unrelated sections carrying
// the same icon.
//
// The group is not uniformly admin territory, which is why the manifest does NOT
// carry `settingsAdminOnly`: publishing is instance administration and hides
// itself from a regular user, while pairing a phone is that user's own business
// and must stay reachable. The backend keeps `@AdminOnly()` on the publishing
// routes regardless — this only decides what is drawn.
const session = useSessionStore();
const canAdminister = computed<boolean>(
  () => !session.multiuserEnabled || session.isAdmin,
);
</script>

<template>
  <div class="space-y-6">
    <template v-if="canAdminister">
      <PublishingSection />
      <hr class="border-slate-200 dark:border-white/10" />
    </template>
    <DevicesSection />
  </div>
</template>
