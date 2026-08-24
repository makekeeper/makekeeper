// The `.mkx` archive layer: a plain ZIP with a fixed layout —
//   manifest.json                  archive metadata (MkManifest)
//   data/<sectionKey>.json         one record array per section
//   files/<sectionKey>/<fileId>    binary payloads of `hasFiles` sections
//
// Writing streams through yazl into a temp file (the export endpoint then
// streams that file to the client — a provider failure surfaces as a clean
// HTTP error instead of a corrupt half-download). Reading extracts through
// yauzl into a per-upload temp directory with the zip-bomb/path-traversal
// guards below; nothing from the archive is ever trusted as a path.

import { createWriteStream, promises as fsp } from 'fs';
import type { Readable } from 'stream';
import { dirname, join } from 'path';
import { ZipFile } from 'yazl';
import {
  open as openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';

export const MK_FORMAT_VERSION = 1;

// Canonical file extension for an exchange archive — the single home for the `.mkx`
// suffix so the emit path never re-derives it. A technical identifier, not UI text.
export const MK_ARCHIVE_EXTENSION = '.mkx';

export interface MkSectionMeta {
  key: string;
  pluginId: string;
  pluginVersion: string;
  count: number;
  hasFiles: boolean;
}

export interface MkManifest {
  formatVersion: number;
  rootType: string;
  // Original id of the exported root entity; null for dataset roots.
  rootId: string | null;
  exportedAt: string;
  // Random per-export id — lets support tell archives apart without
  // identifying the source instance.
  exportId: string;
  sections: MkSectionMeta[];
}

// Hard ceilings against zip bombs. Entry names are validated structurally, so
// a hostile archive can neither escape the extraction dir nor exhaust disk.
export interface ExtractLimits {
  maxEntries: number;
  maxJsonBytes: number;
  maxTotalBytes: number;
}

// One path segment: safe charset, no dot-prefix (blocks '.', '..', dotfiles).
const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

type EntryKind =
  | { kind: 'manifest' }
  | { kind: 'section'; sectionKey: string }
  | { kind: 'file'; sectionKey: string; fileId: string };

// Classify an entry name against the fixed layout; null = reject the archive.
export function classifyEntryName(name: string): EntryKind | null {
  if (name === 'manifest.json') return { kind: 'manifest' };
  const parts = name.split('/');
  if (parts[0] === 'data' && parts.length === 2) {
    const file = parts[1];
    if (!file.endsWith('.json')) return null;
    const sectionKey = file.slice(0, -'.json'.length);
    if (!SAFE_SEGMENT.test(sectionKey)) return null;
    return { kind: 'section', sectionKey };
  }
  if (parts[0] === 'files' && parts.length === 3) {
    if (!SAFE_SEGMENT.test(parts[1]) || !SAFE_SEGMENT.test(parts[2]))
      return null;
    return { kind: 'file', sectionKey: parts[1], fileId: parts[2] };
  }
  return null;
}

// ── Writing ─────────────────────────────────────────────────────────────────

export class MkWriter {
  private readonly zip = new ZipFile();
  private readonly done: Promise<void>;

  constructor(outPath: string) {
    const out = createWriteStream(outPath);
    this.done = new Promise((resolvePromise, rejectPromise) => {
      out.on('close', () => resolvePromise());
      out.on('error', rejectPromise);
      this.zip.outputStream.on('error', rejectPromise);
    });
    this.zip.outputStream.pipe(out);
  }

  addSection(sectionKey: string, records: unknown[]): void {
    this.zip.addBuffer(
      Buffer.from(JSON.stringify(records), 'utf8'),
      `data/${sectionKey}.json`,
    );
  }

  addFile(sectionKey: string, fileId: string, data: Uint8Array): void {
    this.zip.addBuffer(Buffer.from(data), `files/${sectionKey}/${fileId}`);
  }

  // Streaming variant: yazl reads the file from disk while writing the zip,
  // so attachments never sit in memory whole.
  addFileFromPath(sectionKey: string, fileId: string, absPath: string): void {
    this.zip.addFile(absPath, `files/${sectionKey}/${fileId}`);
  }

  async finalize(manifest: MkManifest): Promise<void> {
    this.zip.addBuffer(
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      'manifest.json',
    );
    this.zip.end();
    await this.done;
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

// Thrown with an i18n error KEY (per §5.5 the key is the only string literal);
// the controller maps it to a 400.
export class MkArchiveError extends Error {
  constructor(readonly errorKey: string) {
    super(errorKey);
  }
}

function openArchive(zipPath: string): Promise<YauzlZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    openZip(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        rejectPromise(new MkArchiveError('exchange.errors.archiveMalformed'));
        return;
      }
      resolvePromise(zip);
    });
  });
}

function openEntryStream(zip: YauzlZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        rejectPromise(new MkArchiveError('exchange.errors.archiveMalformed'));
        return;
      }
      resolvePromise(stream);
    });
  });
}

function readEntry(
  zip: YauzlZipFile,
  entry: Entry,
  maxBytes: number,
): Promise<Buffer> {
  return openEntryStream(zip, entry).then(
    (stream) =>
      new Promise((resolvePromise, rejectPromise) => {
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            stream.destroy();
            rejectPromise(
              new MkArchiveError('exchange.errors.archiveTooLarge'),
            );
            return;
          }
          chunks.push(chunk);
        });
        stream.on('error', () =>
          rejectPromise(new MkArchiveError('exchange.errors.archiveMalformed')),
        );
        stream.on('end', () => resolvePromise(Buffer.concat(chunks)));
      }),
  );
}

