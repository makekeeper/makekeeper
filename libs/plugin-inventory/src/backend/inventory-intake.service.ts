import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  RequestContextService,
  AttachmentStorageService,
  escapeHtmlText,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import { InventoryService } from './inventory.service';
import { InventoryRecognitionService } from './inventory-recognition.service';
import { InventoryCategoriesService } from './categories.service';
import type { InventoryIntakeDraft } from '@prisma/client';
import type { IntakeDraft, IntakeDraftStatus } from '../mobile-intake';
import { coercePropertyValue, type PropertyValueInput } from '../categories';
import { MAX_ITEM_PHOTOS } from '../photos';

// The statuses a draft may hold, as VALUES — Prisma types the column as a plain
// string, so this is the one place that turns it back into the union rather
// than asserting it (§5.1).
const DRAFT_STATUSES: readonly IntakeDraftStatus[] = [
  'recognizing',
  'ready',
  'failed',
];

const isDraftStatus = (value: string): value is IntakeDraftStatus =>
  DRAFT_STATUSES.includes(value as IntakeDraftStatus);

// A row whose status is anything else was written by a version that knew
// something we do not; treating it as ready is the outcome a human can act on.
const toStatus = (value: string): IntakeDraftStatus =>
  isDraftStatus(value) ? value : 'ready';

// The draft's guessed property values, stored as JSON because the component
// they belong to does not exist yet (#206). Unreadable JSON reads as "no
// values": it is a scratchpad, and a draft that cannot be opened is worse than
// one that lost a guess.
const parseValues = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' || typeof value === 'number') {
        values[key] = String(value);
      }
    }
    return values;
  } catch {
    return {};
  }
};

// One shot as the phone sends it: the bytes, what the person could tell from
// where they stand, and the two keys the offline queue needs — `clientOpId` for
// this frame, `clientDraftId` for the item it belongs to (#216). Named once
// because `capture` and the draft it resolves read the same fields, and the two
// drifting apart is how a key stops being written.
interface CaptureInput {
  imageDataUrl?: string;
  quantity?: number;
  storageId?: string;
  storageRow?: number;
  storageCol?: number;
  clientOpId?: string;
  clientDraftId?: string;
}

// The intake conveyor (#201).
//
// Shooting and recognizing are deliberately unhooked from each other. A model
// round-trip is seconds; a person entering a hundred parts measures the job in
// seconds per part. So the phone posts a photo, gets a draft id back
// immediately, and moves to the next shelf position. The human confirms the
// batch afterwards, seeing every field before anything is written — which is the
// same guarantee the #72 provenance rule is after, reached by never letting the
// model write in the first place.
//
// Recognition is ASKED FOR, per shot, on the batch screen. Firing it
// automatically for every photograph spends a model call — someone's money — on
// dozens of parts a person could name at a glance, and does it before they have
// said they want it.
@Injectable()
export class InventoryIntakeService {
  private readonly logger = new Logger(InventoryIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly requestContext: RequestContextService,
    private readonly inventory: InventoryService,
    private readonly recognition: InventoryRecognitionService,
    private readonly categories: InventoryCategoriesService,
    private readonly attachments: AttachmentStorageService,
  ) {}

