import { Injectable, Logger } from '@nestjs/common';
import { promises as fsp, createReadStream, type ReadStream } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import {
  isPictureAttachment,
  PICTURE_ATTACHMENT_WHERE,
  PREWARM_MAX_ATTACHMENTS,
  type AttachmentPresence,
  type OwnedPhoto,
  type PreviewVariant,
} from '@makekeeper/plugin-contract';
import { PrismaService } from './prisma.service';
import { AppConfigService } from './app-config.service';
import { RequestContextService } from './request-context.service';
import { generateUuid } from './uuid';
import { getErrorMessage } from './error';
import {
  PREVIEW_PROFILE,
  PREVIEW_PROFILE_REVISION,
  VISION_VARIANT_ORDER,
  eagerVariants,
  isVectorImage,
  probeImage,
  renderPreview,
  shouldGenerate,
} from './image-derivatives';

// Generic, owner-agnostic file storage for uploaded attachments. Files live on
// disk under the uploads root as YYYY/MM/DD/<id>.<ext> — a pure date path,
// carrying nothing about who the file belongs to (see `prepareStoragePath`);
// a DB row maps the opaque id served at /api/uploads/:id to its storage path,
// so the storage backend can change without touching the URL. Rows written
// before that layout keep whatever path they were stored under: the path is
// read from the row, never recomputed.
//
// Attachments are linked to an owner via any of projectId / componentId /
// intakeDraftId (inventory) / sessionId (chat) or bridgeSessionId (phone
// bridge). This is the
// shared pipeline the chat, inventory and phone-bridge consumer plugins reuse —
// none of them imports another.

// Which owner an attachment belongs to.
//
// `pluginId` is REQUIRED and is the answer to "whose bytes are these": the
// plugin whose surface produced the upload. It is declared, never inferred —
// the id columns below are optional links to a specific record, and a surface
// that has none (an inventory photo, referenced by a denormalized URL) used to
// end up attributed to nobody at all in the disk report.
export interface AttachmentOwner {
  pluginId: string;
  projectId?: string | null;
  // The component a photo belongs to (#125). Like the others it is a flat FK,
  // and it exists so an inventory photo HAS a parent: without it the only link
  // was the denormalized `Component.imageUrl` string, which no policy can read.
  componentId?: string | null;
  // The intake draft a shot belongs to (#216): a draft holds several angles of
  // one part, so its frames need a parent of their own until they are adopted
  // by the item the draft becomes.
  intakeDraftId?: string | null;
  sessionId?: string | null;
  bridgeSessionId?: string | null;
  // Idempotency key of the queued write that produced this file (#216). Unlike
  // the fields above it names no parent — it is the ANSWER to "have I stored
  // this exact shot already", for a queue that may be drained twice.
  clientOpId?: string | null;
}

// Every file this store writes is named `<id>.<ext>` (or `<id>.<variant>.<ext>`
// for a rendition), and every id carries this prefix. That makes the prefix the
// signature of "we wrote this" — the basis on which the usage sweep (#120) may
// delete an unclaimed file at all. The uploads root is a writable directory the
// app owns, and other code legitimately keeps things there (the phone-bridge's
// managed cloudflared binary lives in `_bin/`), so "under the root" is NOT the
// same as "ours".
export const ATTACHMENT_ID_PREFIX = 'att_';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// Which row column stores which rendition (#113). Keeping the mapping in one
// place is what lets the rest of the service treat variants as data.
const PREVIEW_COLUMN = {
  xs: 'previewXsPath',
  sm: 'previewSmPath',
  lg: 'previewLgPath',
} as const satisfies Record<PreviewVariant, string>;

type PreviewColumn = (typeof PREVIEW_COLUMN)[PreviewVariant];

// The derivative columns of a row, as written on create.
type PreviewPaths = Partial<Record<PreviewColumn, string>>;

// A stored attachment as this service reads it back. Declared structurally so
// helpers can take either a Prisma row or a test double without a cast.
interface StoredAttachment {
  readonly id: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly filename: string | null;
  readonly sizeBytes: number;
  readonly isImage: boolean | null;
  readonly previewXsPath: string | null;
  readonly previewSmPath: string | null;
  readonly previewLgPath: string | null;
  // Deliberately NOT optional, though it would spare the test doubles a field:
  // the column is NOT NULL, so the only way it can go missing is a `select`
  // that forgets it — and a defaulted read would then quietly report every row
  // as up to date and skip the invalidation entirely. Required, it fails to
  // compile instead.
  readonly previewsRevision: number;
}

// The rendition columns, blanked. Written as one literal because the row update
// and the row this service hands back afterwards must not drift apart.
const CLEARED_PREVIEWS = {
  previewXsPath: null,
  previewSmPath: null,
  previewLgPath: null,
} as const satisfies Record<PreviewColumn, null>;

// Everything that can be said about an attachment WITHOUT opening the file:
// what it is called, what it claims to be, how big it is, whether its bytes
// actually decoded as an image (#113), and which project owns it. This is the
// shape consumers describe an attachment with — to the user in a file chip, to
// the model in a context line (#112).
export interface AttachmentMeta {
  id: string;
  projectId: string | null;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean | null;
}

// The column set behind `AttachmentMeta`, named once so the two finders below
// cannot select different fields for the same declared return type.
const ATTACHMENT_META_SELECT = {
  id: true,
  projectId: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  isImage: true,
} as const;

// Is this window text? Decoded with `fatal: true`, so invalid sequences throw
// instead of silently becoming U+FFFD — a binary STL must come back as "not
// text", not as a page of replacement characters the model would try to read.
// A NUL byte is rejected outright: it is valid UTF-8 and a reliable tell that
// the file is binary.
//
// A window cut mid-character at the tail is the one false negative: it is
// accepted by trimming up to three trailing bytes, which is the longest a
// truncated UTF-8 sequence can be.
function decodeUtf8Strictly(buffer: Buffer): string | null {
  if (buffer.includes(0)) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let trim = 0; trim <= 3 && trim < buffer.length; trim++) {
    try {
      return decoder.decode(
        trim === 0 ? buffer : buffer.subarray(0, buffer.length - trim),
      );
    } catch {
      // Keep shaving the tail: a window may end mid-character.
    }
  }
  return buffer.length === 0 ? '' : null;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');