// Stream one entry straight to disk with the same byte-cap guard — binary
// payloads never transit memory whole. The partial file is removed on failure.
function extractEntryToFile(
  zip: YauzlZipFile,
  entry: Entry,
  target: string,
  maxBytes: number,
): Promise<void> {
  return openEntryStream(zip, entry).then(
    (stream) =>
      new Promise((resolvePromise, rejectPromise) => {
        const out = createWriteStream(target);
        let total = 0;
        let failed = false;
        const fail = (error: unknown): void => {
          if (failed) return;
          failed = true;
          stream.destroy();
          out.destroy();
          void fsp.rm(target, { force: true }).finally(() => {
            rejectPromise(error);
          });
        };
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            fail(new MkArchiveError('exchange.errors.archiveTooLarge'));
          }
        });
        stream.on('error', () =>
          fail(new MkArchiveError('exchange.errors.archiveMalformed')),
        );
        out.on('error', () =>
          fail(new MkArchiveError('exchange.errors.archiveMalformed')),
        );
        // 'finish', not 'close' — destroy() also emits 'close', which would
        // let a failed extraction resolve as success before rm+reject land.
        out.on('finish', () => {
          if (!failed) resolvePromise();
        });
        stream.pipe(out);
      }),
  );
}

export interface ExtractedMk {
  manifest: MkManifest;
  // Section keys that actually have a data/<key>.json entry.
  sectionKeys: string[];
}

function isMkManifest(value: unknown): value is MkManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m['formatVersion'] === 'number' &&
    typeof m['rootType'] === 'string' &&
    (m['rootId'] === null || typeof m['rootId'] === 'string') &&
    Array.isArray(m['sections'])
  );
}

// Extract a `.mkx` archive into `destDir` (created by the caller, empty).
// Layout inside destDir mirrors the archive: data/<key>.json, files/<key>/<id>.
// Every entry name is validated before any byte is written.
export async function extractMk(
  zipPath: string,
  destDir: string,
  limits: ExtractLimits,
): Promise<ExtractedMk> {
  const zip = await openArchive(zipPath);
  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    throw new MkArchiveError('exchange.errors.archiveTooLarge');
  }
  let totalBytes = 0;
  // Holder object rather than a bare `let`: the assignment happens inside the
  // entry-event closure, which TS's control-flow analysis cannot see — a
  // property read keeps the declared type instead of narrowing to `never`.
  const found: { manifest: Buffer | null } = { manifest: null };
  const sectionKeys: string[] = [];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const fail = (error: unknown): void => {
      zip.close();
      rejectPromise(error);
    };
    zip.on('error', () =>
      fail(new MkArchiveError('exchange.errors.archiveMalformed')),
    );
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        // Directory entries carry no payload — skip.
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        const kind = classifyEntryName(entry.fileName);
        if (!kind) {
          fail(new MkArchiveError('exchange.errors.archiveMalformed'));
          return;
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > limits.maxTotalBytes) {
          fail(new MkArchiveError('exchange.errors.archiveTooLarge'));
          return;
        }
        if (kind.kind === 'manifest') {
          found.manifest = await readEntry(zip, entry, limits.maxJsonBytes);
        } else if (kind.kind === 'section') {
          sectionKeys.push(kind.sectionKey);
          const target = join(destDir, 'data', `${kind.sectionKey}.json`);
          await fsp.mkdir(dirname(target), { recursive: true });
          await fsp.writeFile(
            target,
            await readEntry(zip, entry, limits.maxJsonBytes),
          );
        } else {
          // Binary payloads stream to disk — never buffered whole.
          const target = join(destDir, 'files', kind.sectionKey, kind.fileId);
          await fsp.mkdir(dirname(target), { recursive: true });
          await extractEntryToFile(zip, entry, target, limits.maxTotalBytes);
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.on('end', () => resolvePromise());
    zip.readEntry();
  });
  zip.close();

  const manifestBuffer = found.manifest;
  if (!manifestBuffer)
    throw new MkArchiveError('exchange.errors.archiveMalformed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBuffer.toString('utf8'));
  } catch {
    throw new MkArchiveError('exchange.errors.archiveMalformed');
  }
  if (!isMkManifest(parsed)) {
    throw new MkArchiveError('exchange.errors.archiveMalformed');
  }
  if (parsed.formatVersion > MK_FORMAT_VERSION) {
    throw new MkArchiveError('exchange.errors.formatTooNew');
  }
  await fsp.writeFile(join(destDir, 'manifest.json'), manifestBuffer);
  return { manifest: parsed, sectionKeys };
}

// Read one extracted section's record array back, size-guarded upstream.
export async function readExtractedSection(
  destDir: string,
  sectionKey: string,
): Promise<unknown[] | null> {
  if (!SAFE_SEGMENT.test(sectionKey)) return null;
  try {
    const raw = await fsp.readFile(
      join(destDir, 'data', `${sectionKey}.json`),
      'utf8',
    );
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Read one file of an extracted section straight from the archive layout
// (`files/<sectionKey>/<fileId>`). Used for sections that have no installed
// provider to hand a file source to — an external plugin's parked block
// (#138) is read this way before being deferred.
export async function readExtractedSectionFile(
  destDir: string,
  sectionKey: string,
  fileId: string,
): Promise<Uint8Array | null> {
  if (!SAFE_SEGMENT.test(sectionKey) || !SAFE_SEGMENT.test(fileId)) return null;
  try {
    return await fsp.readFile(join(destDir, 'files', sectionKey, fileId));
  } catch {
    return null;
  }
}
