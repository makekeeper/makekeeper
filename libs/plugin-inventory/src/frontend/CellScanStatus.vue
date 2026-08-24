<script setup lang="ts">
// The "filing into this cell" badge in a storage cell's header (#79),
// contributed by inventory into `storages.cell.status`. Same three-plugin chain
// as the trigger: storages names the cell, inventory owns what happens to items
// in it, codes owns the scan session — so this only re-exposes the cell's ORef
// to codes' indicator, which decides whether a session is running for THAT cell.
// Renders nothing when codes is disabled or nothing is running.
import { PluginSlot } from '@makekeeper/frontend-core';

defineProps<{ entityRef: string }>();
</script>

<template>
  <PluginSlot name="inventory.cell.scanStatus" :ctx="{ entityRef }" />
</template>
