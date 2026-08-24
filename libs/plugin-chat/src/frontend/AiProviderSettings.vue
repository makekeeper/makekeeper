<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '@makekeeper/frontend-core';
import ProviderConnections from './ProviderConnections.vue';
import AttachmentRulesSettings from './AttachmentRulesSettings.vue';

// The chat plugin's settings surface: the connection list, plus the attachment
// ruleset (#112) as a second group. Admins (and the single-user mode) manage
// the instance connections — with per-row sharing toggles for "all users" and
// "guests of my workspace" (the admin is a workspace owner too). Regular
// multiuser accounts manage their personal connections with the guest-sharing
// toggle only.
//
// One `personal` flag governs both groups on purpose: the attachment rules
// belong to whoever owns the connection a turn runs on, so the ruleset an
// account can edit here is the one that will apply to it.
const session = useSessionStore();

const personal = computed<boolean>(
  () => session.multiuserEnabled && !session.isAdmin,
);
</script>

<template>
  <div class="space-y-8">
    <ProviderConnections :personal="personal" />
    <AttachmentRulesSettings :personal="personal" />
  </div>
</template>
