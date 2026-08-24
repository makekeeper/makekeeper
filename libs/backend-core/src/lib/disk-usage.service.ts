import { Injectable, Logger } from '@nestjs/common';
import * as fsp from 'fs/promises';
import type { Dirent } from 'fs';
import { join, relative, resolve, sep } from 'path';
import {
  type DiskBrowseEntry,
  type DiskBrowseResult,
  type DiskCleanupResult,
  type DiskDeleteResult,
  type DiskEntryKind,
  type DiskReservedArea,
  type DiskUsageBucket,
  type DiskUsageByOwner,
  type DiskUsageByScope,
  type DiskUsageReport,
} from '@makekeeper/plugin-contract';
import { ATTACHMENT_ID_PREFIX } from './attachment-storage.service';
import { AppConfigService } from './app-config.service';
import { getErrorMessage } from './error';
import { PrismaService } from './prisma.service';
import { RequestContextService } from './request-context.service';
import { UploadsReservationService } from './uploads-reservation.service';

// What is using the disk, and what may be removed (#120).
//
// Built from BOTH sides and joined, never from one alone:
//   * the DB knows which bytes are claimed, by whom, and as what (original vs
//     rendition), but not what is actually on disk;
//   * the filesystem knows the truth about bytes, but nothing about ownership.
// A report from rows alone would miss orphans — the very files a cleanup takes
// first — and one from `du` alone could not tell an original from a derivative,
// which is the distinction the whole retention question turns on.
//
// The classification is what makes deletion safe, so it is computed here once
// and reused by every surface: nothing deletes by a kind the CLIENT sent.

// How long a file must sit unclaimed before a sweep may take it. Generous on
// purpose: the cost of waiting is some wasted disk, the cost of being hasty is
// deleting an upload whose row has not committed yet.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

// A browse level is a screen, not a data dump; a directory that somehow holds
// more entries than this is truncated (its rollup still counts everything).
const BROWSE_ENTRY_LIMIT = 500;

// How a single file relates to the app. Directories derive theirs from what
// they contain.
type FileKind = Exclude<DiskEntryKind, 'mixed'>;

interface FileEntry {
  bytes: number;
  modifiedAt: number;
  kind: FileKind;
  reservedBy?: string;
}

interface Analysis {
  originals: DiskUsageBucket;
  derivatives: DiskUsageBucket;
  // Keyed by declared plugin id; the '' key holds rows that declared none.
  byOwner: Map<string, OwnerSplit>;
  byScope: Map<string | null, DiskUsageBucket>;
  missingFiles: number;
  // Every file under the root, keyed by its root-relative path, classified.
  files: Map<string, FileEntry>;
}

// One plugin's share, kept split: the two halves cost differently, so folding
// them into a single number loses the only figure a retention decision needs.
interface OwnerSplit {
  originals: DiskUsageBucket;
  derivatives: DiskUsageBucket;
}

// A row, reduced to what the report needs.
interface UsageRow {
  ownerPluginId: string | null;
  storagePath: string;
  previewXsPath: string | null;
  previewSmPath: string | null;
  previewLgPath: string | null;
  projectId: string | null;
  sessionId: string | null;
  bridgeSessionId: string | null;
  scopeId: string | null;
}

@Injectable()
export class DiskUsageService {
  private readonly logger = new Logger(DiskUsageService.name);

