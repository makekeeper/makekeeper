<script setup lang="ts">
// Print-label dialog (#74): ensures a label exists for the object, lets the
// person choose how the code is drawn, and prints it.
//
// EVERY WAY OUT IS A ROW, AND EVERY ROW IS A BUTTON. One press, one outcome —
// no destination to select first and no second confirmation. It used to be
// three competing buttons plus a layout switch that applied to only one of
// them, which is how a person ended up unsure what would come out where.
//
// The printer is the DESTINATION; Bluetooth, a bridge next to the machine
// (#362) and a one-time link (#361) are ROUTES to it. So a driver is one row
// whatever this browser can do, and only its second line and its verb change:
// pairing a bridge rewrites a sentence here, not a layout.
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ActionRow,
  Modal,
  CopyableLink,
  Disclosure,
  QrCode,
  SegmentedControl,
  Spinner,
  apiFetch,
  refreshRemotePrintDrivers,
  usePrintDrivers,
  useDateFormat,
  useToastStore,
  type FrontendPrintDriver,
  type SegmentedOption,
} from '@makekeeper/frontend-core';
import type {
  PrintHandoffLink,
  PrintProgress,
  PrintRaster,
} from '@makekeeper/plugin-contract';
import { Link2, Printer, Sheet } from '@lucide/vue';
import LabelCard from './LabelCard.vue';
import {
  LABEL_HEIGHT_MM,
  renderLabelRaster,
  thermalPrintCss,
} from './label-raster';

