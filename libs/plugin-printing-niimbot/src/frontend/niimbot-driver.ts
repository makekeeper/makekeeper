import {
  encodeRasterPayload,
  isValidRaster,
  type PrintDriverDescriptor,
  type PrintHandoffLink,
  type PrintJobOptions,
  type PrintProgress,
  type PrintRaster,
  type PrintResult,
} from '@makekeeper/plugin-contract';
import { apiJson, type FrontendPrintDriver } from '@makekeeper/frontend-core';
import { printingNiimbotManifest } from '../manifest';
import { rasterImageSource } from './raster-source';
import { useNiimbotSettingsStore } from './settings-store';
import { useNiimbotPrintSettingsStore } from './print-settings-store';
import type { NiimbotLabelType } from '../label-stock';

// The Web Bluetooth driver for a Niimbot B1 (#359).
//
// The protocol is NOT implemented here: `@mmote/niimbluelib` (MIT, (c) 2024
// MultiMote) owns the packets, the model table, the B1 print sequence and the
// 10 ms packet pacing that the hardware session recorded as load-bearing. This
// module is the adapter between that library and our `printing` contract: a
// raster in, progress out, failures as i18n keys.
//
// The library is imported DYNAMICALLY so its ~124 KB lands in its own chunk: no
// screen loads it until someone opens a print dialog and asks for this driver.

// The B1's printhead, from the library's model table and confirmed on the
// device: 384 dots at 203 dpi (≈48 mm of paper).
const B1_PRINTHEAD_DOTS = 384;
const B1_DPI = 203;

// The task name in the library's table. B1 is the model this ticket verified on
// paper; other Niimbot models reuse the same client and a different task, which
// is a later, separately verified choice (acks prove nothing — only paper does).
const B1_TASK = 'B1';

// The printer's GATT service, and the name its advertisement carries
// (`B1-<serial>`, confirmed on the device in #359).
//
// Both are OUR chooser's filters, because the library's default set is one
// `namePrefix` per FIRST LETTER of every model it knows — "B", "D", "H" — which
// puts every speaker, drone and laptop in range into the picker. A person
// pressing "connect printer" should be shown printers.
const NIIMBOT_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2';
// Narrow on purpose: this driver prints on a B1 (`B1PrintTask`), and offering
// a device it cannot print on is a worse answer than offering none. Supporting
// another model means adding its prefix AND verifying its print task on paper.
const DEVICE_NAME_PREFIX = 'B1';

// How often to ask the printer how far it has got. The device answers `0xA3`
// with the page it is on; 300 ms is the library's own cadence and what the
// hardware session used.
const STATUS_POLL_MS = 300;

export const NIIMBOT_DRIVER_ID = `${printingNiimbotManifest.id}.b1`;

export const niimbotDescriptor: PrintDriverDescriptor = {
  id: NIIMBOT_DRIVER_ID,
  pluginId: printingNiimbotManifest.id,
  nameKey: 'printingNiimbot.driver.name',
  routeKey: 'printingNiimbot.driver.route',
  maxWidthDots: B1_PRINTHEAD_DOTS,
  dpi: B1_DPI,
};

// Does this browser have Web Bluetooth at all? Chromium-only: Safari has none
// and every iOS browser is WebKit, which is the entire reason the handoff link
// (#361) exists. Read while rendering a dialog, so it stays a property check.
export function isBleSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { bluetooth?: unknown }).bluetooth ===
      'object'
  );
}

// The device picker, ours rather than the library's.
//
// Two filters, OR-ed by the platform: the advertised name prefix, and the
// service itself for a printer whose advertisement carries it. `optionalServices`
// is what grants GATT access to that service afterwards — without it the chooser
// succeeds and the first read fails.
//
// A cancelled picker throws `NotFoundError`, which the caller already reads as
// "no printer was chosen" rather than as a fault.
async function chooseDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [
      { namePrefix: DEVICE_NAME_PREFIX },
      { services: [NIIMBOT_SERVICE] },
    ],
    optionalServices: [NIIMBOT_SERVICE],
  });
}

// The printer's own error codes (`0xDB`), mapped to keys a person can read.
// Anything unmapped keeps its number — a code in a toast is still actionable
// ("the printer said 12"), inventing a sentence for it is not.
const ERROR_KEYS: Record<number, string> = {
  1: 'printingNiimbot.errors.coverOpen',
  2: 'printingNiimbot.errors.noPaper',
  3: 'printingNiimbot.errors.lowBattery',
  4: 'printingNiimbot.errors.batteryException',
  5: 'printingNiimbot.errors.userCancel',
  6: 'printingNiimbot.errors.dataError',
  7: 'printingNiimbot.errors.overheat',
  8: 'printingNiimbot.errors.paperOutException',
  9: 'printingNiimbot.errors.printerBusy',
};

function labelTypeValue(
  type: NiimbotLabelType,
  types: { WithGaps: number; Black: number; Transparent: number },
): number {
  if (type === 'black') return types.Black;
  if (type === 'transparent') return types.Transparent;
  return types.WithGaps;
}

// Narrowing instead of `instanceof PrintError`: the class lives in the
// dynamically imported module, and a type guard keeps this function free of the
// import (and honest about what it actually reads off the value).
function printErrorReason(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const reason = (err as { reasonId?: unknown }).reasonId;
  return typeof reason === 'number' ? reason : null;
}

