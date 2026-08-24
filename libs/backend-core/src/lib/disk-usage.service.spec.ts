import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DiskUsageByOwner } from '@makekeeper/plugin-contract';
import { DiskUsageService } from './disk-usage.service';
import type { AppConfigService } from './app-config.service';
import type { PrismaService } from './prisma.service';
import type { RequestContextService } from './request-context.service';
import type { UploadsReservationService } from './uploads-reservation.service';

// The disk report (#120) against a real temp tree: what makes this worth testing
// is precisely the join between rows and files, which a mocked filesystem would
// define away.

interface Row {
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

const row = (overrides: Partial<Row> & Pick<Row, 'storagePath'>): Row => ({
  ownerPluginId: null,
  previewXsPath: null,
  previewSmPath: null,
  previewLgPath: null,
  projectId: null,
  sessionId: null,
  bridgeSessionId: null,
  scopeId: null,
  ...overrides,
});

const write = async (root: string, path: string, bytes: number) => {
  const abs = join(root, path);
  await fsp.mkdir(join(abs, '..'), { recursive: true });
  await fsp.writeFile(abs, Buffer.alloc(bytes));
};

const build = (
  root: string,
  rows: Row[],
  reserved: Array<{ pluginId: string; path: string }> = [],
): DiskUsageService =>
  new DiskUsageService(
    {
      attachment: { findMany: () => Promise.resolve(rows) },
    } as unknown as PrismaService,
    { getUploadsRoot: () => root } as unknown as AppConfigService,
    {
      // The real one copies the store and flips a flag; for this service all
      // that matters is that the callback runs.
      runWithoutScope: <T>(_reason: string, fn: () => Promise<T>) => fn(),
    } as unknown as RequestContextService,
    {
      list: () => reserved,
      ownerOf: (path: string) =>
        reserved.find((r) => path === r.path || path.startsWith(`${r.path}/`))
          ?.pluginId ?? null,
    } as unknown as UploadsReservationService,
  );

const PHONE_BRIDGE_BIN = [{ pluginId: 'phone-bridge', path: '_bin' }];

// The report lists owners largest first; tests ask by plugin id rather than by
// position so a change in sizes does not silently retarget an assertion.
const owner = (
  report: { byOwner: DiskUsageByOwner[] },
  pluginId: string | null,
) => report.byOwner.find((o) => o.pluginId === pluginId);

describe('DiskUsageService (#120)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'mk-usage-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('separates originals from derivatives — the distinction retention turns on', async () => {
    await write(root, 'p1/2026/07/26/att_a.jpg', 1000);
    await write(root, 'p1/2026/07/26/att_a.sm.webp', 100);
    await write(root, 'p1/2026/07/26/att_a.xs.webp', 40);

    const report = await build(root, [
      row({
        ownerPluginId: 'projects',
        storagePath: 'p1/2026/07/26/att_a.jpg',
        previewSmPath: 'p1/2026/07/26/att_a.sm.webp',
        previewXsPath: 'p1/2026/07/26/att_a.xs.webp',
        projectId: 'proj_1',
      }),
    ]).report();

    expect(report.originals).toEqual({ bytes: 1000, files: 1 });
    expect(report.derivatives).toEqual({ bytes: 140, files: 2 });
    expect(report.total).toEqual({ bytes: 1140, files: 3 });
    expect(owner(report, 'projects')).toEqual({
      pluginId: 'projects',
      originals: { bytes: 1000, files: 1 },
      derivatives: { bytes: 140, files: 2 },
    });
  });

  // Image dedup (#78) points several attachments at one stored file. The bytes
  // are on disk once, so they are counted once — otherwise the buckets grow
  // past `total`, which is measured by walking the disk, and the whole report
  // stops matching `du`.
  it('counts a file shared by several rows once', async () => {
    await write(root, 'shared/att_a.jpg', 1000);
    await write(root, 'shared/att_a.sm.webp', 100);

    const shared = {
      storagePath: 'shared/att_a.jpg',
      previewSmPath: 'shared/att_a.sm.webp',
    };
    const report = await build(root, [
      row({ ...shared, ownerPluginId: 'projects', projectId: 'proj_1' }),
      row({ ...shared, ownerPluginId: 'chat', sessionId: 'chat_1' }),
    ]).report();

    expect(report.originals).toEqual({ bytes: 1000, files: 1 });
    expect(report.derivatives).toEqual({ bytes: 100, files: 1 });
    expect(report.total).toEqual({ bytes: 1100, files: 2 });
    // Attributed to the row that claimed it first, never to both.
    expect(owner(report, 'projects')).toEqual({
      pluginId: 'projects',
      originals: { bytes: 1000, files: 1 },
      derivatives: { bytes: 100, files: 1 },
    });
    expect(owner(report, 'chat')?.originals).toEqual({ bytes: 0, files: 0 });
  });

  // The files a cleanup would take first, and the ones `du` sees but no listing
  // in the app ever will.
  it('counts store-written files no row claims as unreferenced', async () => {
    await write(root, 'chat/att_b.jpg', 500);
    await write(root, 'chat/att_stray.jpg', 700);

    const report = await build(root, [
      row({
        ownerPluginId: 'chat',
        storagePath: 'chat/att_b.jpg',
        sessionId: 'chat_1',
      }),
    ]).report();

    expect(report.unreferenced).toEqual({ bytes: 700, files: 1 });
    expect(owner(report, 'chat')?.originals).toEqual({ bytes: 500, files: 1 });
    expect(report.total.bytes).toBe(1200);
  });

  // The uploads root is a writable directory the app owns, not a directory the
  // attachment store owns: the phone-bridge keeps its managed cloudflared
  // binary in `_bin/`. Counting it is right; offering to delete it is not.
  it('labels a declared subtree by its owner and keeps it out of the sweep', async () => {
    await write(root, '_bin/cloudflared', 5000);
    await write(root, 'p1/att_a.jpg', 100);

    const report = await build(
      root,
      [row({ storagePath: 'p1/att_a.jpg', projectId: 'proj_1' })],
      PHONE_BRIDGE_BIN,
    ).report();

    expect(report.reserved).toEqual({ bytes: 5000, files: 1 });
    expect(report.reservedAreas).toEqual([
      { path: '_bin', pluginId: 'phone-bridge', bytes: 5000, files: 1 },
    ]);
    expect(report.unreferenced).toEqual({ bytes: 0, files: 0 });
    // Still part of the disk figure — it does occupy the disk.
    expect(report.total).toEqual({ bytes: 5100, files: 2 });
  });

  // Nobody declared it and the store did not write it: junk accumulates here
  // too, so it is counted as deletable-by-hand rather than hidden as untouchable.
  it('counts a file with no owner at all as unowned', async () => {
    await write(root, 'leftover/report.pdf', 300);

    const report = await build(root, [], PHONE_BRIDGE_BIN).report();

    expect(report.unowned).toEqual({ bytes: 300, files: 1 });
    expect(report.reserved).toEqual({ bytes: 0, files: 0 });
    expect(report.unreferenced).toEqual({ bytes: 0, files: 0 });
  });

  // A row whose bytes are gone must not inflate the disk figure, or the report
  // stops matching `du` and cannot inform the decision it exists for.
  it('reports a row whose file vanished without counting its bytes', async () => {
    const report = await build(root, [
      row({ storagePath: 'gone/att_c.jpg', projectId: 'proj_1' }),
    ]).report();

    expect(report.missingFiles).toBe(1);
    expect(report.total).toEqual({ bytes: 0, files: 0 });
  });

  // The declaration is what a surface is attributed by. Rows written before it
  // existed fall back to their id columns, and a row with neither is reported
  // as undetermined rather than attached to whoever happens to be first.
  it('groups by the declared plugin, falling back for legacy rows', async () => {
    await write(root, 'a.jpg', 10);
    await write(root, 'b.jpg', 20);
    await write(root, 'c.jpg', 30);
    await write(root, 'd.jpg', 40);

    const report = await build(root, [
      // Declared: an inventory photo links to no record at all, and is
      // attributed anyway — the case column inference used to lose.
      row({ storagePath: 'a.jpg', ownerPluginId: 'inventory' }),
      // Legacy rows the backfill could reach.
      row({ storagePath: 'b.jpg', sessionId: 'chat_1' }),
      row({ storagePath: 'c.jpg', bridgeSessionId: 'bridge_1' }),
      // Legacy row with nothing to go on.
      row({ storagePath: 'd.jpg' }),
    ]).report();

    expect(owner(report, 'inventory')?.originals.bytes).toBe(10);
    expect(owner(report, 'chat')?.originals.bytes).toBe(20);
    expect(owner(report, 'phone-bridge')?.originals.bytes).toBe(30);
    expect(owner(report, null)?.originals.bytes).toBe(40);
  });

  // Pre-overlay rows own nothing yet; keeping them as their own group is the
  // point, not an accident of grouping.
  it('groups by scope, biggest first, keeping unowned rows apart', async () => {
    await write(root, 'a.jpg', 10);
    await write(root, 'b.jpg', 900);
    await write(root, 'c.jpg', 50);

    const report = await build(root, [
      row({ storagePath: 'a.jpg', scopeId: 'u1' }),
      row({ storagePath: 'b.jpg', scopeId: 'u2' }),
      row({ storagePath: 'c.jpg' }),
    ]).report();

    expect(report.byScope).toEqual([
      { scopeId: 'u2', bytes: 900, files: 1 },
      { scopeId: null, bytes: 50, files: 1 },
      { scopeId: 'u1', bytes: 10, files: 1 },
    ]);
  });

  // A fresh instance has no uploads directory at all; that is not a 500.
  it('reports an empty tree when the root does not exist', async () => {
    const report = await build(join(root, 'missing'), []).report();
    expect(report.total).toEqual({ bytes: 0, files: 0 });
  });

  // The page offers a number and then deletes; those two must be the same
  // number, or "free 512 KiB" becomes "deleted 0 files".
  it('splits unreferenced into what a sweep takes and what it keeps', async () => {
    await write(root, 'att_old.bin', 300);
    await write(root, 'att_fresh.bin', 90);
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await fsp.utimes(join(root, 'att_old.bin'), old, old);

    const report = await build(root, []).report();

    expect(report.unreferenced).toEqual({ bytes: 390, files: 2 });
    expect(report.unreferencedPurgeable).toEqual({ bytes: 300, files: 1 });
    expect(report.unreferencedRecent).toEqual({ bytes: 90, files: 1 });
    expect(report.orphanGraceHours).toBe(24);
  });

  it('lists orphans biggest first, offering only the ones old enough', async () => {
    await write(root, 'att_small.bin', 10);
    await write(root, 'att_big.bin', 900);
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await fsp.utimes(join(root, 'att_big.bin'), old, old);

    const report = await build(root, []).report();

    const listing = await build(root, []).browse('');
    expect(listing.entries.map((e) => e.name)).toEqual([
      'att_big.bin',
      'att_small.bin',
    ]);
    expect(listing.entries[0].deletableBytes).toBe(900);
    // Too recent to judge: visible, but not offered.
    expect(listing.entries[1].deletableBytes).toBe(0);
  });

  // Point of the browser: a month of uploads is one row, not four thousand.
  describe('browse', () => {
    const tree = async () => {
      await write(root, 'p1/2026/06/01/att_a.jpg', 1000);
      await write(root, 'p1/2026/06/02/att_b.jpg', 500);
      await write(root, '_bin/cloudflared', 5000);
      await write(root, 'loose.txt', 20);
    };

    it('rolls a directory up to everything beneath it', async () => {
      await tree();
      const result = await build(
        root,
        [row({ storagePath: 'p1/2026/06/01/att_a.jpg', projectId: 'proj_1' })],
        PHONE_BRIDGE_BIN,
      ).browse('');

      const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
      expect(byName['p1']).toMatchObject({
        isDirectory: true,
        bytes: 1500,
        files: 2,
        // One claimed original and one orphan — honestly mixed.
        kind: 'mixed',
      });
      expect(byName['_bin']).toMatchObject({
        kind: 'reserved',
        reservedBy: 'phone-bridge',
        deletableBytes: 0,
      });
      expect(byName['loose.txt']).toMatchObject({
        isDirectory: false,
        kind: 'unowned',
        deletableBytes: 20,
      });
      expect(result.parentPath).toBeNull();
    });

    it('drills into a subdirectory and knows its way back', async () => {
      await tree();
      const result = await build(root, []).browse('p1/2026');

      expect(result.path).toBe('p1/2026');
      expect(result.parentPath).toBe('p1');
      expect(result.entries.map((e) => e.name)).toEqual(['06']);
      expect(result.entries[0].files).toBe(2);
    });

    // A path is a request, not a fact.
    it('normalises a path that tries to climb out', async () => {
      await tree();
      const result = await build(root, []).browse('../../etc');
      expect(result.entries).toEqual([]);
      expect(result.path).toBe('etc');
    });
  });

  describe('deletePaths', () => {
    it('deletes a whole directory selection, file by file', async () => {
      await write(root, 'junk/a.bin', 100);
      await write(root, 'junk/nested/b.bin', 200);

      const result = await build(root, []).deletePaths(['junk']);

      expect(result.deleted).toEqual({ bytes: 300, files: 2 });
      await expect(fsp.stat(join(root, 'junk/a.bin'))).rejects.toThrow();
    });

    // The client sends paths; the server decides what they are. A file claimed
    // between drawing the page and pressing the button must survive.
    it('refuses a claimed file even when explicitly selected', async () => {
      await write(root, 'p1/att_a.jpg', 100);

      const result = await build(root, [
        row({ storagePath: 'p1/att_a.jpg', projectId: 'proj_1' }),
      ]).deletePaths(['p1/att_a.jpg']);

      expect(result.deleted).toEqual({ bytes: 0, files: 0 });
      expect(result.skippedClaimed).toBe(1);
      await expect(fsp.stat(join(root, 'p1/att_a.jpg'))).resolves.toBeDefined();
    });

    it('refuses a plugin-reserved path even when explicitly selected', async () => {
      await write(root, '_bin/cloudflared', 5000);

      const result = await build(root, [], PHONE_BRIDGE_BIN).deletePaths([
        '_bin/cloudflared',
      ]);

      expect(result.skippedReserved).toBe(1);
      await expect(
        fsp.stat(join(root, '_bin/cloudflared')),
      ).resolves.toBeDefined();
    });

    it('cannot be talked into leaving the uploads root', async () => {
      const outside = join(root, '..', 'mk-usage-outside.txt');
      await fsp.writeFile(outside, 'x');
      try {
        const result = await build(root, []).deletePaths([
          '../mk-usage-outside.txt',
          '/etc/passwd',
        ]);
        expect(result.deleted).toEqual({ bytes: 0, files: 0 });
        await expect(fsp.stat(outside)).resolves.toBeDefined();
      } finally {
        await fsp.rm(outside, { force: true });
      }
    });

    it('reports a selection that no longer exists instead of failing', async () => {
      const result = await build(root, []).deletePaths(['gone/file.bin']);
      expect(result.missing).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe('purgeUnreferenced', () => {
    // Backdate a file past the grace period so the sweep may consider it.
    const age = async (path: string, days: number) => {
      const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      await fsp.utimes(join(root, path), when, when);
    };

    it('deletes only what no row claims, leaving claimed files untouched', async () => {
      await write(root, 'p1/att_a.jpg', 1000);
      await write(root, 'p1/att_a.sm.webp', 100);
      await write(root, 'stray/att_orphan.bin', 400);
      await age('p1/att_a.jpg', 3);
      await age('p1/att_a.sm.webp', 3);
      await age('stray/att_orphan.bin', 3);

      const service = build(root, [
        row({
          storagePath: 'p1/att_a.jpg',
          previewSmPath: 'p1/att_a.sm.webp',
          projectId: 'proj_1',
        }),
      ]);
      const result = await service.purgeUnreferenced();

      expect(result.deleted).toEqual({ bytes: 400, files: 1 });
      expect(result.skippedRecent).toBe(0);
      await expect(fsp.stat(join(root, 'p1/att_a.jpg'))).resolves.toBeDefined();
      await expect(
        fsp.stat(join(root, 'p1/att_a.sm.webp')),
      ).resolves.toBeDefined();
      await expect(
        fsp.stat(join(root, 'stray/att_orphan.bin')),
      ).rejects.toThrow();
    });

    // The regression that made this rule exist: an aged cloudflared binary is
    // as unclaimed as an orphan and must survive anyway.
    it('never touches a file the store did not write, however old', async () => {
      await write(root, '_bin/cloudflared', 5000);
      await age('_bin/cloudflared', 30);

      const result = await build(
        root,
        [],
        PHONE_BRIDGE_BIN,
      ).purgeUnreferenced();

      expect(result.deleted).toEqual({ bytes: 0, files: 0 });
      expect(result.skippedRecent).toBe(0);
      await expect(
        fsp.stat(join(root, '_bin/cloudflared')),
      ).resolves.toBeDefined();
    });

    // An upload whose row is not committed yet is indistinguishable from an
    // orphan; deleting it would destroy live data, so recency wins.
    it('keeps files too young to judge, and says how many', async () => {
      await write(root, 'att_fresh.bin', 700);

      const result = await build(root, []).purgeUnreferenced();

      expect(result.deleted).toEqual({ bytes: 0, files: 0 });
      expect(result.skippedRecent).toBe(1);
      await expect(
        fsp.stat(join(root, 'att_fresh.bin')),
      ).resolves.toBeDefined();
    });

    it('reports files it could not remove instead of swallowing the failure', async () => {
      await write(root, 'locked/att_orphan.bin', 200);
      await age('locked/att_orphan.bin', 3);
      await fsp.chmod(join(root, 'locked'), 0o500);

      const result = await build(root, []).purgeUnreferenced();

      // Root ignores directory permissions, so accept either outcome and only
      // assert the two are accounted for exactly once.
      expect(result.failed + result.deleted.files).toBe(1);

      await fsp.chmod(join(root, 'locked'), 0o700);
    });
  });
});
