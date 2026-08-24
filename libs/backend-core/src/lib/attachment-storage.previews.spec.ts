import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { PREWARM_MAX_ATTACHMENTS } from '@makekeeper/plugin-contract';
import { AttachmentStorageService } from './attachment-storage.service';
import { RequestContextService } from './request-context.service';
import { PREVIEW_PROFILE_REVISION } from './image-derivatives';

// Preview behaviour of the storage service (#113), against the real encoder and
// a real temp directory — the parts worth protecting are what actually lands on
// disk and in the row, which a mocked sharp would not exercise.

interface Row {
  id: string;
  storagePath: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
  isImage: boolean | null;
  previewXsPath: string | null;
  previewSmPath: string | null;
  previewLgPath: string | null;
  previewsRevision: number;
  createdAt: Date;
  [key: string]: unknown;
}

// Minimal stand-in for the two rows-and-files collaborators. Structural, so the
// service is exercised through its real API rather than through a mock of it.
const makeDeps = (root: string) => {
  const rows = new Map<string, Row>();
  // Counting writes is how "rendered once" is observable from outside.
  let updates = 0;
  // What `create` was ASKED to write, kept apart from the row it produced: a
  // column default and an explicit stamp of the same value are indistinguishable
  // on the row, and which of the two happened is exactly the question.
  const created: Record<string, unknown>[] = [];
  const prisma = {
    attachment: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        const row = {
          previewXsPath: null,
          previewSmPath: null,
          previewLgPath: null,
          isImage: null,
          filename: null,
          // The column's DB default, so a row that fails to stamp the revision
          // on create looks here exactly as it would in Postgres.
          previewsRevision: 1,
          createdAt: new Date(0),
          ...data,
        } as Row;
        rows.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      // `where` is honoured only as far as the id filter, which is what the
      // prewarm path actually asks of it; the picture predicate is Prisma's job
      // and the service guards it a second time before rendering anyway.
      findMany: (args?: { where?: { id?: { in: string[] } } }) => {
        const ids = args?.where?.id?.in;
        const all = [...rows.values()];
        return Promise.resolve(
          ids ? all.filter((row) => ids.includes(row.id)) : all,
        );
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; previewsRevision?: { lt: number } };
        data: Record<string, unknown>;
      }) => {
        updates++;
        const row = rows.get(where.id);
        // The revision guard is honoured, not ignored: it is the whole reason
        // a second reader of a stale row must not delete anything, so a double
        // that matched unconditionally would report the race as fixed.
        const matches =
          row !== undefined &&
          (where.previewsRevision === undefined ||
            row.previewsRevision < where.previewsRevision.lt);
        if (matches) Object.assign(row, data);
        return Promise.resolve({ count: matches ? 1 : 0 });
      },
      delete: ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return Promise.resolve(null);
      },
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
  };
  const config = { getUploadsRoot: () => root };
  return {
    updateCalls: () => updates,
    created,
    rows,
    prisma,
    config,
  };
};

const image = (width: number, height: number): Promise<Buffer> =>
  sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .jpeg()
    .toBuffer();

const exists = async (path: string): Promise<boolean> =>
  fsp
    .access(path)
    .then(() => true)
    .catch(() => false);