function failed(err: unknown): PrintResult {
  const reason = printErrorReason(err);
  if (reason !== null) {
    const key = ERROR_KEYS[reason];
    return key !== undefined
      ? { ok: false, errorKey: key }
      : {
          ok: false,
          errorKey: 'printingNiimbot.errors.deviceCode',
          params: { code: reason },
        };
  }
  // A cancelled chooser is the commonest "failure" by far and is not one: the
  // person closed the device picker. It still ends the job, so it needs a key —
  // just not an alarming one.
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'NotFoundError'
  ) {
    return { ok: false, errorKey: 'printingNiimbot.errors.noDeviceChosen' };
  }
  return { ok: false, errorKey: 'printingNiimbot.errors.connection' };
}

// Exported as well as wired into the driver: the handoff page (#361) prints a
// raster it was handed by a token, with no consumer and no registry in between.
export async function printRaster(
  raster: PrintRaster,
  options: PrintJobOptions,
  onProgress?: (progress: PrintProgress) => void,
): Promise<PrintResult> {
  if (!isBleSupported()) {
    return { ok: false, errorKey: 'printingNiimbot.errors.unsupported' };
  }
  // A page that does not match its own size would be found by the printer as
  // half a label; find it here instead.
  if (!isValidRaster(raster)) {
    return { ok: false, errorKey: 'printingNiimbot.errors.badRaster' };
  }
  if (raster.widthDots > B1_PRINTHEAD_DOTS) {
    return {
      ok: false,
      errorKey: 'printingNiimbot.errors.tooWide',
      params: { max: B1_PRINTHEAD_DOTS },
    };
  }

  const settings = useNiimbotSettingsStore();
  // How to burn and what is loaded are the INSTANCE's answer now (#366), the
  // same for every route. Refreshed on the way to the printer and cached, so
  // an unreachable API costs the last known values rather than the print.
  const printSettings = useNiimbotPrintSettingsStore();
  await printSettings.refresh();
  const copies = Math.max(1, Math.round(options.copies ?? 1));
  const rowsTotal = raster.heightDots;
  const report = (stage: PrintProgress['stage'], rowsDone: number): void =>
    onProgress?.({ stage, rowsDone, rowsTotal });

  report('connecting', 0);
  const { NiimbotBluetoothClient, ImageEncoder, LabelType, PageColorType } =
    await import('@mmote/niimbluelib');
  const client = new NiimbotBluetoothClient();

  try {
    // The device is chosen here and handed over: the library then skips its own
    // picker (that is what `authorizedDevice` is for) and does what it is good
    // at — the protocol.
    const device = await chooseDevice();
    const info = await client.connect({ authorizedDevice: device });
    const name = info.deviceName ?? device.name ?? '';
    if (name !== '') settings.rememberDevice(name);

    // Two different measurements, and the distinction matters. The first counts
    // packets handed to the RADIO, which is exactly what #359 recorded as the
    // trap: an unpaced job reported 100 % with a quarter of the label printed.
    // The second is the printer's own answer (`0xD3` carries the last row it
    // received), so only that one says anything about paper. They are reported
    // as different stages for precisely that reason.
    client.on('printpacketprogress', (event) => {
      report('sending', Math.round((event.progress / 100) * rowsTotal));
    });
    client.on('printprogress', (event) => {
      report(
        'printing',
        Math.round((event.pagePrintProgress / 100) * rowsTotal),
      );
    });

    const task = client.protocol.newPrintTask(B1_TASK, {
      totalPages: copies,
      density: printSettings.density,
      labelType: labelTypeValue(printSettings.labelType, LabelType),
      statusPollIntervalMs: STATUS_POLL_MS,
    });
    const image = ImageEncoder.encode(
      rasterImageSource(raster),
      PageColorType.SingleColor,
      'top',
    );

    try {
      await task.printInit();
      await task.printPage(image, copies);
      await task.waitForPageFinished();
      report('finishing', rowsTotal);
      await task.waitForFinished();
    } finally {
      // The B1 holds the paper at the printhead until print end and ejects on
      // it, so this runs even when the job failed — otherwise the next job
      // starts mid-label.
      await task.printEnd().catch(() => undefined);
    }
    return { ok: true };
  } catch (err) {
    return failed(err);
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

// Parks the page and hands back the link to open near the printer (#361).
//
// Posted from here rather than from the consumer: the endpoint is this plugin's
// own, and `codes` must not call another plugin's API (§5.10). What travels is
// the raster alone — the server never learns which object the label names.
async function createHandoff(
  raster: PrintRaster,
  options: PrintJobOptions,
): Promise<PrintHandoffLink | null> {
  if (!isValidRaster(raster)) return null;
  try {
    return await apiJson<PrintHandoffLink>('/api/printing-niimbot/handoff', {
      method: 'POST',
      body: encodeRasterPayload(raster, options.copies ?? 1),
    });
  } catch {
    // Null is the contract's "there is no handoff right now" — the plugin may
    // have just been disabled, and the consumer falls back to the system
    // dialog rather than reporting a second failure.
    return null;
  }
}

export function createNiimbotDriver(
  visible: () => boolean,
): FrontendPrintDriver {
  return {
    descriptor: niimbotDescriptor,
    isSupported: isBleSupported,
    print: printRaster,
    createHandoff,
    visible,
  };
}
