<script setup lang="ts">
// "Print label" button (#74): mounted into a host-declared labelable slot
// (`manifest.codes.labelable[].slot`) via a manifest-driven contribution. The
// host passes the current object's canonical ORef through the slot ctx as
// `entityRef`; the button self-hides when there's no ref (e.g. an unsaved form).
import { ref } from 'vue';
import { Button } from '@makekeeper/frontend-core';
import { QrCode } from '@lucide/vue';
import PrintLabelDialog from './PrintLabelDialog.vue';

const props = defineProps<{ entityRef?: string }>();

const open = ref(false);
</script>

<template>
  <Button
    v-if="props.entityRef"
    variant="secondary"
    size="sm"
    :icon-left="QrCode"
    @click="open = true"
  >
    {{ $t('codes.print.button') }}
  </Button>
  <PrintLabelDialog
    v-if="props.entityRef"
    v-model="open"
    :entity-ref="props.entityRef"
  />
</template>
