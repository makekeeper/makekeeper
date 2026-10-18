import {
  decodeRasterPayload,
  rasterRowBytes,
  type PrintRaster,
} from '@makekeeper/plugin-contract';

// What a print job is, and the order they happen in (#362).
//
// Pure on purpose: parsing the core's payload and serialising the queue are the
// parts with branches in them, and neither needs a radio — so both are tested
// without one (`jobs.test.ts`), while `printer.ts` keeps only the hardware.

export interface PrintJob {
  raster: PrintRaster;
  copies: number;
}

export type PrintOutcome = { ok: true } | { ok: false; errorKey: string };

const MAX_COPIES = 50;
// A printhead this wide does not exist; the bound stops a malformed payload
// from asking the container to allocate a megabyte of dots.
const MAX_DOTS = 4096;

// The core relays the contract's own wire shape for a page
// (`PrintRasterPayload`). Anything that is not a page comes back as null: the
// caller answers `errRaster`, and nothing reaches the printer.
//
// The decode itself is the contract's (`decodeRasterPayload` runs
// `isValidRaster`), so a page that does not match its own size is refused here
// rather than discovered as half a label. What this function adds is the bounds
// a CONTAINER needs: a malformed payload must not be able to ask it to
// allocate a megabyte of dots or print fifty-thousand copies.
export function parseJob(args: unknown): PrintJob | null {
  if (typeof args !== 'object' || args === null) return null;
  const input = args as Record<string, unknown>;
  const widthDots = input['widthDots'];
  const heightDots = input['heightDots'];
  const rows = input['rows'];
  if (
    typeof widthDots !== 'number' ||
    typeof heightDots !== 'number' ||
    typeof rows !== 'string' ||
    widthDots <= 0 ||
    heightDots <= 0 ||
    widthDots > MAX_DOTS ||
    heightDots > MAX_DOTS
  ) {
    return null;
  }
  const copies = Number(input['copies'] ?? 1);
  if (!Number.isFinite(copies)) return null;
  const raster = decodeRasterPayload({
    widthDots,
    heightDots,
    rows,
    copies: 1,
  });
  if (!raster) return null;
  return {
    raster,
    copies: Math.min(MAX_COPIES, Math.max(1, Math.round(copies))),
  };
}

// One printer, one job at a time, in the order the jobs arrived.
//
// There is exactly one printhead, so concurrency here is not a performance
// question but a correctness one: two overlapping jobs on one BLE link
// interleave their row packets and both labels come out ruined. Each caller
// awaits its OWN job, which is what makes per-job status honest — a client is
// told its label printed when its label printed, not when the queue drained.
//
// Nothing is persisted: a job is a label somebody is standing next to. If the
// container restarts, the right behaviour is to lose the job and say so, not to
// print a mystery sticker an hour later.
export class PrintQueue {
  private depthValue = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly run: (job: PrintJob) => Promise<PrintOutcome>,
    private readonly maxDepth = 8,
  ) {}

  // Jobs waiting or running — what the settings screen shows.
  get depth(): number {
    return this.depthValue;
  }

  submit(job: PrintJob): Promise<PrintOutcome> {
    // A queue deeper than this is not a backlog, it is a loop: refuse rather
    // than accept a job nobody will still want by the time it prints.
    if (this.depthValue >= this.maxDepth) {
      return Promise.resolve({ ok: false, errorKey: 'errBusy' });
    }
    this.depthValue += 1;
    const result = this.tail.then(() =>
      this.run(job).catch((err: unknown) => {
        // The queue must survive one bad job: whatever the device threw, the
        // next caller still gets their turn.
        console.error('print job failed:', err);
        return { ok: false, errorKey: 'errPrint' } satisfies PrintOutcome;
      }),
    );
    // The chain advances whether the job succeeded or not — a failure that
    // blocked the queue would take the printer down with it.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.depthValue -= 1;
    });
  }
}

// A small frame the operator can print to check paper, density and link before
// anybody prints a real label. Built here rather than drawn by a consumer: the
// point of the test is that it needs nothing from the rest of the system.
export function testPattern(
  widthDots: number,
  heightDots: number,
): PrintRaster {
  const rowBytes = Math.ceil(widthDots / 8);
  const rows = new Uint8Array(rowBytes * heightDots);
  const ink = (x: number, y: number): void => {
    rows[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  };
  for (let x = 0; x < widthDots; x += 1) {
    ink(x, 0);
    ink(x, heightDots - 1);
  }
  for (let y = 0; y < heightDots; y += 1) {
    ink(0, y);
    ink(widthDots - 1, y);
    // A diagonal across the frame: it shows at a glance whether rows are
    // arriving in order, which a plain border cannot.
    ink(Math.min(widthDots - 1, Math.floor((y / heightDots) * widthDots)), y);
  }
  return { widthDots, heightDots, rows };
}
