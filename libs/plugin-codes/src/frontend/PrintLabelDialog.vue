<script setup lang="ts">
// Print-label dialog (#74): ensures a label exists for the object, lets the user
// choose the code format (QR / Code128) and the layout (single thermal / A4
// sheet), previews it, and prints. The two layouts produce genuinely different
// output via a per-layout `@page` rule injected at print time; a teleported
// print portal is the only thing visible on paper.
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Modal,
  Button,
  Switch,
  Spinner,
  apiFetch,
  useToastStore,
} from '@makekeeper/frontend-core';
import { Printer } from '@lucide/vue';
import LabelCard from './LabelCard.vue';

const props = defineProps<{ modelValue: boolean; entityRef: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(false);
const label = ref<{ code: string; url: string } | null>(null);
const formatIsQr = ref(true);
const layoutIsA4 = ref(false);

const format = computed<'qr' | 'barcode'>(() =>
  formatIsQr.value ? 'qr' : 'barcode',
);
// A modest full-sheet grid of identical labels for the A4 layout.
const A4_COPIES = 24;

const close = (): void => emit('update:modelValue', false);

const ensureLabel = async (): Promise<void> => {
  loading.value = true;
  label.value = null;
  try {
    const res = await apiFetch('/api/codes/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: props.entityRef }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { code: string; url: string } = await res.json();
    label.value = { code: data.code, url: data.url };
  } catch {
    toast.error(t('codes.print.prepareError'));
    close();
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) void ensureLabel();
  },
  { immediate: true },
);

// Single thermal label: one 40×30mm page. The code must FIT the page — a square
// QR at full width would be taller than 30mm and overflow off the top, so cap
// the QR/barcode height and let the label box own the page exactly.
const THERMAL_CSS = `@media print {
  @page { size: 40mm 30mm; margin: 0; }
  .codes-print-portal, .codes-print-sheet { margin: 0; padding: 0; }
  .codes-print-sheet {
    width: 40mm; height: 30mm; box-sizing: border-box; padding: 1.5mm;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  /* Size to content and let the sheet center it — no height:100% + overflow
     interplay that clipped the code. */
  .codes-print-sheet .label-card {
    border: none; padding: 0; margin: 0; gap: 1mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  /* Explicit square QR (overrides aspect-square + intrinsic size), sized to
     every millimetre the 27mm printable height leaves after the short code and
     its gap. It used to be 18mm, which was ample when the code was 25 modules
     wide with a one-module quiet zone; at error-correction H with the standard
     four-module zone (#263) the same label is 41 units across, so the modules
     would have shrunk by a third. The 40×30mm stock still caps this below the
     25mm the brand guide asks for — the way to honour that is bigger stock. */
  .codes-print-sheet .label-card .label-card__qr {
    width: 23mm; height: 23mm; max-width: none; max-height: none;
  }
  .codes-print-sheet .label-card .label-card__barcode { width: 36mm; height: auto; max-height: 16mm; }
  .codes-print-sheet .label-card span { font-size: 7pt; line-height: 1; }
}`;
// A4 sheet: a grid of identical labels. Cap each label's code height so a cell
// stays compact and the grid doesn't run a label off the page edge.
const A4_CSS = `@media print {
  @page { size: A4; margin: 8mm; }
  .codes-print-sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
  .codes-print-sheet .label-card { break-inside: avoid; }
  .codes-print-sheet .label-card .label-card__qr { width: 34mm; height: 34mm; max-width: none; }
  .codes-print-sheet .label-card .label-card__barcode { max-height: 20mm; }
}`;

const doPrint = (): void => {
  const style = document.createElement('style');
  style.textContent = layoutIsA4.value ? A4_CSS : THERMAL_CSS;
  document.head.appendChild(style);
  const cleanup = (): void => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
};
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="$t('codes.print.title')"
    @update:model-value="close"
  >
    <div v-if="loading" class="flex items-center justify-center py-10">
      <Spinner />
    </div>

    <div v-else-if="label" class="space-y-5">
      <!-- Preview — fixed-height box so switching QR ↔ barcode (square vs wide)
           doesn't resize the dialog. -->
      <div class="flex items-center justify-center h-56">
        <div class="w-44">
          <LabelCard :code="label.code" :url="label.url" :format="format" />
        </div>
      </div>

      <!-- Code format toggle -->
      <div class="flex items-center justify-between gap-4">
        <span class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('codes.print.format.label') }}
        </span>
        <div class="flex items-center gap-3 text-sm">
          <span
            :class="
              !formatIsQr
                ? 'font-semibold text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            "
            >{{ $t('codes.print.format.barcode') }}</span
          >
          <Switch
            v-model="formatIsQr"
            :aria-label="$t('codes.print.format.label')"
          />
          <span
            :class="
              formatIsQr
                ? 'font-semibold text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            "
            >{{ $t('codes.print.format.qr') }}</span
          >
        </div>
      </div>

      <!-- Layout toggle -->
      <div class="flex items-center justify-between gap-4">
        <span class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('codes.print.layout.label') }}
        </span>
        <div class="flex items-center gap-3 text-sm">
          <span
            :class="
              !layoutIsA4
                ? 'font-semibold text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            "
            >{{ $t('codes.print.layout.thermal') }}</span
          >
          <Switch
            v-model="layoutIsA4"
            :aria-label="$t('codes.print.layout.label')"
          />
          <span
            :class="
              layoutIsA4
                ? 'font-semibold text-slate-900 dark:text-white'
                : 'text-slate-400 dark:text-slate-500'
            "
            >{{ $t('codes.print.layout.a4') }}</span
          >
        </div>
      </div>

      <div class="flex justify-end">
        <Button variant="primary" :icon-left="Printer" @click="doPrint">
          {{ $t('codes.print.action') }}
        </Button>
      </div>
    </div>

    <!-- Print portal: hidden on screen, the only thing visible on paper. -->
    <Teleport to="body">
      <div v-if="label" class="codes-print-portal">
        <div class="codes-print-sheet">
          <LabelCard
            v-for="i in layoutIsA4 ? A4_COPIES : 1"
            :key="i"
            :code="label.code"
            :url="label.url"
            :format="format"
          />
        </div>
      </div>
    </Teleport>
  </Modal>
</template>

<style>
/* Global (unscoped) print rules: on paper, show only the label portal. Injected
   per-layout @page sizing is added at print time by the dialog. */
.codes-print-portal {
  display: none;
}
@media print {
  body > *:not(.codes-print-portal) {
    display: none !important;
  }
  .codes-print-portal {
    display: block !important;
  }
}
</style>