const props = defineProps<{ modelValue: boolean; entityRef: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useI18n();
const toast = useToastStore();
const dates = useDateFormat();

const loading = ref(false);
const label = ref<{ code: string; url: string } | null>(null);
const format = ref<'qr' | 'barcode'>('qr');
// The element the preview is rendered INTO: the single source of what gets
// printed, by any path (see `rasterFor`).
//
// The wrapper rather than the component: `LabelCard`'s template root is a
// fragment (a comment precedes its `<div>`), so its `$el` is a text node, not
// the card — and reaching for it failed every print with "could not prepare the
// label". A component's root node is its own business; the element we own is
// not.
const previewCard = ref<HTMLElement | null>(null);

const formatOptions = computed<SegmentedOption<'qr' | 'barcode'>[]>(() => [
  { value: 'qr', label: t('codes.print.format.qr') },
  { value: 'barcode', label: t('codes.print.format.barcode') },
]);

const close = (): void => emit('update:modelValue', false);

const ensureLabel = async (): Promise<void> => {
  loading.value = true;
  label.value = null;
  try {
    const res = await apiFetch('/api/codes/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The address bar is the one place scheme, host and port all survive;
      // the QR is built from it rather than from proxy headers (#372).
      body: JSON.stringify({
        ref: props.entityRef,
        origin: window.location.origin,
      }),
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
    if (open) {
      void ensureLabel();
      // A printer may live next to the machine rather than in this browser
      // (#362). Asked here rather than at boot: a session that never prints
      // pays nothing, and a container plugged in this morning still shows up.
      void refreshRemotePrintDrivers();
    }
  },
  { immediate: true },
);

// ── The rows ────────────────────────────────────────────────────────────────

const drivers = usePrintDrivers();

// What pressing a driver's row DOES. Deliberately not called a route: a route
// is how a driver reaches the printer (`descriptor.routeKey`), and the two
// words a screen apart meaning different things is how a reader loses both.
type RowAction = 'print' | 'handoff';

interface DriverRow {
  driver: FrontendPrintDriver;
  action: RowAction;
}

const driverRows = computed<DriverRow[]>(() =>
  drivers.value.flatMap((driver): DriverRow[] => {
    if (driver.isSupported()) return [{ driver, action: 'print' }];
    return driver.createHandoff ? [{ driver, action: 'handoff' }] : [];
  }),
);

// The page a driver gets: the full printhead width by the stock's 30 mm of feed
// — the geometry #359 verified on paper (384 × 240 dots at 203 dpi). Width is
// the HEAD's, not the paper's: a driver knows how wide it can burn, and nobody
// can know what roll is loaded, so narrower stock clips at its own right edge.
const MM_PER_INCH = 25.4;

const dots = (mm: number, dpi: number): number =>
  Math.round((mm / MM_PER_INCH) * dpi);

const rasterFor = (driver: FrontendPrintDriver): Promise<PrintRaster> => {
  // The rendered card, not the label's data: whatever the person is looking at
  // is what goes to the printhead.
  const card = previewCard.value;
  if (!card) throw new Error('codes.print.driver.rasterError');
  return renderLabelRaster({
    card,
    widthDots: driver.descriptor.maxWidthDots,
    heightDots: dots(LABEL_HEIGHT_MM, driver.descriptor.dpi),
  });
};

// Which row is busy, and what it says while it is: the answer lands in the row
// that was pressed rather than in a toast to chase.
const busyId = ref<string | null>(null);
const progress = ref<PrintProgress | null>(null);
const printedId = ref<string | null>(null);
// A revealed link belongs to the row that produced it.
const handoff = ref<{ driverId: string; link: PrintHandoffLink } | null>(null);
// The link's QR, folded away by default.
//
// Two QR codes in one dialog is how a person scans the wrong one: the label's
// own code opens the OBJECT, this one opens the print page, and they sit
// centimetres apart. The common way out of this dialog — Safari on a Mac, open
// the link in Chrome on the same Mac — needs the clipboard, not a camera; a
// camera is for the rarer case of a Chromium tablet standing by the printer,
// and that case can afford one tap.
const qrOpen = ref(false);

// How long a row keeps saying "printed" before it offers to print again.
const PRINTED_FOR_MS = 6000;
let printedTimer: ReturnType<typeof setTimeout> | null = null;

const progressLine = computed<string>(() => {
  const update = progress.value;
  if (!update) return t('codes.print.driver.stage.connecting');
  // A driver that prints through one remote call reports no rows at all
  // (`rowsTotal: 0`); a bar frozen at "0 of 0" reads as stuck.
  if (update.rowsTotal <= 0) {
    return t('codes.print.driver.stage.printingNoCount');
  }
  return t(`codes.print.driver.stage.${update.stage}`, {
    done: update.rowsDone,
    total: update.rowsTotal,
  });
});

// A parked page is a snapshot: switching QR ↔ barcode, or reopening the dialog
// on another object, makes an existing link print the wrong label. So it is
// dropped and asked for again rather than silently kept.
watch([() => props.modelValue, format], () => {
  handoff.value = null;
  printedId.value = null;
  qrOpen.value = false;
});

const printOnDriver = async (driver: FrontendPrintDriver): Promise<void> => {
  if (!label.value || busyId.value !== null) return;
  busyId.value = driver.descriptor.id;
  printedId.value = null;
  progress.value = null;
  try {
    const raster = await rasterFor(driver);
    const result = await driver.print(raster, { copies: 1 }, (update) => {
      progress.value = update;
    });
    if (result.ok) {
      printedId.value = driver.descriptor.id;
      if (printedTimer) clearTimeout(printedTimer);
      printedTimer = setTimeout(() => {
        printedId.value = null;
      }, PRINTED_FOR_MS);
    } else {
      toast.error(t(result.errorKey, result.params ?? {}));
    }
  } catch {
    // Rasterising is ours; a failure here is not the driver's fault and must
    // not be reported as a printer error.
    toast.error(t('codes.print.driver.rasterError'));
  } finally {
    busyId.value = null;
    progress.value = null;
  }
};

const requestHandoff = async (driver: FrontendPrintDriver): Promise<void> => {
  if (busyId.value !== null) return;
  busyId.value = driver.descriptor.id;
  handoff.value = null;
  try {
    const raster = await rasterFor(driver);
    const link = await driver.createHandoff?.(raster, { copies: 1 });
    if (!link) {
      toast.error(t('codes.print.handoff.error'));
      return;
    }
    handoff.value = { driverId: driver.descriptor.id, link };
  } catch {
    toast.error(t('codes.print.driver.rasterError'));
  } finally {
    busyId.value = null;
  }
};

const press = (row: DriverRow): Promise<void> =>
  row.action === 'print'
    ? printOnDriver(row.driver)
    : requestHandoff(row.driver);

// The row's second line: what it is doing, or how it reaches the printer.
const rowLine = (row: DriverRow): string => {
  const id = row.driver.descriptor.id;
  if (busyId.value === id) return progressLine.value;
  if (printedId.value === id) return t('codes.print.driver.printed');
  if (row.action === 'handoff') return t('codes.print.handoff.route');
  const routeKey = row.driver.descriptor.routeKey;
  // `nameParams` carries what the DRIVER knows and this dialog cannot: the
  // printer's own name, as its owner named it. Passing it to both keys costs
  // one argument and is a no-op for a driver that has no slot to fill.
  return routeKey ? t(routeKey, row.driver.descriptor.nameParams ?? {}) : '';
};

// The verb on the right edge: what pressing will do, now.
const rowVerb = (row: DriverRow): string => {
  if (row.action === 'handoff') return t('codes.print.handoff.action');
  return printedId.value === row.driver.descriptor.id
    ? t('codes.print.driver.again')
    : t('codes.print.driver.action');
};

// One label through whatever the operating system offers. The A4 sheet of
// copies this dialog used to carry is gone: a sheet is a different outcome
// rather than a setting on a label, and nobody could name the errand it served.
//
// The rule itself is built from the label's geometry (`thermalPrintCss`), the
// same object the rasteriser measures in — so the system print and a direct
// print cannot drift apart.
const printOnSystem = (): void => {
  const style = document.createElement('style');
  style.textContent = thermalPrintCss();
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
      <div class="flex h-56 items-center justify-center">
        <!-- This box is also what a direct print rasterises (#359): the printed
             sticker is the previewed one because it is literally the same
             rendered code, not a second drawing of it. The ref is on the
             wrapper, not on the component — see `previewCard`. -->
        <div ref="previewCard" class="w-64">
          <LabelCard :code="label.code" :url="label.url" :format="format" />
        </div>
      </div>

      <!-- The one setting left: how the code itself is drawn. -->
      <div class="flex items-center justify-between gap-4">
        <span class="text-sm text-slate-600 dark:text-slate-300">
          {{ $t('codes.print.format.label') }}
        </span>
        <SegmentedControl
          v-model="format"
          :options="formatOptions"
          :aria-label="$t('codes.print.format.label')"
        />
      </div>

      <hr class="border-slate-200 dark:border-white/10" />

      <section class="space-y-2">
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('codes.print.destinations') }}
        </p>

        <!-- One row per way out, and the row IS the button: pressing it
             starts that way of printing, and the row then carries the answer
             (`ActionRow` announces its second line as it changes). -->
        <template v-for="row in driverRows" :key="row.driver.descriptor.id">
          <ActionRow
            v-if="handoff?.driverId !== row.driver.descriptor.id"
            lead
            :title="
              $t(
                row.driver.descriptor.nameKey,
                row.driver.descriptor.nameParams ?? {},
              )
            "
            :subtitle="rowLine(row)"
            :icon="row.action === 'handoff' ? Link2 : Printer"
            :action="rowVerb(row)"
            :busy="busyId === row.driver.descriptor.id"
            :disabled="busyId !== null"
            @press="press(row)"
          />

          <!-- The link the row produced, in the row's place: the answer belongs
               where the press happened. -->
          <div
            v-else-if="handoff"
            class="space-y-3 rounded-xl border border-brand-500/60 bg-brand-500/5 p-3 text-center"
          >
            <p class="text-sm font-semibold text-slate-900 dark:text-white">
              {{ $t('codes.print.handoff.title') }}
            </p>
            <CopyableLink :url="handoff.link.url">
              <!-- Which browser this needs is the one fact the line exists to
                   carry, so it is the one part set in bold. The sentence keeps
                   its word order in the locale; only the emphasis is ours. -->
              <template #hint>
                <i18n-t keypath="codes.print.handoff.linkHint" scope="global">
                  <template #browsers>
                    <strong
                      class="font-semibold text-slate-900 dark:text-white"
                    >
                      {{ $t('codes.print.handoff.browsers') }}
                    </strong>
                  </template>
                </i18n-t>
              </template>
            </CopyableLink>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{
                $t('common.validUntil', {
                  when: dates.time(handoff.link.expiresAt),
                })
              }}
            </p>
            <!-- For the device that reads with a camera rather than a
                 clipboard: a tablet or an Android phone standing by the
                 printer. Folded, so it never competes with the label's own QR
                 a few centimetres above it. -->
            <Disclosure
              v-model:open="qrOpen"
              variant="inline"
              content-id="codes-print-handoff-qr"
              :title="$t('codes.print.handoff.showQr')"
            >
              <QrCode
                :value="handoff.link.url"
                :label="$t('codes.print.handoff.alt')"
                class="mx-auto h-40 w-40"
              />
            </Disclosure>
          </div>
        </template>

        <!-- Paper, through whatever the operating system offers. -->
        <ActionRow
          :title="$t('codes.print.system.name')"
          :subtitle="$t('codes.print.system.route')"
          :icon="Sheet"
          :action="$t('codes.print.system.action')"
          :disabled="busyId !== null"
          @press="printOnSystem"
        />
      </section>
    </div>

    <!-- Print portal: hidden on screen, the only thing visible on paper. -->
    <Teleport to="body">
      <div v-if="label" class="codes-print-portal">
        <div class="codes-print-sheet">
          <LabelCard :code="label.code" :url="label.url" :format="format" />
        </div>
      </div>
    </Teleport>
  </Modal>
</template>

<style>
/* Global (unscoped) print rules: on paper, show only the label portal. The
   @page sizing is added at print time by the dialog. */
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
