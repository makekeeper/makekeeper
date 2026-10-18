import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrintQueue,
  parseJob,
  testPattern,
  type PrintOutcome,
} from './jobs.ts';

const page = (widthDots: number, heightDots: number): string =>
  Buffer.alloc(Math.ceil(widthDots / 8) * heightDots).toString('base64');

test('parseJob accepts a page that matches its own size', () => {
  const job = parseJob({ widthDots: 384, heightDots: 4, rows: page(384, 4) });
  assert.ok(job);
  assert.equal(job.raster.widthDots, 384);
  assert.equal(job.raster.rows.length, 48 * 4);
  assert.equal(job.copies, 1);
});

test('parseJob clamps the copy count', () => {
  assert.equal(
    parseJob({ widthDots: 8, heightDots: 1, rows: page(8, 1), copies: 999 })
      ?.copies,
    50,
  );
  assert.equal(
    parseJob({ widthDots: 8, heightDots: 1, rows: page(8, 1), copies: 0 })
      ?.copies,
    1,
  );
});

test('parseJob refuses anything that is not a page', () => {
  // A row short: the page would print as half a label.
  assert.equal(
    parseJob({ widthDots: 384, heightDots: 4, rows: page(384, 3) }),
    null,
  );
  assert.equal(
    parseJob({ widthDots: 0, heightDots: 4, rows: page(8, 4) }),
    null,
  );
  assert.equal(parseJob({ widthDots: 8, heightDots: 4 }), null);
  assert.equal(parseJob('nope'), null);
  assert.equal(parseJob(null), null);
});

test('the queue prints one job at a time, in arrival order', async () => {
  const order: string[] = [];
  let running = 0;
  const queue = new PrintQueue(async () => {
    running += 1;
    // Two jobs overlapping on one BLE link ruin both labels, so this is the
    // invariant under test, not a timing nicety.
    assert.equal(running, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return { ok: true };
  });
  const job = (id: string): Promise<PrintOutcome> =>
    queue
      .submit({
        raster: { widthDots: 8, heightDots: 1, rows: new Uint8Array(1) },
        copies: 1,
      })
      .then((result) => {
        order.push(id);
        return result;
      });
  await Promise.all([job('a'), job('b'), job('c')]);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(queue.depth, 0);
});

test('a failed job costs its own label, not the queue', async () => {
  let first = true;
  const queue = new PrintQueue(async () => {
    if (first) {
      first = false;
      throw new Error('printer off');
    }
    return { ok: true };
  });
  const raster = { widthDots: 8, heightDots: 1, rows: new Uint8Array(1) };
  const failed = await queue.submit({ raster, copies: 1 });
  assert.deepEqual(failed, { ok: false, errorKey: 'errPrint' });
  assert.deepEqual(await queue.submit({ raster, copies: 1 }), { ok: true });
});

test('the queue refuses a backlog rather than hoarding labels', async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new PrintQueue(async () => {
    await gate;
    return { ok: true };
  }, 2);
  const raster = { widthDots: 8, heightDots: 1, rows: new Uint8Array(1) };
  const accepted = [
    queue.submit({ raster, copies: 1 }),
    queue.submit({ raster, copies: 1 }),
  ];
  assert.deepEqual(await queue.submit({ raster, copies: 1 }), {
    ok: false,
    errorKey: 'errBusy',
  });
  release();
  await Promise.all(accepted);
});

test('the test pattern frames the whole page', () => {
  const pattern = testPattern(16, 4);
  assert.equal(pattern.rows.length, 2 * 4);
  // Both corners of the top edge are ink, so the operator sees the page's own
  // boundary rather than guessing where the label ends.
  assert.equal(pattern.rows[0] & 0b10000000, 0b10000000);
  assert.equal(pattern.rows[1] & 0b00000001, 0b00000001);
});