  // One shot from the conveyor. Returns as soon as the photo is stored: the
  // caller is standing at a shelf, not waiting on a language model.
  //
  // A shot no longer means a draft (#216). Several frames of one part carry the
  // same phone-minted `clientDraftId`, and this appends to the draft holding
  // that key or creates it. That is what makes multi-frame capture work
  // OFFLINE: the queue cannot learn a server id, and a client-side key needs no
  // answer. `clientOpId` keeps its own job — idempotency of a single frame.
  async capture(input: CaptureInput, locale?: string): Promise<IntakeDraft> {
    // A shot queued offline (#202) carries a key. Draining twice — the normal
    // outcome of a request that timed out — must not turn one photograph into
    // two, so an already-known key answers with the draft it landed in.
    if (input.clientOpId) {
      const existing = await this.prisma.inventoryIntakeDraft.findUnique({
        where: { clientOpId: input.clientOpId },
      });
      if (existing) return this.publish(existing);
      const replayed = await this.prisma.attachment.findUnique({
        where: { clientOpId: input.clientOpId },
        select: { intakeDraftId: true },
      });
      if (replayed?.intakeDraftId) {
        const draft = await this.prisma.inventoryIntakeDraft.findUnique({
          where: { id: replayed.intakeDraftId },
        });
        if (draft) return this.publish(draft);
      }
    }

    const draft = await this.resolveCaptureTarget(input);

    if (input.imageDataUrl) {
      const frames = await this.prisma.attachment.count({
        where: { intakeDraftId: draft.id },
      });
      // The cap is enforced here as well as on the phone: a queue drained after
      // an app reload can still carry more frames than the screen would let
      // through.
      //
      // REFUSED, not silently dropped. Storing nothing and answering 200 tells
      // the phone a frame landed that did not — and the phone believes it: the
      // strip paints it, the queue forgets the op, and the picture is gone with
      // nobody the wiser. A 4xx is what the offline queue is built to show, so
      // the frame surfaces as a failed op carrying this reason (#212 review).
      //
      // A replay never reaches here: an already-known `clientOpId` answers with
      // its draft above, so re-draining an accepted frame stays idempotent
      // rather than being rejected as the sixth.
      if (frames >= MAX_ITEM_PHOTOS) {
        throw new BadRequestException(
          this.i18n.t(
            'inventory.errors.draftFramesFull',
            { max: MAX_ITEM_PHOTOS },
            locale,
          ),
        );
      }
      await this.recognition.storeFrame(
        draft.id,
        input.imageDataUrl,
        input.clientOpId ?? null,
        locale,
      );
    }

    return this.publish(draft);
  }

  // The draft this frame belongs to: the one already carrying the phone's
  // `clientDraftId`, or a new one. Without a key every frame is its own item,
  // which is exactly what the conveyor did before #216.
  private async resolveCaptureTarget(
    input: CaptureInput,
  ): Promise<InventoryIntakeDraft> {
    if (input.clientDraftId) {
      const existing = await this.prisma.inventoryIntakeDraft.findUnique({
        where: { clientDraftId: input.clientDraftId },
      });
      if (existing) return this.applyCaptureFields(existing, input);
    }
    try {
      return await this.prisma.inventoryIntakeDraft.create({
        data: {
          id: generateUuid(),
          scopeId: this.requestContext.get()?.scopeId ?? null,
          // Born ready for a human. Recognition is NOT fired here on purpose: a
          // conveyor run is dozens of shots, most of which the person can name
          // at a glance, and spending a model call on every one of them is
          // spending someone's money on an answer they did not ask for. The
          // batch screen offers it per draft instead.
          status: 'ready',
          quantity: Math.max(1, Math.round(input.quantity ?? 1)),
          storageId: input.storageId ?? null,
          storageRow: input.storageRow ?? null,
          storageCol: input.storageCol ?? null,
          clientOpId: input.clientOpId ?? null,
          clientDraftId: input.clientDraftId ?? null,
        },
      });
    } catch (err) {
      // Two frames of one burst can reach `create` together and lose the race
      // on the unique key. The loser reads the winner's draft rather than
      // failing the shot — a photograph the person already took must not be
      // rejected because it arrived a millisecond late.
      if (!input.clientDraftId) throw err;
      const winner = await this.prisma.inventoryIntakeDraft.findUnique({
        where: { clientDraftId: input.clientDraftId },
      });
      if (!winner) throw err;
      return winner;
    }
  }

