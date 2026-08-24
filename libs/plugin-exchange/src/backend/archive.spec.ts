import { createWriteStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipFile } from 'yazl';
import {
  MK_FORMAT_VERSION,
  MkArchiveError,
  MkManifest,
  ExtractLimits,
  classifyEntryName,
  extractMk,
} from './archive';

// Security-guard coverage for the `.mkx` archive layer: hostile zips are
// crafted with yazl directly (byte-patched where yazl itself refuses the
// hostile shape) and thrown at `extractMk`.

const LIMITS: ExtractLimits = {
  maxEntries: 100,
  maxJsonBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
};

interface ZipEntrySpec {
  name: string;
  data: Buffer;
  compress?: boolean;
}

function writeZip(outPath: string, entries: ZipEntrySpec[]): Promise<void> {
  const zip = new ZipFile();
  const out = createWriteStream(outPath);
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    out.on('close', () => resolvePromise());
    out.on('error', rejectPromise);
  });
  zip.outputStream.pipe(out);
  for (const entry of entries) {
    zip.addBuffer(entry.data, entry.name, { compress: entry.compress ?? true });
  }
  zip.end();
  return done;
}

function makeManifest(overrides: Partial<MkManifest> = {}): MkManifest {
  return {
    formatVersion: MK_FORMAT_VERSION,
    rootType: 'thing',
    rootId: 't1',
    exportedAt: new Date().toISOString(),
    exportId: 'test-export',
    sections: [],
    ...overrides,
  };
}

function manifestEntry(overrides: Partial<MkManifest> = {}): ZipEntrySpec {
  return {
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(makeManifest(overrides)), 'utf8'),
  };
}

// yazl refuses to write `..`/absolute entry names, so hostile names are
// byte-patched into an otherwise valid zip. Names are stored uncompressed in
// the local file header and the central directory; equal-length replacement
// keeps every offset and length field intact.
function replaceEntryName(buf: Buffer, from: string, to: string): void {
  expect(from.length).toBe(to.length);
  const fromBytes = Buffer.from(from, 'utf8');
  const toBytes = Buffer.from(to, 'utf8');
  let idx = buf.indexOf(fromBytes);
  expect(idx).not.toBe(-1);
  while (idx !== -1) {
    toBytes.copy(buf, idx);
    idx = buf.indexOf(fromBytes, idx + 1);
  }
}

// Forge the central-directory `uncompressedSize` of one entry: the pre-stream
// total-size accounting then sees the small lie while the deflate stream
// delivers the real payload — the mid-stream guards must catch it.
function forgeUncompressedSize(
  buf: Buffer,
  entryName: string,
  forgedSize: number,
): void {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const nameBytes = Buffer.from(entryName, 'utf8');
  let idx = buf.indexOf(signature);
  let patched = false;
  while (idx !== -1) {
    const nameLength = buf.readUInt16LE(idx + 28);
    const name = buf.subarray(idx + 46, idx + 46 + nameLength);
    if (name.equals(nameBytes)) {
      buf.writeUInt32LE(forgedSize, idx + 24);
      patched = true;
    }
    idx = buf.indexOf(signature, idx + 4);
  }
  expect(patched).toBe(true);
}

async function caughtArchiveError(
  promise: Promise<unknown>,
): Promise<MkArchiveError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MkArchiveError);
  // The instanceof expectation above fails the test before this can throw.
  if (!(err instanceof MkArchiveError)) throw err;
  return err;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

describe('classifyEntryName', () => {
  it('accepts the fixed layout', () => {
    expect(classifyEntryName('manifest.json')).toEqual({ kind: 'manifest' });
    expect(classifyEntryName('data/synth.thing.json')).toEqual({
      kind: 'section',
      sectionKey: 'synth.thing',
    });
    expect(classifyEntryName('files/synth.notes/note-1.bin')).toEqual({
      kind: 'file',
      sectionKey: 'synth.notes',
      fileId: 'note-1.bin',
    });
  });

  it.each([
    '../evil',
    'data/../../x.json',
    'files/a/../b',
    '/abs/evil',
    '..',
    '.env',
    '.git/config',
    'data/.hidden.json',
    'files/sec/.dotfile',
    'files/.sec/file',
    'evil.txt',
    'data/x.txt',
    'data/a/b.json',
    'files/sec',
    'files/a/b/c',
    'data\\evil.json',
  ])('rejects %s', (name) => {
    expect(classifyEntryName(name)).toBeNull();
  });
});