describe('AttachmentStorageService previews', () => {
  let root: string;
  let deps: ReturnType<typeof makeDeps>;
  let service: AttachmentStorageService;

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'mk-previews-'));
    deps = makeDeps(root);
    service = new AttachmentStorageService(
      deps.prisma as never,
      deps.config as never,
      new RequestContextService(),
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  // Put a row on an older profile revision. Throws rather than ageing a
  // throwaway object: `Object.assign(rows.get(id) ?? {}, …)` on a missing row
  // leaves the test green while testing nothing at all.
  const ageRow = (id: string): Row => {
    const row = deps.rows.get(id);
    if (!row) throw new Error(`No stored row for ${id}`);
    row.previewsRevision = PREVIEW_PROFILE_REVISION - 1;
    return row;
  };

  describe('on upload', () => {
    // #115: the renditions written here were made by the CURRENT profile, so
    // the row must say so explicitly. Left to the column default, every upload
    // after a bump would be born stale and have its correct eager renditions
    // thrown away on first read.
    it('stamps the profile revision that made the renditions', async () => {
      await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );

      expect(deps.created.at(-1)?.previewsRevision).toBe(
        PREVIEW_PROFILE_REVISION,
      );
    });

    it('generates the browser renditions and leaves the vision one for later', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
        undefined,
        'IMG_1234.jpg',
      );

      const row = deps.rows.get(id);
      expect(row?.isImage).toBe(true);
      expect(row?.previewXsPath).toBeTruthy();
      expect(row?.previewSmPath).toBeTruthy();
      // Lazily generated: nothing has asked the model to look at it yet.
      expect(row?.previewLgPath).toBeNull();

      const sm = await sharp(join(root, row?.previewSmPath ?? '')).metadata();
      expect(sm.format).toBe('webp');
      expect(sm.width).toBe(640);
    });

    it('leaves a small image alone — it is already its own preview', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(120, 90),
        'image/jpeg',
      );
      const row = deps.rows.get(id);
      expect(row?.isImage).toBe(true);
      expect(row?.previewXsPath).toBeNull();
      expect(row?.previewSmPath).toBeNull();
    });

    it('stores an undecodable upload as a plain file instead of failing', async () => {
      // An HEIC or a corrupt file: the mime claims an image, the bytes do not
      // deliver one. The upload must still succeed.
      const { id, url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        Buffer.from('not really a picture'),
        'image/heic',
        undefined,
        'IMG_0001.heic',
      );

      expect(url).toBe(`/api/uploads/${id}`);
      const row = deps.rows.get(id);
      expect(row?.isImage).toBe(false);
      expect(row?.previewSmPath).toBeNull();
      expect(await exists(join(root, row?.storagePath ?? ''))).toBe(true);
    });

    it('treats SVG as an image without rasterising it', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"></svg>',
      );
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        svg,
        'image/svg+xml',
      );
      const row = deps.rows.get(id);
      expect(row?.isImage).toBe(true);
      expect(row?.previewSmPath).toBeNull();
    });

    it('does not run a decoder over non-image uploads', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        Buffer.from('solid STL data'),
        'model/stl',
        undefined,
        'part.stl',
      );
      expect(deps.rows.get(id)?.isImage).toBe(false);
    });
  });

  describe('serving a variant', () => {
    it('reports a real derivative, with the variant’s own type and name', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(2000, 1000),
        'image/jpeg',
        undefined,
        'фото.jpg',
      );

      const resolved = await service.resolveVariantFile(id, 'sm');
      expect(resolved?.derived).toBe(true);
      expect(resolved?.mimeType).toBe('image/webp');
      // Never the upload's own name: "save as" must not write WebP bytes under
      // a .jpg filename.
      expect(resolved?.filename).toBe(`${id}.webp`);
    });

    it('falls back to the original when the rendition does not exist', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(120, 90),
        'image/jpeg',
        undefined,
        'small.jpg',
      );

      const resolved = await service.resolveVariantFile(id, 'sm');
      // `derived: false` is what keeps the response out of the immutable cache
      // — a fallback can stop being the right answer at any time.
      expect(resolved?.derived).toBe(false);
      expect(resolved?.mimeType).toBe('image/jpeg');
      expect(resolved?.filename).toBe('small.jpg');
    });

    it('returns null for an unknown id', async () => {
      expect(await service.resolveVariantFile('att_nope', 'sm')).toBeNull();
    });

    // The lightbox (#117) asks for `lg`, which upload leaves unmade. Falling
    // back would hand a browser the multi-megabyte original — the very thing
    // previews exist to avoid — so the rendition is produced while it waits.
    it('produces a missing lg rendition instead of serving the original', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
        undefined,
        'IMG_1234.jpg',
      );
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();

      const resolved = await service.resolveVariantFile(id, 'lg');

      expect(resolved?.derived).toBe(true);
      expect(resolved?.mimeType).toBe('image/webp');
      const meta = await sharp(resolved?.path ?? '').metadata();
      expect(meta.width).toBe(2048);
      // Recorded, so the next open is a plain read.
      expect(deps.rows.get(id)?.previewLgPath).toBeTruthy();
    });

    // Two browsers opening the same photo must not both decode a 12 MP JPEG.
    it('renders a missing rendition once for concurrent requests', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const writesBefore = deps.updateCalls();

      const [a, b] = await Promise.all([
        service.resolveVariantFile(id, 'lg'),
        service.resolveVariantFile(id, 'lg'),
      ]);

      expect(a?.path).toBe(b?.path);
      expect(deps.updateCalls() - writesBefore).toBe(1);
    });

    // What #113 left behind: it added the preview columns nullable and never
    // backfilled, so every attachment older than that migration has no
    // rendition AND no `isImage` verdict — the row shape no fixture produced
    // until now. Such a photo was being served full-size into a 200 px tile;
    // the on-demand render is what finally fixes it, and only if `isImage: null`
    // is treated as "probe it" rather than as "not an image".
    it('renders for a pre-#113 row that has no isImage verdict', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
        undefined,
        'legacy.jpg',
      );
      const row = deps.rows.get(id);
      if (row) {
        row.isImage = null;
        row.previewXsPath = null;
        row.previewSmPath = null;
        row.previewLgPath = null;
      }

      const resolved = await service.resolveVariantFile(id, 'sm');

      expect(resolved?.derived).toBe(true);
      const meta = await sharp(resolved?.path ?? '').metadata();
      expect(meta.width).toBe(640);
      expect(deps.rows.get(id)?.previewSmPath).toBeTruthy();
    });

    // The original is handed to the encoder as a path, so an unreadable one now
    // fails at the probe rather than at a read. The outcome must be unchanged:
    // no derivative, and therefore a non-derived (provisionally cached) answer
    // rather than an immutable one.
    it('claims nothing was derived when the original is unreadable', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const row = deps.rows.get(id);
      await fsp.rm(join(root, row?.storagePath ?? ''), { force: true });
      if (row) row.previewLgPath = null;

      const resolved = await service.resolveVariantFile(id, 'lg');
      expect(resolved?.derived).toBe(false);
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();
    });

    // #115: a profile change must reach rows that already have a rendition —
    // the stored path is authoritative, so nothing else ever revisits them.
    it('drops renditions made by an older profile and rebuilds them', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const before = ageRow(id);
      const smPath = join(root, before.previewSmPath ?? '');
      expect(before.previewSmPath).toBeTruthy();
      // The rendition path is deterministic, so "was it rebuilt" is a question
      // about the bytes on disk, not about the name.
      const staleMtime = (await fsp.stat(smPath)).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const resolved = await service.resolveVariantFile(id, 'sm');

      expect(resolved?.derived).toBe(true);
      const after = deps.rows.get(id);
      expect(after?.previewsRevision).toBe(PREVIEW_PROFILE_REVISION);
      expect(after?.previewSmPath).toBeTruthy();
      expect((await fsp.stat(smPath)).mtimeMs).toBeGreaterThan(staleMtime);
    });

    // All three go at once: they were made by the same profile, and a row half
    // on each revision has nowhere honest to record that.
    it('drops every variant, not just the one asked for', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const staleXs = join(root, ageRow(id).previewXsPath ?? '');

      await service.resolveVariantFile(id, 'sm');

      await expect(fsp.stat(staleXs)).rejects.toThrow();
      // Missing again, so the next request for it renders a fresh one.
      expect(deps.rows.get(id)?.previewXsPath).toBeNull();
    });

    // Concurrency, and the reason the invalidation claims the row before it
    // unlinks anything: three tiles of the same photo are requested at once
    // when a gallery opens, and rendition paths are deterministic — a second
    // invalidation would delete bytes the first one had just rebuilt.
    it('invalidates once when several requests hit the same stale row', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      ageRow(id);
      const updatesBefore = deps.updateCalls();

      const served = await Promise.all([
        service.resolveVariantFile(id, 'xs'),
        service.resolveVariantFile(id, 'sm'),
        service.resolveVariantFile(id, 'lg'),
      ]);

      // Every path handed to a caller still exists — the symptom of the race is
      // a served file that was unlinked between rendering and reading it.
      for (const file of served) {
        expect(file?.derived).toBe(true);
        await expect(fsp.stat(file?.path ?? '')).resolves.toBeDefined();
      }
      // One invalidation for the row plus one write per rendition — not one
      // invalidation per request.
      expect(deps.updateCalls() - updatesBefore).toBe(4);
      expect(deps.rows.get(id)?.previewsRevision).toBe(
        PREVIEW_PROFILE_REVISION,
      );
    });

    it('leaves an up-to-date row untouched', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const path = deps.rows.get(id)?.previewSmPath;

      await service.resolveVariantFile(id, 'sm');

      expect(deps.rows.get(id)?.previewSmPath).toBe(path);
      await expect(fsp.stat(join(root, path ?? ''))).resolves.toBeDefined();
    });

    // A source already inside the bound IS the right answer; re-encoding it
    // would cost detail and gain nothing.
    it('still falls back when the original is already small enough', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(800, 600),
        'image/jpeg',
        undefined,
        'small.jpg',
      );

      const resolved = await service.resolveVariantFile(id, 'lg');
      expect(resolved?.derived).toBe(false);
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();
    });
  });

  describe('vision', () => {
    it('generates the large rendition on first use and reuses it after', async () => {
      const { id, url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );

      const first = await service.readForVisionAsBase64(url);
      expect(first?.mimeType).toBe('image/webp');
      const generated = deps.rows.get(id)?.previewLgPath;
      expect(generated).toBeTruthy();

      const meta = await sharp(join(root, generated ?? '')).metadata();
      expect(meta.width).toBe(2048);

      const second = await service.readForVisionAsBase64(url);
      expect(deps.rows.get(id)?.previewLgPath).toBe(generated);
      expect(second?.data).toBe(first?.data);
    });

    // Vision and the lightbox go through one render path, so a chat turn and a
    // browser reaching the same photo together decode it once, not twice.
    it('shares one render with a concurrent browser request', async () => {
      const { id, url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const writesBefore = deps.updateCalls();

      const [vision, browser] = await Promise.all([
        service.readForVisionAsBase64(url),
        service.resolveVariantFile(id, 'lg'),
      ]);

      expect(vision?.mimeType).toBe('image/webp');
      expect(browser?.derived).toBe(true);
      expect(deps.updateCalls() - writesBefore).toBe(1);
    });

    it('passes a source already within the bound through untouched', async () => {
      // A phone-capture frame: shrinking it would lose detail the model can
      // actually use, and the bytes are already small enough to send.
      const { id, url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(2048, 1536),
        'image/jpeg',
      );

      const img = await service.readForVisionAsBase64(url);
      expect(img?.mimeType).toBe('image/jpeg');
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();
    });

    it('never sends a non-image', async () => {
      const { url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        Buffer.from('not really a picture'),
        'image/heic',
      );
      expect(await service.readForVisionAsBase64(url)).toBeNull();
    });

    it('degrades to a smaller rendition instead of the oversized original', async () => {
      const { id, url } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );

      // Simulate the generation failing: the source file is gone, so only the
      // already-derived renditions remain. The full-size original must never be
      // what a provider request falls back to.
      const row = deps.rows.get(id);
      await fsp.rm(join(root, row?.storagePath ?? ''), { force: true });

      const img = await service.readForVisionAsBase64(url);
      expect(img?.mimeType).toBe('image/webp');
      const meta = await sharp(
        Buffer.from(img?.data ?? '', 'base64'),
      ).metadata();
      expect(meta.width).toBe(640); // the sm rendition, not the 4032 px original
    });
  });

  describe('deletion', () => {
    it('takes every rendition with the original', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const row = deps.rows.get(id);
      const paths = [
        row?.storagePath,
        row?.previewXsPath,
        row?.previewSmPath,
      ].map((p) => join(root, p ?? ''));
      for (const path of paths) expect(await exists(path)).toBe(true);

      expect(await service.deleteById(id)).toBe(true);
      for (const path of paths) expect(await exists(path)).toBe(false);
    });

    it('collects every rendition of a scope for the force-delete cascade', async () => {
      await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
        'scope-1',
      );
      const paths = await service.collectScopeFilePaths('scope-1');
      expect(paths).toHaveLength(3); // original + xs + sm
    });
  });
  describe('prewarm (#128)', () => {
    // The point of the ticket: the lightbox's rendition exists BEFORE the first
    // click, without `lg.eager` being flipped — which #117 weighed and refused.
    it('renders the lazy lg rendition ahead of the first request', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();

      const result = await service.prewarmVariants([id], 'lg');

      expect(result).toEqual({
        rendered: 1,
        alreadyWarm: 0,
        withinBound: 0,
        failed: 0,
      });
      const lgPath = deps.rows.get(id)?.previewLgPath;
      expect(lgPath).toBeTruthy();
      expect(await exists(join(root, lgPath ?? ''))).toBe(true);
    });

    it('costs nothing for a rendition that already exists', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      await service.prewarmVariants([id], 'lg');
      const before = deps.updateCalls();

      const again = await service.prewarmVariants([id], 'lg');

      expect(again).toEqual({
        rendered: 0,
        alreadyWarm: 1,
        withinBound: 0,
        failed: 0,
      });
      expect(deps.updateCalls()).toBe(before);
    });

    // The counters exist to be distinguishable: an original small enough to be
    // its own `lg` is "nothing to do", not "rendering broke", and merging the
    // two would make a broken renderer look like a warm gallery.
    it('separates an original that is already within bounds from a failure', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(320, 240),
        'image/jpeg',
      );

      expect(await service.prewarmVariants([id], 'lg')).toEqual({
        rendered: 0,
        alreadyWarm: 0,
        withinBound: 1,
        failed: 0,
      });
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();
    });

    it('renders nothing for a file that is not a picture', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        Buffer.from('solid cube'),
        'model/stl',
        undefined,
        'cube.stl',
      );

      // `rendered` only: the real query drops non-pictures before the loop
      // sees them (PICTURE_ATTACHMENT_WHERE), while this double filters by id
      // alone, so the other counters differ between them. What both must agree
      // on is that no resize happened — which is also the second guard, inside
      // `generateVariantOnDemand`, doing its job.
      expect((await service.prewarmVariants([id], 'lg')).rendered).toBe(0);
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();
    });

    it('ignores ids that resolve to nothing the caller can see', async () => {
      expect(await service.prewarmVariants(['att_nope'], 'lg')).toEqual({
        rendered: 0,
        alreadyWarm: 0,
        withinBound: 0,
        failed: 0,
      });
    });

    // The route's whole shape depends on this: it answers immediately and the
    // encoding happens after. If `schedulePrewarm` ever rendered inline again,
    // the rendition would already be on disk when it returns.
    it('answers before it renders, and renders after', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );

      const accepted = service.schedulePrewarm([id], 'lg');

      expect(accepted).toBe(1);
      expect(deps.rows.get(id)?.previewLgPath).toBeNull();

      await service.flushPrewarmQueue();

      expect(deps.rows.get(id)?.previewLgPath).toBeTruthy();
    });

    it('takes on no more than the shared cap in one batch', async () => {
      const ids = Array.from(
        { length: PREWARM_MAX_ATTACHMENTS + 3 },
        (_, i) => `att_${i}`,
      );

      expect(service.schedulePrewarm(ids, 'lg')).toBe(PREWARM_MAX_ATTACHMENTS);
      expect(service.schedulePrewarm([], 'lg')).toBe(0);
      await service.flushPrewarmQueue();
    });

    // One failing batch must not strand the ones queued behind it — the chain
    // is process-wide, so a single bad id would otherwise stop prewarming for
    // everyone until restart.
    it('keeps the queue alive when a batch throws', async () => {
      const { id } = await service.saveBuffer(
        { pluginId: 'projects', projectId: 'p1' },
        await image(4032, 3024),
        'image/jpeg',
      );
      const findMany = deps.prisma.attachment.findMany;
      deps.prisma.attachment.findMany = () =>
        Promise.reject(new Error('db is down'));

      service.schedulePrewarm(['att_boom'], 'lg');
      await service.flushPrewarmQueue();
      deps.prisma.attachment.findMany = findMany;

      service.schedulePrewarm([id], 'lg');
      await service.flushPrewarmQueue();

      expect(deps.rows.get(id)?.previewLgPath).toBeTruthy();
    });
  });
});
