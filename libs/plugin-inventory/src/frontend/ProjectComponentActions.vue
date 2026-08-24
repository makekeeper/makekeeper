<script setup lang="ts">
// Per-row stock actions on the project BOM table (#58), contributed by
// inventory into the projects plugin: reserving, consuming and releasing
// physical stock are inventory functionality, so these buttons and modals
// exist only while inventory is enabled. Calls inventory's own endpoints;
// the host refreshes via `onChanged`.
import { ref } from 'vue';
import {
  Button,
  Modal,
  apiFetch,
  useToastStore,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';

interface BomRow {
  componentId: string;
  neededQty: number;
  reservedQty: number;
  component: { name: string; quantity: number };
}

const props = defineProps<{
  projectId: string;
  pc: BomRow;
  // The projects-side "reservations" display lens (#53), passed through so the
  // contribution follows the same simple/advanced behavior as the host table.
  showReservations: boolean;
  onChanged: () => Promise<void> | void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const showReserveModal = ref(false);
const isUnreserve = ref(false);
const reserveAmount = ref(1);

const showConsumeModal = ref(false);
const consumeAmount = ref(1);

const openReserveModal = (unreserve: boolean): void => {
  isUnreserve.value = unreserve;
  if (!unreserve) {
    const deficit = props.pc.neededQty - props.pc.reservedQty;
    reserveAmount.value = Math.max(
      1,
      Math.min(deficit, props.pc.component.quantity),
    );
  } else {
    reserveAmount.value = props.pc.reservedQty;
  }
  showReserveModal.value = true;
};

const handleReserve = async (): Promise<void> => {
  try {
    const qty = isUnreserve.value ? -reserveAmount.value : reserveAmount.value;
    const response = await apiFetch(
      `/api/components/${props.pc.componentId}/reserve`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: props.projectId, qty }),
      },
    );
    if (response.ok) {
      showReserveModal.value = false;
      await props.onChanged();
    } else {
      const err = await response.json();
      toast.error(err.message || t('inventory.stock.reserveError'));
    }
  } catch {
    toast.error(t('inventory.stock.reserveError'));
  }
};

const openConsumeModal = (): void => {
  consumeAmount.value = props.pc.reservedQty;
  showConsumeModal.value = true;
};

const handleConsume = async (): Promise<void> => {
  try {
    const response = await apiFetch(
      `/api/components/${props.pc.componentId}/consume`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: props.projectId,
          qty: consumeAmount.value,
        }),
      },
    );
    if (response.ok) {
      showConsumeModal.value = false;
      await props.onChanged();
    } else {
      const err = await response.json();
      toast.error(err.message || t('inventory.stock.consumeError'));
    }
  } catch {
    toast.error(t('inventory.stock.consumeError'));
  }
};
</script>

<template>
  <button
    v-if="
      props.showReservations &&
      pc.reservedQty < pc.neededQty &&
      pc.component.quantity > 0
    "
    @click="openReserveModal(false)"
    class="px-2.5 py-1 bg-brand-500/10 text-brand-600 dark:text-brand-400 hover:bg-brand-500/20 rounded-lg text-xxs font-bold transition-all"
  >
    {{ t('inventory.stock.reserveBtn') }}
  </button>
  <button
    v-if="pc.reservedQty > 0"
    @click="openConsumeModal"
    class="px-2.5 py-1 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 rounded-lg text-xxs font-bold transition-all"
  >
    {{ t('inventory.stock.consumeBtn') }}
  </button>
  <button
    v-if="props.showReservations && pc.reservedQty > 0"
    @click="openReserveModal(true)"
    class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 rounded-lg text-xxs font-bold transition-all"
  >
    {{ t('inventory.stock.unreserveBtn') }}
  </button>

  <!-- Reserve / release modal -->
  <Modal
    v-model="showReserveModal"
    width="sm"
    :title="
      isUnreserve
        ? t('inventory.stock.unreserveModalTitle')
        : t('inventory.stock.reserveModalTitle')
    "
  >
    <form @submit.prevent="handleReserve" class="space-y-4">
      <p class="text-xs text-slate-500 leading-relaxed">
        {{ t('inventory.stock.modalPart') }}
        <strong class="text-slate-700 dark:text-slate-200">{{
          pc.component.name
        }}</strong>
        <br />
        {{
          isUnreserve
            ? t('inventory.stock.modalReservedQty', { qty: pc.reservedQty })
            : t('inventory.stock.modalAvailableQty', {
                qty: pc.component.quantity,
                needed: pc.neededQty,
              })
        }}
      </p>

      <div class="space-y-1.5">
        <label
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('inventory.stock.modalQuantityLabel') }}</label
        >
        <input
          v-model.number="reserveAmount"
          type="number"
          min="1"
          :max="
            isUnreserve
              ? pc.reservedQty
              : Math.min(pc.component.quantity, pc.neededQty - pc.reservedQty)
          "
          class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          required
        />
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <Button variant="secondary" @click="showReserveModal = false">
          {{ t('projectDetail.cancel') }}
        </Button>
        <Button type="submit">
          {{
            isUnreserve
              ? t('inventory.stock.unreserveBtn')
              : t('inventory.stock.reserveBtn')
          }}
        </Button>
      </div>
    </form>
  </Modal>

  <!-- Consume (USED) reserved stock into the project -->
  <Modal
    v-model="showConsumeModal"
    width="sm"
    :title="t('inventory.stock.consumeModalTitle')"
  >
    <form class="space-y-4" @submit.prevent="handleConsume">
      <p class="text-xs text-slate-500 leading-relaxed">
        {{ t('inventory.stock.modalPart') }}
        <strong class="text-slate-700 dark:text-slate-200">{{
          pc.component.name
        }}</strong>
        <br />
        {{ t('inventory.stock.modalReservedQty', { qty: pc.reservedQty }) }}
      </p>

      <div class="space-y-1.5">
        <label
          class="text-xs font-bold text-slate-600 dark:text-slate-400 block"
          >{{ t('inventory.stock.modalQuantityLabel') }}</label
        >
        <input
          v-model.number="consumeAmount"
          type="number"
          min="1"
          :max="pc.reservedQty"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
          required
        />
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <Button
          variant="secondary"
          type="button"
          @click="showConsumeModal = false"
        >
          {{ t('projectDetail.cancel') }}
        </Button>
        <Button variant="danger" type="submit">
          {{ t('inventory.stock.consumeBtn') }}
        </Button>
      </div>
    </form>
  </Modal>
</template>