  // What the person could tell from where they stand, carried by EVERY frame —
  // not just the one that happened to open the draft (#212 review).
  //
  // Quantity and storage belong to the item being shot, and the phone keeps
  // them on screen while it is shot: moving to the next shelf and then taking a
  // second angle used to leave the new cell on the phone and the old one in the
  // draft, with nothing on either end saying so. The frame that carries a value
  // is the person's latest word on it, so it wins.
  //
  // Only fields the frame actually carries are written; an absent one leaves
  // the draft's value alone rather than resetting it. The one ordering this
  // gives up on is a draft edited on the batch screen while its own frames are
  // still queued — a late frame then restores what the person had on the camera
  // screen. That is the same shelf they were standing at, and the alternative
  // (frames that can never correct a draft) is the bug being fixed.
  private async applyCaptureFields(
    draft: InventoryIntakeDraft,
    input: CaptureInput,
  ): Promise<InventoryIntakeDraft> {
    const data = {
      ...(input.quantity !== undefined
        ? { quantity: Math.max(1, Math.round(input.quantity)) }
        : {}),
      ...(input.storageId !== undefined ? { storageId: input.storageId } : {}),
      ...(input.storageRow !== undefined
        ? { storageRow: input.storageRow }
        : {}),
      ...(input.storageCol !== undefined
        ? { storageCol: input.storageCol }
        : {}),
    };
    if (Object.keys(data).length === 0) return draft;
    return this.prisma.inventoryIntakeDraft.update({
      where: { id: draft.id },
      data,
    });
  }

  // The stored frames of a draft, in upload order — the set recognition sends
  // and the set the commit hands to the item.
  private async draftFrames(draftId: string): Promise<string[]> {
    return (await this.framesByDraft([draftId])).get(draftId) ?? [];
  }

  // The same, for a whole batch — the drafts list is a screenful of items and
  // must not turn into one query per row.
  //
  // Delegates to the shared resolver so a draft's frames are found by the same
  // query an item's photographs are: same picture filter (#122), same
  // `createdAt` then `id` order (the tie a burst of frames produces). A draft
  // pins nothing, so every entry comes back with `coverAttachmentId: null` and
  // the order alone decides which frame leads.
  private async framesByDraft(
    draftIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const byDraft = await this.attachments.photosByOwner(
      draftIds.map((id) => ({ id, coverAttachmentId: null })),
      'intakeDraftId',
    );
    return new Map(
      [...byDraft].map(([draftId, photos]) => [
        draftId,
        photos.map((photo) => photo.url),
      ]),
    );
  }

  // One draft with its frames attached, for the paths that hold a single row.
  private async publish(draft: InventoryIntakeDraft): Promise<IntakeDraft> {
    return this.toPublic(draft, await this.draftFrames(draft.id));
  }