// Lowercase extension from a filename, sanitised to a safe token; null if none.
function extFromFilename(filename?: string | null): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ext.length > 0 && ext.length <= 12 ? ext : null;
}

// The outcome of an on-demand render. Three states rather than a nullable path
// because "there is nothing to render, the original already fits" is a
// different answer from "rendering failed" — see `generateVariantOnDemand`.
type VariantRender =
  | { status: 'generated'; path: string }
  | { status: 'source-within-bound' }
  | { status: 'unavailable' };

// What one prewarm batch did (#128). One counter per branch rather than a
// rendered/skipped pair: "already warm", "the original is small enough" and
// "the render failed" are three different things, and a single `skipped` that
// merges them cannot tell "nothing to do" from "rendering is broken" — which,
// since the batch is queued and its caller is long gone, is the only signal
// anyone gets.
export interface PrewarmOutcome {
  rendered: number;
  alreadyWarm: number;
  withinBound: number;
  failed: number;
}

// Which column links a picture to the record that owns it. A new owner adds its
// column here and nothing else. `intakeDraftId` has no cover of its own — a
// draft's frames are ordered and unpinned — but it asks the same "which pictures
// are mine, in upload order" question, and a second copy of that query is
// exactly the drift this function exists to prevent.
export type PhotoOwnerField = 'projectId' | 'componentId' | 'intakeDraftId';

// The `select` behind every photo query, named once so the column set and the
// column a row is bucketed by cannot come apart. Every owner column is selected
// rather than one computed key: a computed `select` key types the result as a
// union of shapes, and the only way to read the row back is then a cast (§5.1).
const PHOTO_OWNER_SELECT = {
  id: true,
  projectId: true,
  componentId: true,
  intakeDraftId: true,
} as const satisfies Record<PhotoOwnerField | 'id', true>;

// A record that may pin one of its pictures as the cover.
export interface PhotoOwner {
  id: string;
  coverAttachmentId: string | null;
}

@Injectable()
export class AttachmentStorageService {
  private readonly logger = new Logger(AttachmentStorageService.name);

  // In-flight on-demand renders, keyed `<id>:<variant>` — see
  // `generateVariantOnDemand`.
  private readonly pendingVariants = new Map<string, Promise<VariantRender>>();

  // In-flight stale-preview invalidations, keyed by attachment id — see
  // `refreshIfStale`.
  private readonly pendingInvalidations = new Map<string, Promise<void>>();

  // Tail of the background prewarm chain — see `schedulePrewarm`. A promise
  // rather than a queue object because there is nothing to inspect or cancel:
  // each batch appends itself to the last and the chain ends when the work does.
  private prewarmQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {}

  // WHO uploaded this — attribution, never visibility (#125). Ownership is the
  // scope policy's `scopeId`; this answers "added by" on a file that may well
  // belong to somebody else's scope. Falls back to the explicit owner for the
  // out-of-context writes that pass one (the phone-capture route).
  private uploaderId(scopeOwnerId?: string | null): string | null {
    const rc = this.requestContext.get();
    return rc?.userId ?? rc?.scopeId ?? scopeOwnerId ?? null;
  }

  // Persist raw bytes and record them. Returns the public URL + new id.
  //
  // `scopeOwnerId` explicitly stamps the multiuser scope on the row. Callers
  // running inside a user request context omit it — the scope access policy
  // stamps `scopeId` automatically. It exists for writes that happen OUTSIDE any
  // request scope yet still belong to a user: the phone-capture upload runs on an
  // anonymous public route, so it passes the session's owner here to keep the
  // photo visible to that user's scoped reads. When omitted the key is left off
  // entirely so the policy's stamping is not tripped by an explicit value.
  async saveBuffer(
    owner: AttachmentOwner,
    buffer: Buffer,
    mimeType: string,
    scopeOwnerId?: string | null,
    filename?: string | null,
  ): Promise<{ url: string; id: string }> {
    const id = ATTACHMENT_ID_PREFIX + generateUuid();
    const relPath = await this.prepareStoragePath(id, mimeType, filename);
    await fsp.writeFile(join(this.config.getUploadsRoot(), relPath), buffer);

    const derived = await this.deriveOnIngest(
      buffer,
      relPath,
      id,
      mimeType,
      buffer.length,
    );

    await this.prisma.attachment.create({
      data: {
        id,
        ownerPluginId: owner.pluginId,
        componentId: owner.componentId ?? null,
        intakeDraftId: owner.intakeDraftId ?? null,
        clientOpId: owner.clientOpId ?? null,
        projectId: owner.projectId ?? null,
        sessionId: owner.sessionId ?? null,
        bridgeSessionId: owner.bridgeSessionId ?? null,
        uploadedByUserId: this.uploaderId(scopeOwnerId),
        storagePath: relPath,
        mimeType,
        filename: filename ?? null,
        sizeBytes: buffer.length,
        isImage: derived.isImage,
        ...derived.previews,
        // Stamped here too, not left to the column default: these renditions
        // were just made by the CURRENT profile. A row that says otherwise
        // would have its correct eager previews dropped and re-rendered on
        // first read — every upload, forever, after the first bump.
        previewsRevision: PREVIEW_PROFILE_REVISION,
        // Only pin the scope when a caller supplies one out of request context;
        // otherwise leave the field for the access policy to stamp.
        ...(scopeOwnerId != null ? { scopeId: scopeOwnerId } : {}),
      },
    });

    return { url: `/api/uploads/${id}`, id };
  }

