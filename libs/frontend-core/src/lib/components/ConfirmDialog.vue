<script setup lang="ts">
import { computed } from 'vue';
import Modal from './Modal.vue';
import Button from './Button.vue';
import { useConfirmStore } from '../confirm-store';

// Global confirmation host. Mount once in the app shell; views trigger it via
// useConfirm(). Built on the shared Modal so Esc/backdrop cancel for free.
const store = useConfirmStore();

const isOpen = computed<boolean>({
  get: () => store.state.open,
  set: (value) => {
    // Modal emitting a close (backdrop/Esc) counts as a cancel.
    if (!value) store.respond(false);
  },
});

const isDanger = computed<boolean>(() => store.state.tone === 'danger');
</script>

<template>
  <Modal
    v-model="isOpen"
    layer="confirm"
    :title="store.state.title || undefined"
    width="sm"
    @close="store.respond(false)"
  >
    <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      {{ store.state.message }}
    </p>
    <template #footer>
      <Button variant="secondary" @click="store.respond(false)">
        {{ store.state.cancelLabel || $t('common.cancel') }}
      </Button>
      <Button
        :variant="isDanger ? 'danger' : 'primary'"
        @click="store.respond(true)"
      >
        {{ store.state.confirmLabel || $t('common.confirm') }}
      </Button>
    </template>
  </Modal>
</template>