  // Recognize ONE draft, on request. Synchronous by design: the person pressed a
  // button and is watching the row, so the answer belongs in the response rather
  // than in a state they have to reload to discover.
  async recognize(id: string, locale?: string): Promise<IntakeDraft> {
    const draft = await this.requireDraft(id);
    const frames = await this.draftFrames(id);
    if (frames.length === 0) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.recognizeNoImage', undefined, locale),
      );
    }

    await this.prisma.inventoryIntakeDraft.update({
      where: { id },
      data: { status: 'recognizing', errorKey: null },
    });
    try {
      // EVERY frame goes to the model — they are angles of one part, and the
      // answer is one item assembled from all of them (#215). The drafts screen
      // shows the count on the button, so the cost is visible before the press.
      const result = await this.recognition.recognizeStored(frames, locale);
      const updated = await this.prisma.inventoryIntakeDraft.update({
        where: { id },
        data: {
          status: 'ready',
          name: result.name,
          sku: result.sku,
          categoryId: result.categoryId,
          description: result.description,
          // An empty answer must not wipe values a person already typed into
          // the draft by hand — UNLESS the answer moved the draft into another
          // category, in which case those values are keyed by property ids the
          // new category does not have. The hand-edit path clears them for
          // exactly that reason; recognizing into a different category is the
          // same event arriving by another door.
          ...(Object.keys(result.propertyValues).length > 0
            ? { propertyValues: JSON.stringify(result.propertyValues) }
            : result.categoryId !== draft.categoryId
              ? { propertyValues: null }
              : {}),
          unit: result.unit,
        },
      });
      return this.publish(updated);
    } catch (err) {
      this.logger.warn(
        `Draft ${id} recognition failed: ${getErrorMessage(err)}`,
      );
      const failed = await this.prisma.inventoryIntakeDraft.update({
        where: { id },
        data: {
          status: 'failed',
          errorKey: 'inventory.errors.recognizeParseFailed',
        },
      });
      return this.publish(failed);
    }
  }

  async list(): Promise<IntakeDraft[]> {
    const drafts = await this.prisma.inventoryIntakeDraft.findMany({
      orderBy: { createdAt: 'asc' },
    });
    // One query for every draft's frames, not one per row.
    const frames = await this.framesByDraft(drafts.map((d) => d.id));
    return drafts.map((d) => this.toPublic(d, frames.get(d.id) ?? []));
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        IntakeDraft,
        | 'name'
        | 'sku'
        | 'categoryId'
        | 'description'
        | 'unit'
        | 'quantity'
        | 'storageId'
        | 'storageRow'
        | 'storageCol'
      >
      // Wider than the draft's own `Record<string, string>`: this is what the
      // wire sends, where clearing a field is `null` and a number stays a
      // number. It is narrowed on the way in.
    > & { propertyValues?: PropertyValueInput },
  ): Promise<IntakeDraft> {
    const draft = await this.requireDraft(id);
    const { propertyValues, ...rest } = patch;
    // A category change invalidates the values that belonged to the old one:
    // the property ids are simply not in the new category's set, and carrying
    // them along would offer the next screen fields it cannot name. The draft
    // is a scratchpad, so they are dropped rather than spilled — nothing has
    // reached the warehouse yet.
    const categoryChanged =
      rest.categoryId !== undefined && rest.categoryId !== draft.categoryId;
    const updated = await this.prisma.inventoryIntakeDraft.update({
      where: { id },
      data: {
        ...rest,
        ...(propertyValues !== undefined
          ? {
              propertyValues: JSON.stringify(
                await this.coerceValues(
                  rest.categoryId === undefined
                    ? draft.categoryId
                    : rest.categoryId,
                  propertyValues,
                ),
              ),
            }
          : categoryChanged
            ? { propertyValues: null }
            : {}),
        // Anything a human touched is ready by definition, even if the model
        // never answered.
        status: 'ready',
      },
    });
    return this.publish(updated);
  }

  // What a human typed into the property fields, held to the same rule the save
  // will apply (§ coercePropertyValue). Without this the draft happily kept a
  // `select` value outside the options, showed it on the phone, and lost it
  // silently on commit — the screen promising a value it was about to drop is
  // the exact failure the shared rule exists to prevent.
  private async coerceValues(
    categoryId: string | null,
    input: PropertyValueInput,
  ): Promise<Record<string, string>> {
    if (!categoryId) return {};
    const properties = await this.categories.effectiveProperties(categoryId);
    const byId = new Map(properties.map((property) => [property.id, property]));
    const values: Record<string, string> = {};
    for (const [propertyId, raw] of Object.entries(input)) {
      const property = byId.get(propertyId);
      if (!property) continue;
      const coerced = coercePropertyValue(property, raw);
      // `undefined` = rejected, `null` = cleared. Both leave the key out: the
      // draft stores only values it actually holds.
      if (coerced === undefined || coerced === null) continue;
      values[propertyId] = String(coerced);
    }
    return values;
  }

  // Turn a draft into real stock: either a brand-new component, or a receipt
  // against one the human recognized as the same part. Either way the draft is
  // consumed — its photographs live on as the item's pictures.
  async commit(
    id: string,
    targetComponentId?: string,
    // Whether the draft's frames should be attached when committing into an
    // EXISTING item. Omitted means "apply the rule": attach only if that item
    // has no photograph yet. The screens that let a person pick the target show
    // the rule as a switch with that same default, so it is never a silent
    // decision (#216).
    attachPhotos?: boolean,
  ): Promise<{ componentId: string; created: boolean; quantity: number }> {
    const draft = await this.requireDraft(id);
    const frames = await this.draftFrames(id);

    // An exact SKU match is a FACT, not a guess, so it resolves on its own: the
    // part is already on the shelf and this is a receipt into it, not a second
    // card for the same resistor. A name-only resemblance never gets this
    // treatment — that one is a question for a human.
    const target =
      targetComponentId ??
      (draft.sku ? (await this.inventory.findBySku(draft.sku))[0]?.id : null);

    if (target) {
      await this.inventory.adjustQty(target, draft.quantity, 'PURCHASE');
      await this.attachFramesToExisting(target, frames, attachPhotos);
      await this.deleteDraftWithFrames(id);
      return {
        componentId: target,
        created: false,
        quantity: draft.quantity,
      };
    }

    if (!draft.name) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.draftNeedsName'),
      );
    }

    // The category is a chosen id now (#206), so there is nothing to match: a
    // category deleted while the batch waited simply leaves the item uncategorised.
    const categoryId = draft.categoryId
      ? ((
          await this.prisma.itemCategory.findUnique({
            where: { id: draft.categoryId },
            select: { id: true },
          })
        )?.id ?? null)
      : null;

    // Values go in through `create`, which sets them after the item exists and
    // then announces them — that announcement is what places the tags (#205).
    // Sending them separately afterwards would place none.
    const propertyValues = categoryId ? parseValues(draft.propertyValues) : {};

    const created = await this.inventory.create({
      name: draft.name,
      ...(draft.sku ? { sku: draft.sku } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(Object.keys(propertyValues).length > 0 ? { propertyValues } : {}),
      // The draft's description is PLAIN text — a model wrote it and a person
      // edited it in a textarea — while the item's is rich text run through the
      // markup sanitizer. Escaped on the way across, or a part described as
      // "pitch <5mm" reaches the card with the measurement missing.
      ...(draft.description
        ? { description: escapeHtmlText(draft.description) }
        : {}),
      ...(draft.unit ? { unit: draft.unit } : {}),
      quantity: draft.quantity,
      ...(draft.storageId ? { storageId: draft.storageId } : {}),
      ...(draft.storageRow !== null ? { storageRow: draft.storageRow } : {}),
      ...(draft.storageCol !== null ? { storageCol: draft.storageCol } : {}),
      // Every frame becomes a photograph of the new item, first one the cover.
      // `create` adopts them: they are parented to the draft, which is about to
      // stop existing.
      ...(frames.length > 0 ? { photos: frames } : {}),
    });
    await this.deleteDraftWithFrames(id);
    return {
      componentId: created.id,
      created: true,
      quantity: draft.quantity,
    };
  }

  // Frames landing on an item that already exists.
  //
  // The rule: attach only if the target has NO photograph yet, otherwise drop
  // them. A shelf photograph of a part already pictured adds nothing and costs
  // disk; a part with no picture at all gains one for free. `attachPhotos`
  // overrides it where a person made the choice on screen.
  //
  // "Drop" means DELETE — the frames are parented to a draft that is about to
  // go, so leaving them would leave orphans, i.e. the litter #120 makes people
  // sweep by hand.
  private async attachFramesToExisting(
    componentId: string,
    frames: string[],
    attachPhotos?: boolean,
  ): Promise<void> {
    if (frames.length === 0) return;
    const held = await this.inventory.photoCount(componentId);
    const attach = attachPhotos ?? held === 0;
    if (!attach) return;
    // Under the default rule this cannot trigger (it only attaches to an item
    // with no picture at all); an explicit `attachPhotos: true` on an item that
    // already has some can. The set is capped, so the tail is dropped — with the
    // draft, so nothing is orphaned, but a commit has no screen to say it on.
    if (held + frames.length > MAX_ITEM_PHOTOS) {
      this.logger.warn(
        `Draft frames over the cap on commit into ${componentId}: ${held} held + ${frames.length} frames, ${MAX_ITEM_PHOTOS} kept.`,
      );
    }
    // Adding, not replacing: the item's own pictures and its cover survive, and
    // the read-modify-write lives on the owner rather than across this seam.
    await this.inventory.addPhotos(componentId, frames);
  }

  // Manual cleanup, never automatic (#120): drafts and their photos are visible
  // with their age, and go when a human says so.
  //
  // Discarding now deletes the PHOTOGRAPHS too. That is a person pressing
  // Discard — a decision, not background retention — so #120's rule stands.
  async discard(ids: string[]): Promise<{ deleted: number }> {
    const drafts = await this.prisma.inventoryIntakeDraft.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    for (const draft of drafts) await this.deleteFrames(draft.id);
    const result = await this.prisma.inventoryIntakeDraft.deleteMany({
      where: { id: { in: drafts.map((d) => d.id) } },
    });
    return { deleted: result.count };
  }

  // Drop named frames from a draft that already exists.
  //
  // Scoped to THIS draft on purpose: an attachment named by a url or a key that
  // belongs to somebody else's draft is left alone rather than deleted, so a
  // stale phone cannot reach into a batch it is no longer looking at.
  //
  // Naming a frame that is already gone is a no-op, which is what makes the
  // offline queue safe here — a drop drained twice deletes once.
  // The draft is named by its server id OR by the phone's own `clientDraftId`,
  // for the same reason `capture` accepts that key: a phone that shot a batch in
  // a basement never learned the server's id, and the frame it wants to drop is
  // the one it just took. Both keys are unique, so this is a lookup, not a
  // guess.
  async discardFramesOf(
    idOrClientKey: string,
    address: { imageUrls: readonly string[]; clientOpIds: readonly string[] },
  ): Promise<IntakeDraft> {
    const draft = await this.requireDraftByAnyKey(idOrClientKey);
    const named = new Set(
      address.imageUrls.map((url) => url.split('/').pop() ?? ''),
    );
    const rows = await this.prisma.attachment.findMany({
      where: { intakeDraftId: draft.id },
      select: { id: true, clientOpId: true },
    });
    for (const row of rows) {
      const byUrl = named.has(row.id);
      const byOp =
        row.clientOpId !== null && address.clientOpIds.includes(row.clientOpId);
      if (byUrl || byOp) await this.attachments.deleteById(row.id);
    }
    return this.publish(draft);
  }

  // The frames go BEFORE the draft: once the draft row is gone the scope policy
  // can no longer prove their parent, which would strand them.
  private async deleteDraftWithFrames(id: string): Promise<void> {
    await this.deleteFrames(id);
    await this.prisma.inventoryIntakeDraft.delete({ where: { id } });
  }

  private async deleteFrames(draftId: string): Promise<void> {
    const rows = await this.prisma.attachment.findMany({
      where: { intakeDraftId: draftId },
      select: { id: true },
    });
    for (const row of rows) await this.attachments.deleteById(row.id);
  }

  private async requireDraftByAnyKey(key: string) {
    const byClientKey = await this.prisma.inventoryIntakeDraft.findUnique({
      where: { clientDraftId: key },
    });
    if (byClientKey) return byClientKey;
    return this.requireDraft(key);
  }

  private async requireDraft(id: string) {
    const draft = await this.prisma.inventoryIntakeDraft.findUnique({
      where: { id },
    });
    // A draft outside the caller's scope reads as absent — the policy already
    // filtered it out, and "not found" is the honest answer either way.
    if (!draft) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.draftNotFound'),
      );
    }
    return draft;
  }

  private toPublic(
    draft: InventoryIntakeDraft,
    imageUrls: string[],
  ): IntakeDraft {
    return {
      id: draft.id,
      imageUrls,
      status: toStatus(draft.status),
      name: draft.name,
      sku: draft.sku,
      categoryId: draft.categoryId,
      description: draft.description,
      propertyValues: parseValues(draft.propertyValues),
      unit: draft.unit,
      quantity: draft.quantity,
      storageId: draft.storageId,
      storageRow: draft.storageRow,
      storageCol: draft.storageCol,
      errorKey: draft.errorKey,
      createdAt: draft.createdAt.toISOString(),
    };
  }
}
