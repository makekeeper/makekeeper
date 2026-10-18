import { rasterPixel, type PrintRaster } from '@makekeeper/plugin-contract';
import { ImageEncoder, LabelType, PageColorType } from '@mmote/niimbluelib';
import type { PrintJob, PrintOutcome } from './jobs.ts';
import type { PrinterTransport } from './transport.ts';
import type { LabelTypeName, State } from './state.ts';

// The print sequence: one page, one label (#362).
//
// The protocol is niimbluelib's (MIT, (c) 2024 MultiMote) — the B1 print task,
// the packet pacing and the model table. Nothing is ported, and the device
// facts verified in #359 are the acceptance oracle for this side too.
//
// HOW the printer is reached is not this file's business: a `PrinterTransport`
// hands over a connected client, so the local radio and a future BLE proxy
// (#363) share this sequence verbatim.
//
// The link is opened per job rather than held open. A held link is the one
// thing that stops everything else from reaching the printer (the Niimbot phone
// app included), and a bridge that owns a machine nobody else can touch for
// days is worse than three seconds of connect per label.

const B1_TASK = 'B1';
const STATUS_POLL_MS = 300;

function labelTypeValue(name: LabelTypeName): LabelType {
  if (name === 'black') return LabelType.Black;
  if (name === 'transparent') return LabelType.Transparent;
  return LabelType.WithGaps;
}

// The encoder takes a pixel source; the contract carries bytes. Bridging the
// two here keeps the raster transport-agnostic, which is the entire reason a
// remote driver can print the very page a browser rendered.
function imageSource(raster: PrintRaster): {
  width: number;
  height: number;
  getPixelColor(x: number, y: number): number;
} {
  return {
    width: raster.widthDots,
    height: raster.heightDots,
    getPixelColor: (x, y) => (rasterPixel(raster, x, y) ? 0x000000 : 0xffffff),
  };
}

// Prints one job on the configured printer. Resolves with a keyed failure
// rather than throwing: the core relays the key, and a device that is simply
// switched off is not an exception in anybody's code path.
export async function printJob(
  transport: PrinterTransport,
  state: State,
  job: PrintJob,
): Promise<PrintOutcome> {
  const address = state.address.trim();
  if (address === '') return { ok: false, errorKey: 'errNoPrinter' };

  const client = await transport.connect(address);
  if (!client) return { ok: false, errorKey: 'errConnect' };

  try {
    const task = client.protocol.newPrintTask(B1_TASK, {
      totalPages: job.copies,
      density: state.density,
      labelType: labelTypeValue(state.labelType),
      statusPollIntervalMs: STATUS_POLL_MS,
    });
    const image = ImageEncoder.encode(
      imageSource(job.raster),
      PageColorType.SingleColor,
      'top',
    );
    try {
      await task.printInit();
      await task.printPage(image, job.copies);
      await task.waitForPageFinished();
      await task.waitForFinished();
    } finally {
      // The B1 holds the paper at the printhead until print end and ejects on
      // it, so this runs even for a failed job — otherwise the next label
      // starts mid-sticker.
      await task.printEnd().catch(() => undefined);
    }
    return { ok: true };
  } catch (err) {
    console.error('print failed:', err);
    return { ok: false, errorKey: 'errPrint' };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