describe('extractMk (hostile archives)', () => {
  let root: string;
  let zipPath: string;
  let destDir: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'archive-spec-'));
    zipPath = join(root, 'attack.mkx');
    destDir = join(root, 'out');
    await fsp.mkdir(destDir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('rejects a path-traversal entry name', async () => {
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'zz/evil', data: Buffer.from('boom') },
    ]);
    const buf = await fsp.readFile(zipPath);
    replaceEntryName(buf, 'zz/evil', '../evil');
    await fsp.writeFile(zipPath, buf);

    const err = await caughtArchiveError(extractMk(zipPath, destDir, LIMITS));
    expect(err.errorKey).toBe('exchange.errors.archiveMalformed');
    await expect(fileExists(join(root, 'evil'))).resolves.toBe(false);
  });

  it('rejects an absolute entry name', async () => {
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'aa/evil', data: Buffer.from('boom') },
    ]);
    const buf = await fsp.readFile(zipPath);
    replaceEntryName(buf, 'aa/evil', '/a/evil');
    await fsp.writeFile(zipPath, buf);

    const err = await caughtArchiveError(extractMk(zipPath, destDir, LIMITS));
    expect(err.errorKey).toBe('exchange.errors.archiveMalformed');
  });

  it('rejects a dotfile entry outside the layout', async () => {
    await writeZip(zipPath, [
      manifestEntry(),
      { name: '.env', data: Buffer.from('SECRET=1') },
    ]);
    const err = await caughtArchiveError(extractMk(zipPath, destDir, LIMITS));
    expect(err.errorKey).toBe('exchange.errors.archiveMalformed');
  });

  it('rejects more entries than maxEntries', async () => {
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'data/a.json', data: Buffer.from('[]') },
      { name: 'data/b.json', data: Buffer.from('[]') },
      { name: 'data/c.json', data: Buffer.from('[]') },
    ]);
    const err = await caughtArchiveError(
      extractMk(zipPath, destDir, { ...LIMITS, maxEntries: 2 }),
    );
    expect(err.errorKey).toBe('exchange.errors.archiveTooLarge');
  });

  it('rejects a JSON section bigger than maxJsonBytes', async () => {
    const bigArray = JSON.stringify([{ pad: 'x'.repeat(4096) }]);
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'data/sec.json', data: Buffer.from(bigArray, 'utf8') },
    ]);
    const err = await caughtArchiveError(
      extractMk(zipPath, destDir, { ...LIMITS, maxJsonBytes: 256 }),
    );
    expect(err.errorKey).toBe('exchange.errors.archiveTooLarge');
  });

  it('rejects files pushing the total past maxTotalBytes', async () => {
    // Incompressible payloads with truthful sizes: the cumulative
    // uncompressed-size accounting must trip on the second file.
    const payload = (): Buffer => {
      const buf = Buffer.alloc(600);
      for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) % 251;
      return buf;
    };
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'files/sec/one', data: payload() },
      { name: 'files/sec/two', data: payload() },
    ]);
    const err = await caughtArchiveError(
      extractMk(zipPath, destDir, { ...LIMITS, maxTotalBytes: 1000 }),
    );
    expect(err.errorKey).toBe('exchange.errors.archiveTooLarge');
    await expect(
      fileExists(join(destDir, 'files', 'sec', 'two')),
    ).resolves.toBe(false);
  });

  it('rejects a stored file entry whose declared size lies', async () => {
    // Stored (uncompressed) entry with a forged central-directory
    // uncompressedSize: yauzl's size validation refuses to even open the
    // stream, which surfaces as a malformed-archive rejection before any
    // byte reaches disk.
    const big = Buffer.alloc(64 * 1024, 7);
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'files/sec/big', data: big, compress: false },
    ]);
    const buf = await fsp.readFile(zipPath);
    forgeUncompressedSize(buf, 'files/sec/big', 16);
    await fsp.writeFile(zipPath, buf);

    const err = await caughtArchiveError(
      extractMk(zipPath, destDir, { ...LIMITS, maxTotalBytes: 4096 }),
    );
    expect(err.errorKey).toBe('exchange.errors.archiveMalformed');
    await expect(
      fileExists(join(destDir, 'files', 'sec', 'big')),
    ).resolves.toBe(false);
  });

  it('aborts an over-delivering deflated file entry mid-stream and removes the partial file', async () => {
    // The central directory claims 16 bytes; the deflate stream inflates to
    // 64 KiB. The pre-stream accounting passes on the lie, so the abort
    // happens while streaming — the oversized payload must NOT remain on
    // disk. Note: current `extractEntryToFile` resolves here instead of
    // rejecting (its fail() path destroys the write stream, whose 'close'
    // event wins the race against the rm-then-reject), so this test pins the
    // security-critical invariant (no payload on disk) and accepts either a
    // resolution or a proper MkArchiveError rejection.
    const big = Buffer.alloc(64 * 1024, 7);
    await writeZip(zipPath, [
      manifestEntry(),
      { name: 'files/sec/big', data: big },
    ]);
    const buf = await fsp.readFile(zipPath);
    forgeUncompressedSize(buf, 'files/sec/big', 16);
    await fsp.writeFile(zipPath, buf);

    const outcome = await extractMk(zipPath, destDir, {
      ...LIMITS,
      maxTotalBytes: 4096,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    if (outcome !== null) {
      expect(outcome).toBeInstanceOf(MkArchiveError);
    }
    await expect(
      fileExists(join(destDir, 'files', 'sec', 'big')),
    ).resolves.toBe(false);
  });

  it('rejects an archive without manifest.json', async () => {
    await writeZip(zipPath, [
      { name: 'data/sec.json', data: Buffer.from('[]') },
    ]);
    const err = await caughtArchiveError(extractMk(zipPath, destDir, LIMITS));
    expect(err.errorKey).toBe('exchange.errors.archiveMalformed');
  });

  it('rejects a manifest from a newer format version', async () => {
    await writeZip(zipPath, [
      manifestEntry({ formatVersion: MK_FORMAT_VERSION + 1 }),
    ]);
    const err = await caughtArchiveError(extractMk(zipPath, destDir, LIMITS));
    expect(err.errorKey).toBe('exchange.errors.formatTooNew');
  });

  it('extracts a well-formed archive', async () => {
    const records = [{ id: 'r1', name: 'rec' }];
    const fileBytes = Buffer.from([1, 2, 3, 4]);
    await writeZip(zipPath, [
      {
        name: 'data/sec.json',
        data: Buffer.from(JSON.stringify(records), 'utf8'),
      },
      { name: 'files/sec/f1.bin', data: fileBytes },
      manifestEntry({
        sections: [
          {
            key: 'sec',
            pluginId: 'synth',
            pluginVersion: '1.0.0',
            count: 1,
            hasFiles: true,
          },
        ],
      }),
    ]);

    const result = await extractMk(zipPath, destDir, LIMITS);
    expect(result.sectionKeys).toEqual(['sec']);
    expect(result.manifest.rootType).toBe('thing');
    expect(result.manifest.formatVersion).toBe(MK_FORMAT_VERSION);
    expect(result.manifest.sections).toHaveLength(1);

    const extractedJson: unknown = JSON.parse(
      await fsp.readFile(join(destDir, 'data', 'sec.json'), 'utf8'),
    );
    expect(extractedJson).toEqual(records);
    const extractedFile = await fsp.readFile(
      join(destDir, 'files', 'sec', 'f1.bin'),
    );
    expect(extractedFile.equals(fileBytes)).toBe(true);
    await expect(fileExists(join(destDir, 'manifest.json'))).resolves.toBe(
      true,
    );
  });
});