  // Persist a base64 data URL. Returns the public URL, or null if the input is
  // not a valid data URL. See `saveBuffer` for `scopeOwnerId`.
  async saveDataUrl(
    owner: AttachmentOwner,
    dataUrl: string,
    scopeOwnerId?: string | null,
    filename?: string | null,
  ): Promise<string | null> {
    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed) return null;
    const buffer = Buffer.from(parsed.data, 'base64');
    const { url } = await this.saveBuffer(
      owner,
      buffer,
      parsed.mimeType,
      scopeOwnerId,
      filename,
    );
    return url;
  }

  // Resolve an id to an on-disk path + mime + original filename for serving.
  // The path is validated to stay within the uploads root. `filename` falls
  // back to the stored basename (`<id>.<ext>`) so a download always gets a
  // sensible name even for rows saved before filenames were recorded.
  async resolveFile(
    id: string,
  ): Promise<{ path: string; mimeType: string; filename: string } | null> {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) return null;
    const abs = this.safeAbs(att.storagePath);
    if (!abs) return null;
    return {
      path: abs,
      mimeType: att.mimeType,
      filename: att.filename ?? basename(att.storagePath),
    };
  }

  // Resolve an id to the rendition a browser should receive (#113).
  //
  // `derived` tells the caller which of the two it got: a real preview, or the
  // original because none exists. That distinction is not cosmetic — it decides
  // whether the response may be cached immutably. Caching a fallback forever
  // would pin the multi-megabyte original under the preview URL and permanently
  // defeat the point of having previews at all.
  async resolveVariantFile(
    id: string,
    variant: PreviewVariant,
  ): Promise<{
    path: string;
    mimeType: string;
    filename: string;
    derived: boolean;
  } | null> {
    const found = await this.prisma.attachment.findUnique({ where: { id } });
    if (!found) return null;
    const att = await this.refreshIfStale(found);

    const previewPath = att[PREVIEW_COLUMN[variant]];
    if (previewPath) {
      const abs = this.safeAbs(previewPath);
      if (abs) {
        const { extension, mimeType } = PREVIEW_PROFILE[variant];
        return {
          path: abs,
          mimeType,
          // Deliberately the opaque id, not the upload's own name: a browser
          // "save as" must not write WebP bytes under a `.jpg` filename. The
          // real name belongs to the original, which the download path serves.
          filename: `${id}.${extension}`,
          derived: true,
        };
      }
    }

    // Nothing stored for this variant yet. Before falling back to the original,
    // try to produce it — the lightbox (#117) asks for `lg`, which #113 left
    // lazy, and serving the fallback there would hand a browser the very
    // multi-megabyte original that previews exist to avoid.
    const rendered = await this.generateVariantOnDemand(att, variant);
    if (rendered.status === 'generated') {
      const { extension, mimeType } = PREVIEW_PROFILE[variant];
      return {
        path: rendered.path,
        mimeType,
        filename: `${id}.${extension}`,
        derived: true,
      };
    }

    const original = await this.resolveFile(id);
    return original ? { ...original, derived: false } : null;
  }

  // Render a variant for attachments the user is about to be able to open,
  // before they open one (#128).
  //
  // `lg` is deliberately lazy (#117 weighed eager and refused it: two consumers,
  // and disk is the number #120 exists to watch), which leaves exactly one
  // user-visible cost — the first click on a photo pays a 2048 px encode. This
  // is the middle path: only the pictures of a gallery somebody actually opened
  // are warmed, so disk follows browsing rather than the whole archive.
  //
  // Server-side on purpose. The alternative — having the browser fetch every
  // `?variant=lg` URL — warms the same renditions but pulls every one of them
  // over the network to be thrown away, which on a phone is a worse bill than
  // the latency it buys. Here nothing leaves the machine until a tile is
  // clicked.
  //
  // Rendered one at a time, not in parallel: this is background work racing
  // interactive requests for the same cores, and libvips already threads a
  // single resize. Renditions that exist are skipped without touching disk, so
  // a revisited gallery costs one query.
  //
  // Scope-safe by construction: the ids are filtered through the same scoped
  // query every other read uses, so an id the caller cannot see renders nothing
  // and reports nothing.
  async prewarmVariants(
    ids: readonly string[],
    variant: PreviewVariant,
  ): Promise<PrewarmOutcome> {
    const outcome: PrewarmOutcome = {
      rendered: 0,
      alreadyWarm: 0,
      withinBound: 0,
      failed: 0,
    };
    if (ids.length === 0) return outcome;
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: [...ids] }, ...PICTURE_ATTACHMENT_WHERE },
    });
    for (const row of rows) {
      const att = await this.refreshIfStale(row);
      if (att[PREVIEW_COLUMN[variant]]) {
        outcome.alreadyWarm++;
        continue;
      }
      const result = await this.generateVariantOnDemand(att, variant);
      if (result.status === 'generated') outcome.rendered++;
      else if (result.status === 'source-within-bound') outcome.withinBound++;
      else outcome.failed++;
    }
    return outcome;
  }

  // Take a prewarm batch on and return — the rendering outlives the request.
  //
  // Deliberately NOT awaited by the route (#128). A batch is a serial run of
  // resizes at roughly 200 ms each, so awaiting it would hold a connection open
  // for seconds on work whose whole premise is that nobody is waiting for it:
  // the browser never reads the answer, and a reverse proxy would time the
  // request out long before the loop noticed. Detached, the response is
  // immediate and the encoding happens where it belongs — after it.
  //
  // One queue for the whole process, not one per request. `prewarmVariants`
  // being internally serial only orders the pictures WITHIN a batch; two tabs
  // (or two users) on two galleries would still run two loops at once, which is
  // exactly the parallel background load the serial loop exists to avoid.
  // Chaining every batch onto the last makes "one resize at a time" true of the
  // server rather than of a single request.
  //
  // The continuation is registered inside the caller's request context, so the
  // scoped Prisma client it captures is still the caller's when it finally runs
  // — an id the requester could not see stays invisible after the response has
  // gone out. `catch` is what keeps the chain alive: one failed batch must not
  // strand every batch queued behind it.
  schedulePrewarm(ids: readonly string[], variant: PreviewVariant): number {
    const batch = ids.slice(0, PREWARM_MAX_ATTACHMENTS);
    if (batch.length === 0) return 0;
    this.prewarmQueue = this.prewarmQueue.then(async () => {
      try {
        const outcome = await this.prewarmVariants(batch, variant);
        if (outcome.failed > 0) {
          this.logger.warn(
            `Prewarm of ${variant}: ${outcome.failed} of ${batch.length} failed to render`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Prewarm of ${variant} failed: ${getErrorMessage(err)}`,
        );
      }
    });
    return batch.length;
  }

  // Wait for everything queued so far to finish. Exists because "the response
  // came back before the render did" is the property `schedulePrewarm` is FOR,
  // and a test cannot assert it without a way to then wait for the render.
  flushPrewarmQueue(): Promise<void> {
    return this.prewarmQueue;
  }

  // Drop renditions made by an older profile revision (#115).
  //
  // The stored path is authoritative — the on-demand render only fills in what
  // is MISSING — so a profile change (edge, quality, format) would otherwise
  // never reach an existing row. Clearing the paths turns a stale rendition
  // into a missing one, and the machinery that already handles missing does the
  // rest, on the pictures somebody actually opens.
  //
  // All three variants go at once, not just the one asked for: they were made
  // by the same profile, and a row half on each revision has nowhere honest to
  // record that.
  //
  // Concurrent readers of the same stale row share ONE invalidation, and every
  // caller waits for it before being told its renditions are missing. Opening a
  // gallery after a bump asks for xs, sm and lg on the same photo at once;
  // without this, one request could unlink the very file another had just
  // rendered — the rendition paths are deterministic, so the loser's `rm` lands
  // squarely on the winner's fresh bytes.
  private async refreshIfStale(
    att: StoredAttachment,
  ): Promise<StoredAttachment> {
    if (att.previewsRevision >= PREVIEW_PROFILE_REVISION) return att;

    const inFlight = this.pendingInvalidations.get(att.id);
    if (inFlight) {
      await inFlight;
    } else {
      const run = this.dropStalePreviews(att).finally(() => {
        this.pendingInvalidations.delete(att.id);
      });
      this.pendingInvalidations.set(att.id, run);
      await run;
    }

    return {
      ...att,
      ...CLEARED_PREVIEWS,
      previewsRevision: PREVIEW_PROFILE_REVISION,
    };
  }

  // Flip the row first, unlink second — the write is what claims the work.
  //
  // The update is guarded on the revision, so a second PROCESS reading the same
  // stale row updates nothing, deletes nothing, and cannot unlink a rendition
  // this one has already rebuilt. (`pendingInvalidations` covers the same race
  // within one process; the guard is what makes it hold across instances
  // sharing the uploads volume.)
  private async dropStalePreviews(att: StoredAttachment): Promise<void> {
    // Resolved before the update, which is about to blank the columns these
    // paths come from — the order that matters is claim-then-unlink, and
    // reading the row we already hold costs nothing.
    const stale = this.previewAbsPaths(att);
    const from = att.previewsRevision;

    const { count } = await this.prisma.attachment.updateMany({
      where: { id: att.id, previewsRevision: { lt: PREVIEW_PROFILE_REVISION } },
      data: { ...CLEARED_PREVIEWS, previewsRevision: PREVIEW_PROFILE_REVISION },
    });
    if (count === 0) return;

    await Promise.all(stale.map((path) => fsp.rm(path, { force: true })));
    this.logger.log(
      `Dropped ${stale.length} stale renditions of ${att.id} (profile revision ${from} → ${PREVIEW_PROFILE_REVISION}).`,
    );
  }

  // Produce a missing rendition while a request waits on it.
  //
  // `source-within-bound` is deliberately NOT folded into `unavailable`: it says
  // the original is itself the right answer for this variant, and the two
  // callers act on that oppositely — a browser is handed the original as a
  // non-derived (so non-immutable) response, while a vision request sends those
  // very bytes to the provider. Collapsing the two would make one of them wrong.
  //
  // Concurrent requests for the same missing rendition share one render: two
  // browsers opening the same photo at once would otherwise both decode a 12 MP
  // JPEG to write identical bytes to the same path.
  private async generateVariantOnDemand(
    att: StoredAttachment,
    variant: PreviewVariant,
  ): Promise<VariantRender> {
    if (att.isImage === false || isVectorImage(att.mimeType)) {
      return { status: 'unavailable' };
    }

    const key = `${att.id}:${variant}`;
    const inFlight = this.pendingVariants.get(key);
    if (inFlight) return inFlight;

    const run = this.renderMissingVariant(att, variant).finally(() => {
      this.pendingVariants.delete(key);
    });
    this.pendingVariants.set(key, run);
    return run;
  }

  // Renders from the PATH, never from a buffer, and that is the whole point of
  // the method existing separately from the ingest path.
  //
  // Ingest already holds the bytes; this runs while an HTTP request waits, and
  // the requests arrive in bulk: opening a project whose attachments predate the
  // preview columns (#113 added them nullable and never backfilled) asks for one
  // missing rendition per tile at once. `pendingVariants` collapses two viewers
  // of the SAME photo, not thirty different photos, so buffering here would put
  // thirty multi-megabyte originals in the JS heap simultaneously — enough to
  // matter on a container with a few hundred megabytes to its name. Handed a
  // path, libvips streams each one itself and the heap never sees them.
  //
  // A probe failure stays silent on purpose: the guard above already excluded
  // known non-images, but legacy rows carry `isImage: null` and fall back to the
  // mime-prefix guess, so an undecodable HEIC legitimately lands here. Warning
  // would log it again on every request, since nothing gets recorded to stop the
  // next one.
  private async renderMissingVariant(
    att: StoredAttachment,
    variant: PreviewVariant,
  ): Promise<VariantRender> {
    const originalPath = this.safeAbs(att.storagePath);
    if (!originalPath) return { status: 'unavailable' };

    const dimensions = await probeImage(originalPath);
    if (!dimensions) return { status: 'unavailable' };
    if (!shouldGenerate(variant, dimensions, att.sizeBytes)) {
      return { status: 'source-within-bound' };
    }

    const relPath = await this.generateVariant(
      originalPath,
      att.storagePath,
      att.id,
      variant,
    );
    if (!relPath) return { status: 'unavailable' };

    await this.prisma.attachment.updateMany({
      where: { id: att.id },
      data: {
        [PREVIEW_COLUMN[variant]]: relPath,
        previewsRevision: PREVIEW_PROFILE_REVISION,
      },
    });
    const abs = this.safeAbs(relPath);
    return abs ? { status: 'generated', path: abs } : { status: 'unavailable' };
  }

  private async readOriginalBuffer(
    att: StoredAttachment,
  ): Promise<Buffer | null> {
    const originalPath = this.safeAbs(att.storagePath);
    return originalPath ? this.readFileOrNull(originalPath) : null;
  }

  // The rendition a vision request should send to the provider, base64-encoded
  // (providers cannot fetch our URL). Missing renditions are produced through
  // the same on-demand path a browser uses, which is also what keeps a vision
  // request and a lightbox open on the same photo from rendering it twice.
  //
  // Degradation never hands the model an oversized original: a source already
  // within the large preview's bound is passed through as-is (a phone-capture
  // frame is exactly this case), but anything bigger must come back as a
  // derivative or not at all.
  async readForVisionAsBase64(
    publicUrl: string,
  ): Promise<{ mimeType: string; data: string } | null> {
    const id = this.idFromUrl(publicUrl);
    if (!id) return null;
    const found = await this.prisma.attachment.findUnique({ where: { id } });
    if (!found || found.isImage === false) return null;
    // The model must not be handed a rendition made by an older profile either
    // — same check as the serving path (#115).
    const att = await this.refreshIfStale(found);

    // Only the preferred rendition short-circuits. Scanning the whole ladder
    // here would find the browser rendition first and quietly hand the model a
    // 640 px thumbnail — the lazy generation below would then never run.
    const ready = this.existingVariantPath(att, VISION_VARIANT_ORDER[0]);
    if (ready) return this.readVariantFile(ready, VISION_VARIANT_ORDER[0]);

    // A vector is small and self-describing — pass it through rather than
    // rasterising it for the model.
    if (isVectorImage(att.mimeType)) {
      const buffer = await this.readOriginalBuffer(att);
      if (buffer) {
        return { mimeType: att.mimeType, data: buffer.toString('base64') };
      }
    } else {
      const rendered = await this.generateVariantOnDemand(att, 'lg');
      if (rendered.status === 'generated') {
        return this.readVariantFile(rendered.path, 'lg');
      }
      // Already within the bound: send the original as it is. A phone-capture
      // frame lands here, and shrinking it would cost the model real detail.
      // The re-read is the price of sharing one render path with the browser —
      // and it only ever touches a file small enough not to need a preview.
      if (rendered.status === 'source-within-bound') {
        const buffer = await this.readOriginalBuffer(att);
        if (buffer) {
          return { mimeType: att.mimeType, data: buffer.toString('base64') };
        }
      }
    }

    // The rendition could not be produced — unreadable original, undecodable
    // bytes, a failed resize. Walk down to a smaller rendition rather than
    // shipping a full-resolution frame to a provider; if nothing exists, send
    // no image at all.
    const smaller = this.firstExistingVisionVariant(att, 'lg');
    return smaller ? this.readVariantFile(smaller.path, smaller.variant) : null;
  }

  stream(path: string): ReadStream {
    return createReadStream(path);
  }

  // Raw bytes of a stored attachment — the exchange export path (#62). Null
  // when the row or the file is missing (a broken row must not sink a whole
  // archive; the caller logs and moves on).
  async readBytesById(id: string): Promise<Uint8Array | null> {
    const resolved = await this.resolveFile(id);
    if (!resolved) return null;
    try {
      return await fsp.readFile(resolved.path);
    } catch (err) {
      this.logger.warn(`Failed to read attachment ${id}: ${String(err)}`);
      return null;
    }
  }

  // A window of an attachment decoded as UTF-8 text (#112): `maxBytes` starting
  // at `offset`, so the model can page through a long file instead of being
  // handed all of it. Reads exactly the window — a 200 MB log costs one 64 KB
  // read, not 200 MB of memory.
  //
  // `text` is null when the window does not decode as UTF-8. That verdict is
  // deliberately made here rather than guessed from the mime type or the
  // extension: an `.stl` may be ASCII or binary, and only the bytes know.
  async readTextWindow(
    id: string,
    offset: number,
    maxBytes: number,
  ): Promise<{
    text: string | null;
    bytesRead: number;
    sizeBytes: number;
  } | null> {
    const resolved = await this.resolveFile(id);
    if (!resolved) return null;
    let handle: fsp.FileHandle | null = null;
    try {
      const stat = await fsp.stat(resolved.path);
      const start = Math.max(0, Math.trunc(offset));
      const length = Math.max(
        0,
        Math.min(maxBytes, Math.max(0, stat.size - start)),
      );
      const buffer = Buffer.alloc(length);
      if (length > 0) {
        handle = await fsp.open(resolved.path, 'r');
        await handle.read(buffer, 0, length, start);
      }
      return {
        text: decodeUtf8Strictly(buffer),
        bytesRead: length,
        sizeBytes: stat.size,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to read attachment ${id} as text: ${getErrorMessage(err)}`,
      );
      return null;
    } finally {
      await handle?.close();
    }
  }

  // Streaming twin of `readBytesById`: the on-disk location of an attachment
  // that verifiably exists, so the exchange export can stream it into the
  // archive instead of buffering it. Null when the row or file is missing.
  async resolveExistingFile(
    id: string,
  ): Promise<{ path: string; mimeType: string; sizeBytes: number } | null> {
    const resolved = await this.resolveFile(id);
    if (!resolved) return null;
    try {
      const stat = await fsp.stat(resolved.path);
      return {
        path: resolved.path,
        mimeType: resolved.mimeType,
        sizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  }

  // Disk half of an exchange import (#62): place imported bytes into the
  // canonical uploads layout and return the relative storagePath. The DB row
  // is deliberately NOT created here — the importing provider writes it
  // through its transaction client, so a rolled-back import leaves no row
  // (the orphaned file is harmless and unreachable without one).
  async writeBytesForImport(
    id: string,
    mimeType: string,
    filename: string | null,
    bytes: Uint8Array,
  ): Promise<string> {
    const relPath = await this.prepareStoragePath(id, mimeType, filename);
    await fsp.writeFile(join(this.config.getUploadsRoot(), relPath), bytes);
    return relPath;
  }

  // Streaming twin of `writeBytesForImport`: kernel-copies an extracted
  // archive file into the canonical uploads layout — no byte ever transits
  // the JS heap. Same no-DB-row contract as the byte variant, so the derived
  // columns come back for the caller to store inside its own transaction.
  //
  // Archives carry originals only: a derivative is a cache, not data, so it is
  // regenerated here rather than shipped. That also means an import lands with
  // whatever profile *this* instance runs, instead of freezing the exporter's.
  async importFileFromPath(
    id: string,
    mimeType: string,
    filename: string | null,
    srcPath: string,
  ): Promise<{
    relPath: string;
    sizeBytes: number;
    isImage: boolean;
    previews: PreviewPaths;
  }> {
    const relPath = await this.prepareStoragePath(id, mimeType, filename);
    const target = join(this.config.getUploadsRoot(), relPath);
    await fsp.copyFile(srcPath, target);
    const stat = await fsp.stat(target);
    // Derived from the file on disk, not from a buffer — the point of this
    // method is that a large original never enters the heap.
    const derived = await this.deriveOnIngest(
      target,
      relPath,
      id,
      mimeType,
      stat.size,
    );
    return {
      relPath,
      sizeBytes: stat.size,
      isImage: derived.isImage,
      previews: derived.previews,
    };
  }

  // Where a rendition lives: beside its original, same id, variant in the
  // suffix. Derived from the original's own path rather than recomputed from
  // today's date, so a derivative generated later still lands next to the file
  // it came from.
  private previewRelPath(
    originalRelPath: string,
    id: string,
    variant: PreviewVariant,
  ): string {
    const { extension } = PREVIEW_PROFILE[variant];
    return join(dirname(originalRelPath), `${id}.${variant}.${extension}`);
  }

  // Render one rendition and put it on disk. Returns its relative path, or null
  // if anything went wrong — a failed derivative must never fail the operation
  // that triggered it. The original is already stored and the serving route
  // falls back to it, so the worst case is a heavy preview, not a lost upload.
  private async generateVariant(
    source: Buffer | string,
    originalRelPath: string,
    id: string,
    variant: PreviewVariant,
  ): Promise<string | null> {
    const relPath = this.previewRelPath(originalRelPath, id, variant);
    try {
      const bytes = await renderPreview(source, variant);
      await fsp.writeFile(join(this.config.getUploadsRoot(), relPath), bytes);
      return relPath;
    } catch (err) {
      this.logger.warn(
        `Failed to generate ${variant} preview for ${id}: ${getErrorMessage(err)}`,
      );
      return null;
    }
  }

  // Decide what an incoming file *is*, and produce the renditions a browser
  // will ask for. Runs on every ingest path (upload and exchange import) so the
  // two cannot drift apart.
  private async deriveOnIngest(
    source: Buffer | string,
    relPath: string,
    id: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<{ isImage: boolean; previews: PreviewPaths }> {
    // A mime that does not claim to be an image is taken at its word — there is
    // no point running a decoder over every archive and 3D model. A mime that
    // does claim it still has to prove it below.
    if (!mimeType.startsWith('image/')) {
      return { isImage: false, previews: {} };
    }
    if (isVectorImage(mimeType)) return { isImage: true, previews: {} };

    const dimensions = await probeImage(source);
    if (!dimensions) return { isImage: false, previews: {} };

    const previews: PreviewPaths = {};
    for (const variant of eagerVariants()) {
      if (!shouldGenerate(variant, dimensions, sizeBytes)) continue;
      const generated = await this.generateVariant(
        source,
        relPath,
        id,
        variant,
      );
      if (generated) previews[PREVIEW_COLUMN[variant]] = generated;
    }
    return { isImage: true, previews };
  }

  // On-disk path of one rendition, if it exists.
  private existingVariantPath(
    att: StoredAttachment,
    variant: PreviewVariant,
  ): string | null {
    const relPath = att[PREVIEW_COLUMN[variant]];
    return relPath ? this.safeAbs(relPath) : null;
  }

  // Best rendition the model can be given *without* generating one — the
  // degradation ladder, walked only after generation has failed. `skip` drops
  // the rendition that just failed to appear.
  private firstExistingVisionVariant(
    att: StoredAttachment,
    skip?: PreviewVariant,
  ): { variant: PreviewVariant; path: string } | null {
    for (const variant of VISION_VARIANT_ORDER) {
      if (variant === skip) continue;
      const abs = this.existingVariantPath(att, variant);
      if (abs) return { variant, path: abs };
    }
    return null;
  }

  private async readVariantFile(
    absPath: string,
    variant: PreviewVariant,
  ): Promise<{ mimeType: string; data: string } | null> {
    const buffer = await this.readFileOrNull(absPath);
    if (!buffer) return null;
    return {
      mimeType: PREVIEW_PROFILE[variant].mimeType,
      data: buffer.toString('base64'),
    };
  }

  private async readFileOrNull(absPath: string): Promise<Buffer | null> {
    try {
      return await fsp.readFile(absPath);
    } catch (err) {
      this.logger.warn(`Failed to read ${absPath}: ${getErrorMessage(err)}`);
      return null;
    }
  }

  // Absolute paths of every rendition of a row — the deletion paths that must
  // travel with the original so a removed attachment leaves nothing behind.
  private previewAbsPaths(att: StoredAttachment): string[] {
    return (Object.keys(PREVIEW_COLUMN) as PreviewVariant[])
      .map((variant) => att[PREVIEW_COLUMN[variant]])
      .filter((relPath): relPath is string => relPath !== null)
      .map((relPath) => this.safeAbs(relPath))
      .filter((abs): abs is string => abs !== null);
  }

  // The one storage-layout rule: `<baseDir>/YYYY/MM/DD/<id>.<ext>` under the
  // uploads root, directory pre-created. Extension prefers the original
  // filename (arbitrary files: stl, zip, gcode…), then the known image map,
  // then a generic binary suffix.
  // Where a newly stored file lands under the uploads root: a pure date path,
  // `YYYY/MM/DD/<id>.<ext>`.
  //
  // Deliberately NOT keyed on the owner. Ownership moves — a capture photo
  // claimed into a chat, a file re-parented into a project (#125) — so a path
  // that encoded it would either start lying or force a file move on every
  // re-home. The row already answers "whose is this"; the path only has to be
  // unique, stable and cheap to shard. Being owner-free it is also a valid
  // object-store key as-is, so an S3-backed variant can reuse it verbatim.
  private async prepareStoragePath(
    id: string,
    mimeType: string,
    filename?: string | null,
  ): Promise<string> {
    const now = new Date();
    const relDir = join(
      String(now.getFullYear()),
      pad2(now.getMonth() + 1),
      pad2(now.getDate()),
    );
    const ext = extFromFilename(filename) ?? EXT_BY_MIME[mimeType] ?? 'bin';
    await fsp.mkdir(join(this.config.getUploadsRoot(), relDir), {
      recursive: true,
    });
    return join(relDir, `${id}.${ext}`);
  }

  // Identity of several attachments at once, keyed by the public URL they were
  // asked for (#112). Metadata only — the bytes are never touched, which is the
  // whole point: describing a 200 MB STL to the model must not read it, and the
  // filename is what makes an extension-based rule possible at all (a file from
  // the Files tab arrives as octet-stream).
  // Nullish entries are accepted and skipped, and the list is de-duplicated
  // here: every caller feeds this a column of message rows where the URL is
  // optional (`imageData`), and each one filtering and de-duplicating by hand
  // was three chances to get it wrong — one of them by asserting the column
  // non-null with a cast.
  async findMetaByUrls(
    publicUrls: readonly (string | null | undefined)[],
  ): Promise<Map<string, AttachmentMeta>> {
    const byId = new Map<string, string>();
    for (const url of publicUrls) {
      if (!url) continue;
      const id = this.idFromUrl(url);
      if (id) byId.set(id, url);
    }
    if (byId.size === 0) return new Map();
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: [...byId.keys()] } },
      select: ATTACHMENT_META_SELECT,
    });
    const out = new Map<string, AttachmentMeta>();
    for (const row of rows) {
      const url = byId.get(row.id);
      if (url) out.set(url, row);
    }
    return out;
  }

  // The same lookup, made TOTAL over the URLs asked for (#127): every stored
  // attachment URL comes back with a verdict, so a consumer can tell "gone"
  // from "not loaded yet". `findMetaByUrls` cannot answer that — it reports
  // what it found and stays silent about the rest.
  //
  // Missing covers both halves of gone: no row, and a row whose bytes are not
  // on disk (a restored dump, the orphan sweep of #120, a manual removal). The
  // row is not proof the file survived, and the disk check is what the reported
  // bug actually needs — one `access` per referenced attachment, on a payload
  // that is already a per-session history load, not a listing.
  //
  // URLs that name no attachment at all (a `data:` URL from a legacy message)
  // are skipped rather than reported missing: they are not stored files, and
  // they render from their own bytes.
  async findPresenceByUrls(
    publicUrls: readonly (string | null | undefined)[],
  ): Promise<AttachmentPresence[]> {
    const byId = new Map<string, string>();
    for (const url of publicUrls) {
      if (!url) continue;
      const id = this.idFromUrl(url);
      if (id) byId.set(id, url);
    }
    if (byId.size === 0) return [];
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: [...byId.keys()] } },
      select: { ...ATTACHMENT_META_SELECT, storagePath: true },
    });
    const byRowId = new Map(rows.map((row) => [row.id, row]));
    const out: AttachmentPresence[] = [];
    for (const [id, url] of byId) {
      const row = byRowId.get(id);
      if (!row) {
        out.push({ status: 'missing', url, filename: null });
        continue;
      }
      if (!(await this.storedFileExists(row.storagePath))) {
        out.push({ status: 'missing', url, filename: row.filename });
        continue;
      }
      out.push({
        status: 'available',
        url,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        isImage: isPictureAttachment(row),
      });
    }
    return out;
  }

  // Are the bytes of this row still there? A path that escapes the uploads root
  // (`safeAbs` returns null) counts as absent — unreadable is unreadable, and
  // the caller's question is whether it can be served.
  private async storedFileExists(relPath: string): Promise<boolean> {
    const abs = this.safeAbs(relPath);
    if (!abs) return false;
    try {
      await fsp.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  // Single-attachment twin of `findMetaByUrls`, by id.
  async findMetaById(id: string): Promise<AttachmentMeta | null> {
    return this.prisma.attachment.findUnique({
      where: { id },
      select: ATTACHMENT_META_SELECT,
    });
  }

  // Look up an attachment's identity by its public URL (used right after a save
  // to report the created photo). Returns null if it doesn't resolve.
  async findByUrl(publicUrl: string): Promise<{
    id: string;
    createdAt: Date;
    mimeType: string;
    sizeBytes: number;
    isImage: boolean | null;
  } | null> {
    const id = this.idFromUrl(publicUrl);
    if (!id) return null;
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    return att
      ? {
          id: att.id,
          createdAt: att.createdAt,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          isImage: att.isImage,
        }
      : null;
  }

  // Which of these public URLs point at an attachment the CALLER may read.
  //
  // A denormalized URL column (`Component.imageUrl`) is a plain string: it
  // outlives the reader's right to the bytes, because the row carrying it can
  // be shared scope data while the attachment stays private to its creator.
  // While `/api/uploads/:id` was public that mismatch was invisible — the
  // browser fetched the picture with no credential at all. Now that the route
  // authenticates (#123), a caller who cannot read the attachment would get a
  // broken <img>, so the surfaces that hand out such URLs filter them here
  // instead. One grouped, scope-filtered query — never an N+1 probe.
  async readableUrls(urls: readonly string[]): Promise<Set<string>> {
    const idByUrl = new Map<string, string>();
    for (const url of urls) {
      const id = this.idFromUrl(url);
      if (id) idByUrl.set(url, id);
    }
    if (idByUrl.size === 0) return new Set<string>();
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: [...new Set(idByUrl.values())] } },
      select: { id: true },
    });
    const readableIds = new Set(rows.map((row) => row.id));
    const readable = new Set<string>();
    for (const [url, id] of idByUrl) {
      if (readableIds.has(id)) readable.add(url);
    }
    return readable;
  }

  // The pictures of a batch of owning records, in upload order, with the cover
  // already decided (#213).
  //
  // Lifted here out of `projects.service.ts`, where it answered the same
  // question for projects alone: inventory items now carry a set of photographs
  // under the same rules, and a second copy of "the pin if it still resolves,
  // else the first picture" is exactly the drift this repo has paid for before.
  // The picture test is the shared one (#122), so what may be pinned, what is
  // painted and what is listed are one decision.
  //
  // Readability (#123) needs no separate pass: the query runs on the caller's
  // scoped Prisma client, so a picture the caller may not read is simply not in
  // the result — unlike a denormalized URL column, which is a string that
  // outlives the right to fetch it.
  //
  // `id` breaks ties on `createdAt`: several frames of one item can land inside
  // the same millisecond (the phone uploads a burst), and an unstable order
  // would move the fallback cover between two reads of the same row.
  async photosByOwner(
    owners: readonly PhotoOwner[],
    ownerField: PhotoOwnerField,
  ): Promise<Map<string, OwnedPhoto[]>> {
    const out = new Map<string, OwnedPhoto[]>();
    const ids = owners.map((owner) => owner.id);
    if (ids.length === 0) return out;
    const rows = await this.prisma.attachment.findMany({
      where: {
        // The owner column as DATA. A new owner adds itself to
        // `PhotoOwnerField` and nothing here has to be edited — the ternary
        // this replaced had to be, and silently answered "intake draft" for
        // anything it did not recognise.
        [ownerField]: { in: ids },
        ...PICTURE_ATTACHMENT_WHERE,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: PHOTO_OWNER_SELECT,
    });
    const idsByOwner = new Map<string, string[]>();
    for (const row of rows) {
      const ownerId = row[ownerField];
      if (ownerId === null) continue;
      const list = idsByOwner.get(ownerId) ?? [];
      list.push(row.id);
      idsByOwner.set(ownerId, list);
    }
    for (const owner of owners) {
      const photoIds = idsByOwner.get(owner.id);
      if (!photoIds || photoIds.length === 0) {
        out.set(owner.id, []);
        continue;
      }
      // A pin that is not in the list means the attachment is gone — the silent
      // fall back to the earliest picture is deliberate (#122).
      const coverId =
        owner.coverAttachmentId && photoIds.includes(owner.coverAttachmentId)
          ? owner.coverAttachmentId
          : photoIds[0];
      out.set(
        owner.id,
        photoIds.map((id) => ({
          id,
          url: `/api/uploads/${id}`,
          isCover: id === coverId,
        })),
      );
    }
    return out;
  }

  // Just the cover URL per owner, for the surfaces that show one picture. Owners
  // with no picture at all are absent from the map.
  async coverUrlByOwner(
    owners: readonly PhotoOwner[],
    ownerField: PhotoOwnerField,
  ): Promise<Map<string, string>> {
    const photos = await this.photosByOwner(owners, ownerField);
    const cover = new Map<string, string>();
    for (const [ownerId, list] of photos) {
      const chosen = list.find((photo) => photo.isCover);
      if (chosen) cover.set(ownerId, chosen.url);
    }
    return cover;
  }

  // Re-assign an already-stored attachment (referenced by its public URL) to a
  // new owner. Used when a phone-capture photo is claimed into a real target
  // (e.g. a chat message): clearing bridgeSessionId protects it from the
  // phone-bridge TTL garbage-collector. No-op if the URL/id doesn't resolve.
  async claim(publicUrl: string, owner: AttachmentOwner): Promise<void> {
    const id = this.idFromUrl(publicUrl);
    if (!id) return;
    await this.prisma.attachment.updateMany({
      where: { id },
      data: {
        // Claiming moves the file to the claimant's surface, ownership
        // declaration included: a capture photo pulled into a chat message is
        // the chat's disk cost from then on, not the capture's.
        ownerPluginId: owner.pluginId,
        // EVERY parent is restated, including the ones being cleared — a claim
        // re-homes the row (a photo pulled into a project becomes the
        // project's, #125), and the scope policy recomputes `scopeId` from the
        // full set. Naming only some of them is refused rather than guessed.
        projectId: owner.projectId ?? null,
        componentId: owner.componentId ?? null,
        intakeDraftId: owner.intakeDraftId ?? null,
        sessionId: owner.sessionId ?? null,
        bridgeSessionId: owner.bridgeSessionId ?? null,
      },
    });
  }

  // The absolute on-disk paths of every attachment in a scope. The force-delete
  // cascade removes the rows inside its own transaction, so the caller collects
  // the paths first and calls `removeFiles` only after the transaction commits —
  // a failed delete never leaves rows pointing at already-removed files.
  async collectScopeFilePaths(scopeId: string): Promise<string[]> {
    const rows = await this.prisma.attachment.findMany({ where: { scopeId } });
    return rows.flatMap((a) => this.allFilePaths(a));
  }

  // Every file a row owns: the original plus each rendition (#113). Deletion
  // goes through this so a removed attachment never leaves orphaned previews
  // behind. Paths come from the row, never from a filename mask — a mask would
  // also sweep up whatever else happened to share the prefix.
  private allFilePaths(att: StoredAttachment): string[] {
    const original = this.safeAbs(att.storagePath);
    return [...(original ? [original] : []), ...this.previewAbsPaths(att)];
  }

  async removeFiles(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => fsp.rm(path, { force: true })));
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.deleteWhere({ sessionId });
  }

  async deleteByBridgeSession(bridgeSessionId: string): Promise<void> {
    await this.deleteWhere({ bridgeSessionId });
  }

  // Delete a single attachment (file + row) by id. Returns false if it doesn't
  // resolve. Ownership is enforced upstream: the scoped Prisma client only sees
  // the caller's own rows, so a foreign id reads back as missing.
  async deleteById(id: string): Promise<boolean> {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) return false;
    await this.removeFiles(this.allFilePaths(att));
    await this.prisma.attachment.delete({ where: { id } });
    return true;
  }

  // Delete the files + rows matching an owner filter (used by explicit session
  // cleanup and by phone-bridge TTL garbage-collection).
  private async deleteWhere(
    where: { sessionId: string } | { bridgeSessionId: string },
  ): Promise<void> {
    const rows = await this.prisma.attachment.findMany({ where });
    await this.removeFiles(rows.flatMap((a) => this.allFilePaths(a)));
    await this.prisma.attachment.deleteMany({ where });
  }

  private safeAbs(storagePath: string): string | null {
    const root = this.config.getUploadsRoot();
    const abs = resolve(root, storagePath);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return abs;
  }

  private idFromUrl(url: string): string | null {
    const match = /\/api\/uploads\/([^/?#]+)$/.exec(url);
    return match ? match[1] : null;
  }

  private parseDataUrl(
    dataUrl: string,
  ): { mimeType: string; data: string } | null {
    // [\s\S] instead of the /s (dotAll) flag — the backend's test tsconfig
    // targets pre-ES2018, where that flag is unavailable.
    const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1], data: match[2] };
  }
}