  // Walking the tree and joining it against every row is too expensive to redo
  // on every drill-down click, so the analysis behind the report is kept for a
  // short while and reused while browsing.
  //
  // Only BROWSING may read it. The report is what the Refresh button asks for,
  // and deletions decide what may be unlinked — both recompute, because a stale
  // map is a wrong answer there: a file claimed since the last walk would be
  // shown as an orphan and, worse, deleted as one.
  private cached: { at: number; analysis: Analysis } | null = null;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly requestContext: RequestContextService,
    private readonly reservations: UploadsReservationService,
  ) {}

  // Admin-gated at the route; the scope bypass lives inside `analyse` because a
  // per-scope breakdown is meaningless when the query can only see the caller's
  // own rows.
  async report(): Promise<DiskUsageReport> {
    const root = this.config.getUploadsRoot();
    const analysis = await this.analyse({ fresh: true });

    const cutoff = orphanCutoff();
    const purgeable = empty();
    const recent = empty();
    const unowned = empty();
    const reserved = empty();
    const areas = new Map<string, DiskReservedArea>();

    for (const entry of analysis.files.values()) {
      switch (entry.kind) {
        case 'orphan':
          add(
            verdictFor(entry, cutoff) === 'recent' ? recent : purgeable,
            entry.bytes,
          );
          break;
        case 'unowned':
          add(unowned, entry.bytes);
          break;
        case 'reserved': {
          add(reserved, entry.bytes);
          const area = this.areaFor(areas, entry);
          if (area) {
            area.bytes += entry.bytes;
            area.files++;
          }
          break;
        }
        default:
          break; // claimed bytes are already in originals/derivatives
      }
    }

    return {
      root,
      total: sum([
        analysis.originals,
        analysis.derivatives,
        purgeable,
        recent,
        unowned,
        reserved,
      ]),
      originals: analysis.originals,
      derivatives: analysis.derivatives,
      unreferenced: sum([purgeable, recent]),
      unreferencedPurgeable: purgeable,
      unreferencedRecent: recent,
      reserved,
      reservedAreas: [...areas.values()].sort((a, b) => b.bytes - a.bytes),
      unowned,
      orphanGraceHours: ORPHAN_GRACE_MS / (60 * 60 * 1000),
      missingFiles: analysis.missingFiles,
      byOwner: [...analysis.byOwner.entries()]
        .map(
          ([pluginId, split]): DiskUsageByOwner => ({
            pluginId: pluginId === UNDECLARED_OWNER ? null : pluginId,
            ...split,
          }),
        )
        .sort(
          (a, b) =>
            b.originals.bytes +
            b.derivatives.bytes -
            (a.originals.bytes + a.derivatives.bytes),
        ),
      byScope: [...analysis.byScope.entries()]
        .map(
          ([scopeId, bucket]): DiskUsageByScope => ({
            scopeId,
            ...bucket,
          }),
        )
        .sort((a, b) => b.bytes - a.bytes),
      generatedAt: new Date().toISOString(),
    };
  }

  // One level of the tree, with every directory rolled up to what it contains.
  // The rollup is the point: a month of uploads is one row, so the view stays
  // readable on an instance with a hundred thousand files.
  async browse(path: string): Promise<DiskBrowseResult> {
    const analysis = await this.analyse();
    const dir = normalizeRelative(path);
    const prefix = dir ? `${dir}/` : '';
    const cutoff = orphanCutoff();

    // Accumulate each immediate child — a file of this directory, or the whole
    // subtree hiding behind a child directory name.
    const children = new Map<string, DiskBrowseEntry>();
    for (const [filePath, entry] of analysis.files) {
      if (prefix && !filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      const childPath = prefix + name;
      const isDirectory = slash >= 0;
      const deletable = isDeletable(entry, cutoff);

      const existing = children.get(childPath);
      if (!existing) {
        children.set(childPath, {
          name,
          path: childPath,
          isDirectory,
          kind: entry.kind,
          ...(entry.reservedBy ? { reservedBy: entry.reservedBy } : {}),
          ...(isDirectory
            ? {}
            : { modifiedAt: new Date(entry.modifiedAt).toISOString() }),
          bytes: entry.bytes,
          files: 1,
          deletableBytes: deletable ? entry.bytes : 0,
          deletableFiles: deletable ? 1 : 0,
        });
        continue;
      }
      existing.bytes += entry.bytes;
      existing.files++;
      if (deletable) {
        existing.deletableBytes += entry.bytes;
        existing.deletableFiles++;
      }
      // A directory holding several kinds is honestly "mixed" rather than
      // whichever file happened to be walked first.
      if (existing.kind !== entry.kind) existing.kind = 'mixed';
      if (existing.reservedBy !== entry.reservedBy) {
        delete existing.reservedBy;
      }
    }

    const entries = [...children.values()].sort((a, b) =>
      a.isDirectory === b.isDirectory
        ? b.bytes - a.bytes
        : a.isDirectory
          ? -1
          : 1,
    );

    return {
      path: dir,
      parentPath:
        dir === '' ? null : dir.slice(0, Math.max(0, dir.lastIndexOf('/'))),
      entries: entries.slice(0, BROWSE_ENTRY_LIMIT),
      truncated: entries.length > BROWSE_ENTRY_LIMIT,
    };
  }

  // The one-click sweep: files the attachment store wrote that no record claims
  // and that are old enough to judge. Deliberately narrower than what the
  // browser can delete — this runs without anyone looking at a list.
  async purgeUnreferenced(): Promise<DiskCleanupResult> {
    const analysis = await this.analyse({ fresh: true });
    const cutoff = orphanCutoff();

    const deleted = empty();
    let skippedRecent = 0;
    let failed = 0;

    for (const [path, entry] of analysis.files) {
      // Narrower than the browser on purpose: only files the store itself
      // wrote, never `unowned` ones, because nobody is looking at a list here.
      if (entry.kind !== 'orphan') continue;
      if (verdictFor(entry, cutoff) === 'recent') {
        skippedRecent++;
        continue;
      }
      if (await this.removeFile(path)) add(deleted, entry.bytes);
      else failed++;
    }

    this.invalidate();
    this.logger.log(
      `Unreferenced sweep: removed ${deleted.files} files (${deleted.bytes} bytes), skipped ${skippedRecent} recent, ${failed} failed.`,
    );
    return { deleted, skippedRecent, failed };
  }

  // Delete an explicit selection — files or whole directories — as chosen in
  // the browser. Everything the client sends is a PATH: the kind is re-derived
  // here from a fresh analysis, so a file claimed since the page was drawn is
  // kept, and a forged or traversing path resolves to nothing under the root.
  async deletePaths(paths: readonly string[]): Promise<DiskDeleteResult> {
    const analysis = await this.analyse({ fresh: true });
    const root = this.config.getUploadsRoot();
    const cutoff = orphanCutoff();

    const result: DiskDeleteResult = {
      deleted: empty(),
      skippedClaimed: 0,
      skippedReserved: 0,
      skippedRecent: 0,
      missing: 0,
      failed: 0,
    };

    // A selection may name a directory, so expand each request to the files it
    // covers — deduplicated, since selecting a directory and a file inside it
    // is a normal thing for a person to do.
    const targets = new Set<string>();
    for (const raw of paths) {
      const path = normalizeRelative(raw);
      if (!path || !insideRoot(root, path)) {
        result.missing++;
        continue;
      }
      if (analysis.files.has(path)) {
        targets.add(path);
        continue;
      }
      const prefix = `${path}/`;
      let matched = false;
      for (const candidate of analysis.files.keys()) {
        if (candidate.startsWith(prefix)) {
          targets.add(candidate);
          matched = true;
        }
      }
      if (!matched) result.missing++;
    }

    for (const path of targets) {
      const entry = analysis.files.get(path);
      if (!entry) {
        result.missing++;
        continue;
      }
      switch (verdictFor(entry, cutoff)) {
        case 'claimed':
          result.skippedClaimed++;
          continue;
        case 'reserved':
          result.skippedReserved++;
          continue;
        case 'recent':
          result.skippedRecent++;
          continue;
        case 'deletable':
          break;
      }
      if (await this.removeFile(path)) add(result.deleted, entry.bytes);
      else result.failed++;
    }

    this.invalidate();
    this.logger.log(
      `Manual delete: removed ${result.deleted.files} files (${result.deleted.bytes} bytes), kept ${result.skippedClaimed} claimed / ${result.skippedReserved} reserved / ${result.skippedRecent} recent, ${result.failed} failed.`,
    );
    return result;
  }

  private areaFor(
    areas: Map<string, DiskReservedArea>,
    entry: FileEntry,
  ): DiskReservedArea | null {
    const reservation = this.reservations
      .list()
      .find((r) => r.pluginId === entry.reservedBy);
    if (!reservation) return null;
    const existing = areas.get(reservation.path);
    if (existing) return existing;
    const area: DiskReservedArea = {
      path: reservation.path,
      pluginId: reservation.pluginId,
      bytes: 0,
      files: 0,
    };
    areas.set(reservation.path, area);
    return area;
  }

  private async removeFile(relativePath: string): Promise<boolean> {
    try {
      await fsp.rm(join(this.config.getUploadsRoot(), relativePath));
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not remove ${relativePath}: ${getErrorMessage(err)}`,
      );
      return false;
    }
  }

  private invalidate(): void {
    this.cached = null;
  }

  private async analyse({ fresh } = { fresh: false }): Promise<Analysis> {
    const cached = this.cached;
    if (
      !fresh &&
      cached &&
      Date.now() - cached.at < DiskUsageService.CACHE_TTL_MS
    ) {
      return cached.analysis;
    }
    const analysis = await this.computeAnalysis();
    this.cached = { at: Date.now(), analysis };
    return analysis;
  }

  // The join every surface stands on: rows classify, the filesystem measures.
  private async computeAnalysis(): Promise<Analysis> {
    const root = this.config.getUploadsRoot();
    const [files, rows] = await Promise.all([
      this.walk(root),
      this.requestContext.runWithoutScope('admin-cross-user', () =>
        this.readRows(),
      ),
    ]);

    const originals = empty();
    const derivatives = empty();
    // The whole-instance split, addressed the same way an owner's is, so one
    // claim adds to both without asking twice which half it is in.
    const totals: OwnerSplit = { originals, derivatives };
    const byOwner = new Map<string, OwnerSplit>();
    const byScope = new Map<string | null, DiskUsageBucket>();
    let missingFiles = 0;

    // One stored file can be claimed by several rows: since #78 an identical
    // upload is deduplicated to the file already on disk. Its bytes exist ONCE,
    // so they are counted once — for the first row that claims it, which also
    // decides the owner and scope they land under. Counting per row would
    // inflate originals, byOwner and byScope past `total`, which is measured by
    // walking the disk, and break the promise that the figure matches `du`.
    const counted = new Set<string>();

    for (const row of rows) {
      const ownerKey = ownerKeyOf(row);
      const owner = byOwner.get(ownerKey) ?? {
        originals: empty(),
        derivatives: empty(),
      };
      byOwner.set(ownerKey, owner);
      const scope = byScope.get(row.scopeId) ?? empty();
      byScope.set(row.scopeId, scope);

      // Bytes come from disk, never from the row's recorded size: a record
      // whose file is gone must not inflate the disk figure, or the report
      // stops matching `du` and cannot inform the decision it exists for.
      // `missingFiles` stays per ROW — it counts broken records, not bytes.
      const claim = (path: string, half: keyof OwnerSplit): void => {
        const file = files.get(path);
        if (!file) {
          missingFiles++;
          return;
        }
        file.kind = 'claimed';
        if (counted.has(path)) return;
        counted.add(path);
        add(totals[half], file.bytes);
        add(owner[half], file.bytes);
        add(scope, file.bytes);
      };

      claim(row.storagePath, 'originals');
      for (const path of [
        row.previewXsPath,
        row.previewSmPath,
        row.previewLgPath,
      ]) {
        if (path) claim(path, 'derivatives');
      }
    }

    return { originals, derivatives, byOwner, byScope, missingFiles, files };
  }

  private readRows(): Promise<UsageRow[]> {
    return this.prisma.attachment.findMany({
      select: {
        ownerPluginId: true,
        storagePath: true,
        previewXsPath: true,
        previewSmPath: true,
        previewLgPath: true,
        projectId: true,
        sessionId: true,
        bridgeSessionId: true,
        scopeId: true,
      },
    });
  }

  // Every file under the uploads root, keyed by the SAME root-relative path a
  // row stores, so the join is a map lookup rather than a per-row `stat`.
  //
  // Each file starts out classified by ORIGIN alone — reserved by a plugin's
  // declaration, ours by the store's naming, otherwise nobody's. Being claimed
  // is decided later, by the rows.
  private async walk(root: string): Promise<Map<string, FileEntry>> {
    const files = new Map<string, FileEntry>();
    let entries: Dirent<string>[];
    try {
      entries = await fsp.readdir(root, {
        recursive: true,
        withFileTypes: true,
      });
    } catch (err) {
      // A missing root is the normal state of a fresh instance — an empty
      // report is the honest answer, not a 500.
      this.logger.warn(`Uploads root unreadable: ${getErrorMessage(err)}`);
      return files;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const abs = join(entry.parentPath, entry.name);
      const relativePath = toPosix(relative(root, abs));
      try {
        const stat = await fsp.stat(abs);
        const reservedBy = this.reservations.ownerOf(relativePath);
        files.set(relativePath, {
          bytes: stat.size,
          modifiedAt: stat.mtimeMs,
          kind: reservedBy
            ? 'reserved'
            : wasWrittenByStore(relativePath)
              ? 'orphan'
              : 'unowned',
          ...(reservedBy ? { reservedBy } : {}),
        });
      } catch {
        // Vanished between readdir and stat — treat it as already gone.
      }
    }
    return files;
  }
}

// Now, minus the grace period: unclaimed files older than this are old enough
// to tell from an upload still in flight. Derived in one place so no two
// surfaces can disagree about where the line is.
function orphanCutoff(): number {
  return Date.now() - ORPHAN_GRACE_MS;
}

// What a deletion would do with one file, and why. Every surface — the report's
// purgeable/recent split, the browser's per-row totals, the sweep, the explicit
// delete — asks this same question, so the rules live here once: claimed and
// reserved files are never deletable from here; an orphan becomes deletable
// once it is old enough; unowned files are deletable, but only by explicit
// selection, which is the caller's rule to keep, not this one's.
type DeletionVerdict = 'deletable' | 'claimed' | 'reserved' | 'recent';

function verdictFor(entry: FileEntry, cutoff: number): DeletionVerdict {
  switch (entry.kind) {
    case 'claimed':
      return 'claimed';
    case 'reserved':
      return 'reserved';
    case 'orphan':
      return entry.modifiedAt > cutoff ? 'recent' : 'deletable';
    case 'unowned':
      return 'deletable';
  }
}

function isDeletable(entry: FileEntry, cutoff: number): boolean {
  return verdictFor(entry, cutoff) === 'deletable';
}

// The store names every file it writes `<id>.<ext>`, and every id carries the
// attachment prefix. A file that does not is somebody else's — the sweep must
// never take it, however unclaimed it looks.
function wasWrittenByStore(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.startsWith(ATTACHMENT_ID_PREFIX);
}

// Rows store POSIX-separated relative paths; normalise so the join holds on any
// platform rather than silently reporting every file as unreferenced.
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

// A client-supplied path is a request, not a fact: strip separators and reject
// anything that climbs out. Returns '' for the root itself.
function normalizeRelative(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

// Belt to the normaliser's braces: resolve and confirm the result really sits
// under the root before anything is unlinked.
function insideRoot(root: string, relativePath: string): boolean {
  const target = resolve(root, relativePath);
  return target === root || target.startsWith(root + sep);
}

// Rows written before uploads declared their plugin, and not attributable from
// their id columns either. Grouped under a key no plugin id can collide with
// (an id is never empty) and reported as undetermined, never merged into a
// plugin's total.
const UNDECLARED_OWNER = '';

// The declaration is the answer. The id columns are only a fallback for rows
// the backfill could not reach — a pre-declaration instance whose migration
// found nothing to go on.
function ownerKeyOf(row: UsageRow): string {
  if (row.ownerPluginId) return row.ownerPluginId;
  if (row.projectId) return 'projects';
  if (row.sessionId) return 'chat';
  if (row.bridgeSessionId) return 'phone-bridge';
  return UNDECLARED_OWNER;
}

function empty(): DiskUsageBucket {
  return { bytes: 0, files: 0 };
}

function add(bucket: DiskUsageBucket, bytes: number): void {
  bucket.bytes += bytes;
  bucket.files++;
}

function sum(buckets: DiskUsageBucket[]): DiskUsageBucket {
  return buckets.reduce<DiskUsageBucket>(
    (total, bucket) => ({
      bytes: total.bytes + bucket.bytes,
      files: total.files + bucket.files,
    }),
    empty(),
  );
}
