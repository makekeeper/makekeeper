<script setup lang="ts">
import {
  Button,
  EmptyState,
  PluginSlot,
  resolvePluginIcon,
  useMobileNav,
} from '@makekeeper/frontend-core';

// The mobile surface's own landing screen: what this device can do here.
//
// Installation is NOT offered here (#210). It belongs on the pairing screen —
// the one a phone opens on before it has a credential — because an installed app
// pairs as itself anyway, so installing after pairing only means pairing twice.

const tabs = useMobileNav();
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- No heading here: the shell's header carries the title and subtitle of
         every screen on this surface, so a view never grows one of its own.

         What each phone screen is for, written by the plugin that owns it: this
         shell has no business describing somebody else's buttons, and a
         disabled plugin takes its own instructions with it. -->
    <PluginSlot name="mobile.home.help" />

    <section v-if="tabs.length > 0" class="space-y-2">
      <Button
        v-for="tab in tabs"
        :key="tab.path"
        variant="secondary"
        block
        :to="tab.path"
        :icon-left="resolvePluginIcon(tab.icon)"
      >
        {{ $t(tab.titleKey) }}
      </Button>
    </section>

    <EmptyState v-else :title="$t('mobile.home.noSurfaces')" />
  </div>
</template>
