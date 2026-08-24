<script setup lang="ts">
// "Scan items into this cell" (#79), contributed by inventory into the storages
// slot `storages.cell.actions`. Placement lives on the component
// (storageId/row/col), which inventory owns — so storages names the cell and
// this owns the write. The scanning itself belongs to codes: this renders the
// slot codes declared in inventory's manifest (`codes.scan.slot`), hands it the
// actions the phone should offer, and receives the confirmed scans back. With
// codes disabled the inner slot is empty and nothing is shown.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  parseObjectRef,
  type PhoneBridgeScanAction,
  type ScanContextSlotCtx,
  type StorageCellActionsSlotCtx,
} from '@makekeeper/plugin-contract';
import { PluginSlot, apiFetch, useToastStore } from '@makekeeper/frontend-core';

// The props ARE the host's slot ctx — typed against the contract in
// plugin-contract rather than re-spelled here, so the two cannot drift.
const props = defineProps<StorageCellActionsSlotCtx>();

const { t } = useI18n();
const toast = useToastStore();

// What the phone offers once a code resolves: only a component can be filed
// into a cell, so anything else keeps the action disabled on the phone.
const actions = computed<PhoneBridgeScanAction[]>(() => [
  {
    key: 'place',
    labelKey: 'inventory.cellScan.place',
    labelParams: { cell: props.cellAddress },
    entityTypes: ['component'],
  },
]);

const contextLabel = computed<string>(() =>
  t('inventory.cellScan.contextLabel', { cell: props.cellAddress }),
);

// The handler CLOSES OVER the cell it was created for instead of reading props
// when a scan arrives: the session outlives this screen, so a scan started at
// B1 must keep filing into B1 even after the user opened another cell (or left
// the storages view entirely).
const onScan = computed(() => {
  const target = {
    storageId: props.storageId,
    row: props.row,
    col: props.col,
    cell: props.cellAddress,
  };
  const notifyHost = props.onChanged;

  // One confirmed scan. codes has already resolved the raw string to a canonical
  // ORef; all that is left is the ownership check and the placement write.
  return async (
    ref: string | null,
    _actionKey: string | null,
    rawValue: string,
  ): Promise<void> => {
    const parsed = ref ? parseObjectRef(ref) : null;
    if (!parsed) {
      toast.error(t('inventory.cellScan.notFound', { code: rawValue }));
      return;
    }
    if (parsed.pluginId !== 'inventory' || parsed.entityType !== 'component') {
      toast.error(t('inventory.cellScan.notAnItem'));
      return;
    }
    try {
      const res = await apiFetch(`/api/components/${parsed.entityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageId: target.storageId,
          storageRow: target.row,
          storageCol: target.col,
        }),
      });
      if (!res.ok) {
        toast.error(t('inventory.cellScan.failed'));
        return;
      }
      const item: { name?: string } = await res.json().catch(() => ({}));
      toast.success(
        t('inventory.cellScan.placed', {
          name: item.name ?? rawValue,
          cell: target.cell,
        }),
      );
      notifyHost();
    } catch {
      toast.error(t('inventory.cellScan.failed'));
    }
  };
});

// Typed against the contract for the same reason the props are: the ctx this
// hands to codes is a published shape, not an ad-hoc object literal.
const scanCtx = computed<ScanContextSlotCtx>(() => ({
  actions: actions.value,
  contextLabel: contextLabel.value,
  originRef: props.cellRef,
  onScan: onScan.value,
}));
</script>

<template>
  <PluginSlot name="inventory.cell.scanPlace" :ctx="scanCtx" />
</template>
