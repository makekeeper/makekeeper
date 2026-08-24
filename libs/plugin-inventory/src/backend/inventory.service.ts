import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  PluginI18nService,
  CapabilityRegistryService,
  PluginEventBusService,
  AttachmentStorageService,
  getErrorMessage,
  sanitizeHtml,
  type StatsPoint,
} from '@makekeeper/backend-core';
import {
  COMPONENT_ORDER_INFO_CAPABILITY,
  INVENTORY_ITEM_PROPERTY_VALUES_EVENT,
  formatObjectRef,
  type ComponentOrderInfoCapability,
  type InventoryItemPropertyValuesEvent,
} from '@makekeeper/plugin-contract';
import { Prisma } from '@prisma/client';
import { ManualMovementType } from './inventory.dto';
import { InventoryEventsService } from './inventory-events.service';
import { InventoryCategoriesService } from './categories.service';
import {
  CATEGORY_PROPERTY_ENTITY,
  type PropertyValueInput,
} from '../categories';
import {
  MAX_ITEM_PHOTOS,
  type ComponentPhoto,
  type ComponentPhotoFields,
} from '../photos';

// A component row as the list endpoint returns it: the record plus its storage
// relation, augmented with the derived stock figures (reservations, on-order,
// last paid price). Derived from the Prisma payload so it tracks the schema.
export interface ComponentListItem
  extends Prisma.ComponentGetPayload<{
      include: { storage: true; categoryRef: true };
    }>,
    ComponentPhotoFields {
  reservedTotal: number;
  onOrder: number;
  lastPrice: number | null;
  lastCurrency: string | null;
}

// Suggested buy quantity to bring a component back to a safe level: enough stock
// to cover the greater of its min-stock threshold and the still-unmet project
// demand. Stock already on order counts toward the target (it will arrive), so
// it is subtracted — the result is what still needs buying. Zero means no
// purchase needed. Pure for testability.
export function computeShortfall(
  quantity: number,
  minQuantity: number,
  unmetDemand: number,
  onOrder = 0,
): number {
  const target = Math.max(minQuantity, unmetDemand);
  return Math.max(0, target - quantity - onOrder);
}

// ── Project flows (dashboard Sankey) ────────────────────────────────────────

// The slice of a StockMovement the flow aggregation consumes.
export interface FlowMovementRow {
  type: string;
  delta: number;
  projectId: string | null;
  orderId: string | null;
}

export interface ProjectFlowRow {
  id: string;
  title: string | null;
  drawn: number;
  used: number;
  returned: number;
  stillReserved: number;
}

export interface ProjectFlows {
  currentStock: number;
  // Top suppliers by received units; the trailing `id: null` entry (when
  // present) aggregates supplier-less receipts and ranks beyond the top.
  suppliers: { id: string | null; name: string | null; units: number }[];
  adjustmentsIn: number;
  projects: ProjectFlowRow[];
  others: {
    count: number;
    drawn: number;
    used: number;
    returned: number;
    stillReserved: number;
  } | null;
  writeOffs: number;
}

const TOP_SUPPLIERS = 3;
const TOP_PROJECTS = 5;

const round2 = (v: number): number => Math.round(v * 100) / 100;

// Aggregates a period's movement log into the Sankey's flow sums. Pure for
// testability. Accounting rules (see docs in the dashboard widget):
// - "drawn" counts ONLY negative RESERVED deltas: consume decrements the
//   reservation, not the free stock, so adding USED would double-count.
// - "returned" = positive RETURN/RESERVED deltas with a projectId (project
//   returns and reservation releases).
// - "stillReserved" balances drawn − used − returned, clamped at 0 (returns
//   of reservations made before the window can push it negative).
// - Supplier attribution follows PURCHASE movements' orderId; receipts with
//   no order/supplier and suppliers ranked beyond the top fold into one
//   `id: null` bucket.
// - "writeOffs" = negative non-project ADJUSTMENT/RETURN deltas (manual
//   corrections, receive reversals, returns to suppliers).
export function aggregateProjectFlows(input: {
  movements: FlowMovementRow[];
  supplierByOrder: Map<string, { id: string; name: string } | null>;
  projectTitles: Map<string, string>;
  currentStock: number;
}): ProjectFlows {
  const supplierUnits = new Map<string, { name: string; units: number }>();
  let unattributedUnits = 0;
  let adjustmentsIn = 0;
  let writeOffs = 0;
  const perProject = new Map<
    string,
    { drawn: number; used: number; returned: number }
  >();
  const projectAcc = (id: string) => {
    let acc = perProject.get(id);
    if (!acc) {
      acc = { drawn: 0, used: 0, returned: 0 };
      perProject.set(id, acc);
    }
    return acc;
  };

  for (const mv of input.movements) {
    if (mv.delta > 0) {
      if (mv.projectId) {
        if (mv.type === 'RETURN' || mv.type === 'RESERVED') {
          projectAcc(mv.projectId).returned += mv.delta;
        }
        continue;
      }
      if (mv.type === 'PURCHASE') {
        const supplier = mv.orderId
          ? input.supplierByOrder.get(mv.orderId)
          : null;
        if (supplier) {
          const acc = supplierUnits.get(supplier.id) ?? {
            name: supplier.name,
            units: 0,
          };
          acc.units += mv.delta;
          supplierUnits.set(supplier.id, acc);
        } else {
          unattributedUnits += mv.delta;
        }
      } else if (mv.type === 'ADJUSTMENT' || mv.type === 'RETURN') {
        adjustmentsIn += mv.delta;
      }
      continue;
    }
    if (mv.delta < 0) {
      if (mv.projectId) {
        if (mv.type === 'RESERVED') projectAcc(mv.projectId).drawn -= mv.delta;
        else if (mv.type === 'USED') projectAcc(mv.projectId).used -= mv.delta;
        continue;
      }
      if (mv.type === 'ADJUSTMENT' || mv.type === 'RETURN') {
        writeOffs -= mv.delta;
      }
    }
  }

  // Top suppliers by units; ranks beyond the top fold into the null bucket.
  const named = [...supplierUnits.entries()]
    .map(([id, s]) => ({ id, name: s.name, units: s.units }))
    .sort((a, b) => b.units - a.units);
  const topSuppliers = named.slice(0, TOP_SUPPLIERS);
  const foldedUnits =
    unattributedUnits +
    named.slice(TOP_SUPPLIERS).reduce((acc, s) => acc + s.units, 0);
  const suppliers: ProjectFlows['suppliers'] = [
    ...topSuppliers.map((s) => ({ ...s, units: round2(s.units) })),
    ...(foldedUnits > 0
      ? [{ id: null, name: null, units: round2(foldedUnits) }]
      : []),
  ];

  // Project rows sorted by drawn volume; ranks beyond the top aggregate.
  const rows: ProjectFlowRow[] = [...perProject.entries()]
    .map(([id, acc]) => ({
      id,
      title: input.projectTitles.get(id) ?? null,
      drawn: round2(acc.drawn),
      used: round2(acc.used),
      returned: round2(acc.returned),
      stillReserved: round2(Math.max(0, acc.drawn - acc.used - acc.returned)),
    }))
    .filter((r) => r.drawn > 0 || r.used > 0 || r.returned > 0)
    .sort(
      (a, b) =>
        b.drawn - a.drawn || b.used + b.returned - (a.used + a.returned),
    );
  const topProjects = rows.slice(0, TOP_PROJECTS);
  const rest = rows.slice(TOP_PROJECTS);
  const others =
    rest.length > 0
      ? {
          count: rest.length,
          drawn: round2(rest.reduce((acc, r) => acc + r.drawn, 0)),
          used: round2(rest.reduce((acc, r) => acc + r.used, 0)),
          returned: round2(rest.reduce((acc, r) => acc + r.returned, 0)),
          stillReserved: round2(
            Math.max(
              0,
              rest.reduce((acc, r) => acc + r.drawn - r.used - r.returned, 0),
            ),
          ),
        }
      : null;

  return {
    currentStock: round2(input.currentStock),
    suppliers,
    adjustmentsIn: round2(adjustmentsIn),
    projects: topProjects,
    others,
    writeOffs: round2(writeOffs),
  };
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly attachments: AttachmentStorageService,
    private readonly events: InventoryEventsService,
    private readonly categories: InventoryCategoriesService,
    private readonly eventBus: PluginEventBusService,
  ) {}

  // ── Photographs (#212) ────────────────────────────────────────────────────
  //
  // An item's pictures are plain `Attachment` rows keyed by `componentId`, in
  // `createdAt` order, with `Component.coverAttachmentId` naming the cover. The
  // `imageUrl` column is gone (#213); what every consumer still reads under that
  // name is derived here from the same set.

  // What a create/update payload says the picture set should become, resolved to
  // stored "/api/uploads/:id" URLs. `undefined` means "no photo field was sent",
  // i.e. leave the set alone — the distinction the whole write path turns on;
  // an EMPTY list is a real instruction, and clears the pictures.
  //
  // `photos` is the ONE way in. The single-photo `imageUrl`/`imageDataUrl`
  // inputs of #73 went with the column (#212 review): after this epic no caller
  // sent them — the desktop form, the phone and the agent tools all speak the
  // set — and a second write shape kept alive for nobody is the seam the two
  // would have drifted along. `imageUrl` survives on the way OUT, derived from
  // the cover.
  //
  // Data URLs are persisted here; already-stored URLs pass through. `componentId`
  // is null on create, where the pictures are stored before the row exists (the
  // scope policy will not accept a parent it cannot find, #125) and adopted
  // right afterwards.
  private async resolvePhotoUrls(
    data: { photos?: string[] },
    componentId: string | null,
  ): Promise<string[] | undefined> {
    const requested = data.photos;
    if (requested === undefined) return undefined;

    const stored: string[] = [];
    for (const entry of requested.slice(0, MAX_ITEM_PHOTOS)) {
      // A blank entry is not a picture — a model padding the array must not
      // shorten the set it thought it sent.
      if (!entry) continue;
      if (entry.startsWith('data:')) {
        const url = await this.attachments.saveDataUrl(
          { pluginId: 'inventory', componentId },
          entry,
        );
        if (url) stored.push(url);
        continue;
      }
      stored.push(entry);
    }
    return stored;
  }

  // Make the item's pictures be exactly `urls`, in that order, and pin the first
  // as the cover.
  //
  // Three rules, each of which was a bug in the single-photo version:
  //
  // - A picture belongs to ONE record. A URL naming an attachment already filed
  //   under another component or a project is DROPPED, never re-homed: a save
  //   must not quietly move somebody else's photograph. Rows with no parent (a
  //   fresh upload, an intake draft's frame) are adopted.
  // - What leaves the set is DELETED — row, file and renditions. A merely
  //   detached attachment is an orphan, i.e. the litter #120 makes people sweep
  //   by hand.
  // - The cover is the first surviving entry. The caller orders the list; the
  //   phone never asks about covers and the form pins by reordering.
  private async applyPhotoSet(
    componentId: string,
    urls: readonly string[],
  ): Promise<void> {
    const existing = await this.prisma.attachment.findMany({
      where: { componentId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));

    const keptIds: string[] = [];
    for (const url of urls.slice(0, MAX_ITEM_PHOTOS)) {
      const att = await this.attachments.findByUrl(url);
      if (!att) continue;
      if (keptIds.includes(att.id)) continue;
      if (!existingIds.has(att.id)) {
        // Not one of ours yet. Adopt it only if it is nobody else's.
        const meta = await this.prisma.attachment.findUnique({
          where: { id: att.id },
          select: { projectId: true, componentId: true },
        });
        if (!meta || meta.projectId !== null || meta.componentId !== null) {
          continue;
        }
        await this.attachments.claim(url, {
          pluginId: 'inventory',
          componentId,
        });
      }
      keptIds.push(att.id);
    }

    for (const id of existingIds) {
      if (!keptIds.includes(id)) await this.attachments.deleteById(id);
    }

    await this.prisma.component.update({
      where: { id: componentId },
      data: { coverAttachmentId: keptIds[0] ?? null },
    });
  }

  // Hold EVERY URL an agent supplied to the same rule, before anything is
  // written (#218).
  //
  // `applyPhotoSet` is forgiving by design: a URL it cannot use is skipped and
  // the save proceeds, because the desktop form and the intake commit both send
  // sets assembled from pictures that are already in hand. An agent is the one
  // caller whose list is not evidence of anything — the model may name a URL the
  // person never showed it. Forgiveness there reads as success: the tool
  // answered "created", and three of the five photographs the model claimed to
  // attach were quietly gone, with nothing in the reply saying which.
  //
  // So this refuses instead, per URL and before the write, and the whole call
  // fails rather than half-landing. Three ways a URL fails:
  //
  // - it is not a stored picture at all. `data:` bytes are the sharpest case:
  //   that is the model supplying an image of its own, which is precisely what
  //   provenance means to exclude;
  // - it names nothing this caller can read — invented, already deleted, or
  //   another scope's (the scoped client cannot see it, so the two are the same
  //   answer here);
  // - it belongs to a project or to a DIFFERENT item. The item's own pictures
  //   pass, so a model re-sending the current set to reorder it is not fighting
  //   the rule.
  //
  // What deliberately passes: an unowned attachment of the caller's own — a chat
  // upload, a phone-bridge capture, an intake frame. That IS the person putting
  // a picture there; refusing it would leave the agent no way to attach a photo
  // the user just sent.
  async assertPhotosAdoptable(
    urls: readonly string[],
    componentId: string | null,
  ): Promise<void> {
    for (const url of urls) {
      if (url.startsWith('data:')) {
        throw new BadRequestException(
          this.i18n.t('inventory.errors.photoNotStored'),
        );
      }
      const att = await this.attachments.findByUrl(url);
      const meta = att
        ? await this.prisma.attachment.findUnique({
            where: { id: att.id },
            select: { projectId: true, componentId: true },
          })
        : null;
      if (!meta) {
        throw new BadRequestException(
          this.i18n.t('inventory.errors.photoUnknown', { url }),
        );
      }
      if (
        meta.projectId !== null ||
        (meta.componentId !== null && meta.componentId !== componentId)
      ) {
        throw new BadRequestException(
          this.i18n.t('inventory.errors.photoOwnedElsewhere', { url }),
        );
      }
    }
  }

  // Attach the photo fields every component payload carries: the full set and
  // the derived `imageUrl` cover.
  //
  // No readability pass is needed any more (#123): the set comes from the
  // caller's scoped Prisma client, so a picture they may not read is simply not
  // in it. The old filter existed because `imageUrl` was a client-supplied
  // string that outlived the right to fetch the bytes behind it.
  private async withPhotos<
    T extends { id: string; coverAttachmentId: string | null },
  >(components: T[]): Promise<(T & ComponentPhotoFields)[]> {
    const byComponent = await this.attachments.photosByOwner(
      components.map((c) => ({
        id: c.id,
        coverAttachmentId: c.coverAttachmentId,
      })),
      'componentId',
    );
    return components.map((component) => {
      const photos = byComponent.get(component.id) ?? [];
      return {
        ...component,
        photos,
        imageUrl: photos.find((photo) => photo.isCover)?.url ?? null,
      };
    });
  }

  // ADD pictures to an item, keeping the ones it already has (the intake commit
  // path, #216). Lives here rather than in the caller because the read and the
  // write are one decision about this item's set — split across the service
  // seam, the pair was a read-modify-write another writer could interleave with.
  // The same rules apply: a picture belonging to something else is dropped, and
  // the existing cover is preserved by leading with the current order.
  async addPhotos(componentId: string, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const current = await this.currentPhotos(componentId);
    const cover = current.find((photo) => photo.isCover)?.url;
    await this.applyPhotoSet(componentId, [
      // The cover leads, so adding a picture never re-pins the item's cover to
      // whatever happened to be uploaded first.
      ...(cover ? [cover] : []),
      ...current.map((photo) => photo.url).filter((url) => url !== cover),
      ...urls,
    ]);
  }

  // How many pictures an item has — the question the intake commit asks before
  // deciding whether the draft's frames are worth attaching (#216).
  async photoCount(componentId: string): Promise<number> {
    return (await this.currentPhotos(componentId)).length;
  }

  // The item's pictures as they stand, cover already resolved.
  //
  // Asked of the store directly rather than through `withPhotos`, which decorates
  // component ROWS and therefore needs one loaded first: the two callers above
  // hold an id and nothing else, and satisfying that shape meant a `findUnique`
  // inlined into an object literal to fetch the one column it wanted.
  private async currentPhotos(componentId: string): Promise<ComponentPhoto[]> {
    const row = await this.prisma.component.findUnique({
      where: { id: componentId },
      select: { coverAttachmentId: true },
    });
    if (!row) return [];
    const byComponent = await this.attachments.photosByOwner(
      [{ id: componentId, coverAttachmentId: row.coverAttachmentId }],
      'componentId',
    );
    return byComponent.get(componentId) ?? [];
  }

  // Delete every picture of an item (row, file, renditions) — the item is going
  // away, and an orphaned file must never block the delete the user asked for.
  private async deleteAllPhotos(componentId: string): Promise<void> {
    const rows = await this.prisma.attachment.findMany({
      where: { componentId },
      select: { id: true },
    });
    for (const row of rows) await this.attachments.deleteById(row.id);
  }

  // Order-derived component facts are logistics functionality (#58), consumed
  // through the capability registry: null while logistics is disabled, and the
  // dependent figures (on-order, last price, order history) simply disappear.
  private orderInfo(): ComponentOrderInfoCapability | null {
    return this.capabilities.getCapability<ComponentOrderInfoCapability>(
      COMPONENT_ORDER_INFO_CAPABILITY,
    );
  }

  // Period flow sums for the dashboard Sankey (suppliers → warehouse →
  // projects → outcomes). Movements' projectId/orderId are bare columns (no
  // Prisma relations), so titles and suppliers are joined manually via id
  // lookups; the accounting itself lives in the pure `aggregateProjectFlows`.
  async getProjectFlows(
    days: number,
  ): Promise<ProjectFlows & { days: number }> {
    const span = Math.min(Math.max(Math.trunc(days), 1), 365);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));

    const [stockAgg, movements] = await Promise.all([
      this.prisma.component.aggregate({ _sum: { quantity: true } }),
      this.prisma.stockMovement.findMany({
        where: { createdAt: { gte: start } },
        select: { type: true, delta: true, projectId: true, orderId: true },
      }),
    ]);

    const orderIds = [
      ...new Set(
        movements
          .filter((m) => m.type === 'PURCHASE' && m.delta > 0 && m.orderId)
          .map((m) => m.orderId as string),
      ),
    ];
    const projectIds = [
      ...new Set(movements.flatMap((m) => (m.projectId ? [m.projectId] : []))),
    ];
    const [orders, projects] = await Promise.all([
      orderIds.length
        ? this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              supplier: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
    ]);

    const flows = aggregateProjectFlows({
      movements,
      supplierByOrder: new Map(orders.map((o) => [o.id, o.supplier])),
      projectTitles: new Map(projects.map((p) => [p.id, p.title])),
      currentStock: stockAgg._sum.quantity ?? 0,
    });
    return { days: span, ...flows };
  }

  // Stats providers for the stock-timeline metrics (ticket #56 §4.4). Called by
  // the stats aggregation job under systemBypass, so each point carries its
  // scopeId. Stock/reserved are point-in-time LEVELS read straight from the
  // daily StockSnapshot (no backward-walk); `used` is a per-day consumption
  // counter derived from the movement log.
  async getStockLevelsByDayScope(
    from: Date,
    to: Date,
    measure: 'stock' | 'reserved',
  ): Promise<StatsPoint[]> {
    const fromDate = this.isoDay(from);
    const toDate = this.isoDay(to);
    const rows = await this.prisma.stockSnapshot.findMany({
      where: { date: { gte: fromDate, lt: toDate } },
      select: { date: true, scopeId: true, stock: true, reserved: true },
    });
    return rows.map((r) => ({
      date: r.date,
      scopeId: r.scopeId,
      value: measure === 'stock' ? r.stock : r.reserved,
    }));
  }

  async getUsedByDayScope(from: Date, to: Date): Promise<StatsPoint[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        type: 'USED',
        delta: { lt: 0 },
      },
      select: { createdAt: true, delta: true, scopeId: true },
    });
    const buckets = new Map<string, StatsPoint>();
    for (const mv of rows) {
      const date = this.isoDay(mv.createdAt);
      const scopeId = mv.scopeId ?? null;
      const key = `${date} ${scopeId ?? ''}`;
      const existing = buckets.get(key);
      // USED movements carry a negative delta; consumption is its magnitude.
      if (existing) existing.value += -mv.delta;
      else buckets.set(key, { date, scopeId, value: -mv.delta });
    }
    return [...buckets.values()];
  }

  private isoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Soft duplicate check on add (#33 E4). Case-insensitive SKU match, scoped to
  // the caller by the multiuser policy; `excludeId` drops the component being
  // edited from its own results. Empty/blank SKU → no matches (never warn on the
  // many components a home user leaves SKU-less).
  async findBySku(
    sku: string,
    excludeId?: string,
  ): Promise<{ id: string; name: string; sku: string }[]> {
    const trimmed = sku.trim();
    if (!trimmed) return [];
    const matches = await this.prisma.component.findMany({
      where: {
        sku: { equals: trimmed, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
    return matches.map((m) => ({ id: m.id, name: m.name, sku: m.sku ?? '' }));
  }

  // Free-text search (#33 E5). Case-insensitive substring over the fields a
  // user reasonably searches by, including the JSON-string `customFields` blob
  // (a `contains` still finds "SOP-8" inside it). Blank q ⇒ undefined ⇒ no
  // filter. Kept private so `findAll` owns the one call site.
  private searchWhere(
    q: string | undefined,
  ): Prisma.ComponentWhereInput | undefined {
    const trimmed = q?.trim();
    if (!trimmed) return undefined;
    const contains = { contains: trimmed, mode: 'insensitive' as const };
    return {
      OR: [
        { name: contains },
        { sku: contains },
        { description: contains },
        // The category is a relation now (#205), so its name is matched through
        // it; typed property values join the search for the same reason the
        // customFields blob always has — people search by what is written on
        // the part, not by which field it happens to live in.
        { categoryRef: { name: contains } },
        { propertyValues: { some: { valueText: contains } } },
        { customFields: contains },
      ],
    };
  }

  async findAll(q?: string): Promise<ComponentListItem[]> {
    const components = await this.prisma.component.findMany({
      where: this.searchWhere(q),
      include: {
        storage: true,
        // The category's name travels with the row so lists and filters can
        // show it without a second lookup per item (#205).
        categoryRef: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // `quantity` is already net of reservations (reserving decrements it), so
    // expose the parallel reserved pool for visibility. One grouped query keeps
    // this off the N+1 path; groupBy is scope-filtered by the multiuser policy.
    const reserved = await this.prisma.projectComponent.groupBy({
      by: ['componentId'],
      _sum: { reservedQty: true },
    });
    const reservedByComponent = new Map(
      reserved.map((row) => [row.componentId, row._sum.reservedQty ?? 0]),
    );

    const onOrderByComponent = await this.onOrderByComponent();
    const lastPriceByComponent = await this.lastPriceByComponent();

    return this.withPhotos(
      components.map((component) => {
        const last = lastPriceByComponent.get(component.id);
        return {
          ...component,
          reservedTotal: reservedByComponent.get(component.id) ?? 0,
          onOrder: onOrderByComponent.get(component.id) ?? 0,
          // Derived "last paid" price from order history (#50) — price is no
          // longer stored on the component itself.
          lastPrice: last?.price ?? null,
          lastCurrency: last?.currency ?? null,
        };
      }),
    );
  }

  // Most-recent unit price paid per component (logistics capability); empty
  // while logistics is disabled — prices then just don't show.
  private async lastPriceByComponent(): Promise<
    Map<string, { price: number; currency: string }>
  > {
    return (
      (await this.orderInfo()?.lastPriceByComponent()) ??
      new Map<string, { price: number; currency: string }>()
    );
  }

  // Quantity on the way per component (logistics capability); empty while
  // logistics is disabled — nothing counts as "on order".
  private async onOrderByComponent(): Promise<Map<string, number>> {
    return (
      (await this.orderInfo()?.onOrderByComponent()) ??
      new Map<string, number>()
    );
  }

  // Orders that reference a component, newest first — for the "related orders"
  // panel in the component card. Empty while logistics is disabled.
  async findComponentOrders(componentId: string) {
    return (await this.orderInfo()?.componentOrders(componentId)) ?? [];
  }

  async findOne(id: string) {
    return this.prisma.component.findUnique({ where: { id } });
  }

  // Components that need restocking, each with a suggested buy quantity
  // (`shortfall`). A component is short when its free `quantity` cannot cover
  // the greater of its min-stock threshold and the still-unmet project demand
  // (needed minus already-reserved across all project links). Two grouped,
  // scope-filtered queries — no N+1.
  async getRestockList() {
    const components = await this.prisma.component.findMany({
      orderBy: { name: 'asc' },
    });
    const demand = await this.prisma.projectComponent.groupBy({
      by: ['componentId'],
      _sum: { neededQty: true, reservedQty: true },
    });
    const demandByComponent = new Map(
      demand.map((row) => [
        row.componentId,
        {
          needed: row._sum.neededQty ?? 0,
          reserved: row._sum.reservedQty ?? 0,
        },
      ]),
    );
    const onOrderByComponent = await this.onOrderByComponent();

    const short = components.flatMap((component) => {
      const d = demandByComponent.get(component.id);
      const unmetDemand = d ? Math.max(0, d.needed - d.reserved) : 0;
      const onOrder = onOrderByComponent.get(component.id) ?? 0;
      // Net of stock already on order — what still needs buying.
      const shortfall = computeShortfall(
        component.quantity,
        component.minQuantity,
        unmetDemand,
        onOrder,
      );
      return shortfall > 0
        ? [{ ...component, unmetDemand, shortfall, onOrder }]
        : [];
    });
    return this.withPhotos(short);
  }

  // REST-facing single fetch: includes the storage relation (parity with
  // findAll) and 404s on a missing id, so the edit form can load one component
  // by id instead of pulling the whole list and filtering client-side.
  async getOne(id: string) {
    const comp = await this.prisma.component.findUnique({
      where: { id },
      include: { storage: true, categoryRef: true },
    });
    if (!comp) {
      throw new NotFoundException(
        this.i18n.t('inventory.errors.componentNotFound'),
      );
    }
    const [readable] = await this.withPhotos([comp]);
    return readable;
  }

  // A signed stock change recorded as a movement of the given type. `amount` may
  // be fractional (units like metres/grams); quantity is clamped at 0 so a delta
  // never drives stock negative. The note defaults to the manual-adjustment label
  // only for ADJUSTMENT — other types carry the caller's note or none.
  //
  // Offline-queue concerns (#202):
  //
  // 1. IDEMPOTENCY. A queued write carries a `clientOpId` minted on the phone.
  //    The movement row holds it under a unique index, so replaying the same
  //    queued operation — the normal outcome of a request that timed out on a
  //    flaky connection — records one movement instead of deducting twice.
  //
  // 2. ATOMICITY. The quantity is no longer read, adjusted in JS and written
  //    back: two drains landing together would each write a value computed from
  //    the same stale read, and one of the two deltas would vanish. The write is
  //    now a compare-and-set — the update only matches while the quantity is
  //    still what we read — retried on a concurrent change.
  //
  // The negative case differs by origin, deliberately. An ONLINE adjustment is a
  // person looking at the shelf, so "take it to zero" is what they mean and the
  // value is clamped, as it always was. A QUEUED delta was computed against a
  // view that may be an hour old, so silently clamping it would quietly corrupt
  // the count; it is refused instead and surfaced as an operation that did not
  // apply.
  async adjustQty(
    id: string,
    amount: number,
    type: ManualMovementType = 'ADJUSTMENT',
    note?: string,
    clientOpId?: string,
  ) {
    const trimmed = note?.trim();
    const movementNote =
      trimmed ||
      (type === 'ADJUSTMENT'
        ? this.i18n.t('inventory.notes.manualAdjustment')
        : null);

    // CLAIM FIRST, then move the stock. Looking the key up and acting on the
    // answer would be check-then-act: two replays racing each other would both
    // find nothing, both move the quantity, and only the loser would trip the
    // unique index — after the stock had already moved twice. Inserting the
    // movement is what claims the key, and the DB's unique index is the only
    // thing that can arbitrate that race.
    if (clientOpId) {
      const claimed = await this.claimOperation(
        id,
        clientOpId,
        type,
        movementNote,
      );
      // Someone already did this exact operation. Answer with the current state
      // rather than an error: the caller's intent is satisfied, which is the
      // whole point of the key.
      if (!claimed) return this.getOne(id);

      try {
        const delta = await this.applyDelta(id, amount, false);
        await this.prisma.stockMovement.update({
          where: { id: claimed },
          data: { delta },
        });
        return this.afterAdjust(id, delta);
      } catch (err) {
        // The delta could not apply (the part is gone, the count would go
        // negative). Drop the claim so the operation is a clean failure the
        // caller can show — not a movement of 0 pretending it happened.
        await this.prisma.stockMovement
          .delete({ where: { id: claimed } })
          .catch(() => undefined);
        throw err;
      }
    }

    const delta = await this.applyDelta(id, amount, true);

    if (delta !== 0) {
      await this.prisma.stockMovement.create({
        data: {
          id: 'sm_' + Math.random().toString(36).substring(2, 9),
          componentId: id,
          delta,
          type,
          note: movementNote,
        },
      });
    }

    return this.afterAdjust(id, delta);
  }

  // Insert the movement that CLAIMS an idempotency key. Returns the new row's id
  // when this caller won the claim, or null when the key was already taken —
  // which the unique index, not a prior read, decides. The delta is filled in
  // once the stock has actually moved.
  private async claimOperation(
    componentId: string,
    clientOpId: string,
    type: ManualMovementType,
    note: string | null,
  ): Promise<string | null> {
    const movementId = 'sm_' + Math.random().toString(36).substring(2, 9);
    try {
      await this.prisma.stockMovement.create({
        data: { id: movementId, componentId, delta: 0, type, clientOpId, note },
      });
      return movementId;
    } catch {
      // The only realistic failure here is the unique violation on clientOpId,
      // and treating any insert failure as "already claimed" is the safe way
      // round: it can duplicate nothing.
      return null;
    }
  }

  private async afterAdjust(id: string, delta: number) {
    const updated = await this.prisma.component.findUnique({
      where: { id },
      include: { storage: true },
    });
    if (!updated) {
      throw new Error(this.i18n.t('inventory.errors.componentNotFound'));
    }
    if (delta !== 0) {
      await this.events.itemChanged(updated.id, ['quantity'], updated.scopeId);
    }
    return updated;
  }

  // How many attempts a compare-and-set gets before we admit the row is too
  // contended to be someone honestly adjusting a shelf.
  private static readonly CAS_ATTEMPTS = 3;

  // Move the stored quantity by `amount`, atomically. Returns the delta that was
  // actually applied (which differs from `amount` only when clamping).
  private async applyDelta(
    id: string,
    amount: number,
    clamp: boolean,
  ): Promise<number> {
    for (let attempt = 0; attempt < InventoryService.CAS_ATTEMPTS; attempt++) {
      const comp = await this.prisma.component.findUnique({ where: { id } });
      if (!comp) {
        throw new Error(this.i18n.t('inventory.errors.componentNotFound'));
      }

      if (!clamp && comp.quantity + amount < 0) {
        throw new Error(
          this.i18n.t('inventory.errors.adjustWouldGoNegative', {
            name: comp.name,
          }),
        );
      }
      const delta = clamp ? Math.max(-comp.quantity, amount) : amount;
      if (delta === 0) return 0;

      // The predicate IS the lock: the row only moves while it still holds the
      // value this delta was computed against.
      const result = await this.prisma.component.updateMany({
        where: { id, quantity: comp.quantity },
        data: { quantity: { increment: delta } },
      });
      if (result.count === 1) return delta;
    }
    throw new Error(this.i18n.t('inventory.errors.adjustConflict'));
  }

  async findMovements(componentId: string) {
    return this.prisma.stockMovement.findMany({
      where: { componentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    name: string;
    sku?: string;
    description?: string;
    categoryId?: string | null;
    propertyValues?: PropertyValueInput;
    quantity?: number;
    minQuantity?: number;
    unit?: string;
    links?: string;
    customFields?: string;
    // The whole picture set, ordered; the first entry becomes the cover (#212).
    // Entries are stored "/api/uploads/:id" URLs or fresh `data:` URLs.
    photos?: string[];
    storageId?: string;
    storageRow?: number;
    storageCol?: number;
  }) {
    const id = 'comp_' + Math.random().toString(36).substring(2, 9);
    // Only `name` is required (#53); quantity/minQuantity default to 0
    // (minQuantity 0 = low-stock tracking off for this component).
    const quantity = data.quantity ?? 0;
    // The pictures are persisted BEFORE the component. They cannot name it yet —
    // the scope policy proves a parent exists before it accepts one, and the row
    // is not there — so they are stored parentless (private to their uploader,
    // #125) and adopted by `applyPhotoSet` right after. Should the adoption
    // fail, the item is simply pictureless and a re-save repairs it.
    const photoUrls = await this.resolvePhotoUrls(data, null);
    const comp = await this.prisma.component.create({
      data: {
        id,
        name: data.name,
        sku: data.sku || '',
        description: sanitizeHtml(data.description),
        categoryId: data.categoryId || null,
        quantity,
        minQuantity: data.minQuantity ?? 0,
        unit: data.unit || 'pcs',
        links: data.links || '',
        customFields: data.customFields || '',
        storageId: data.storageId || null,
        storageRow:
          data.storageRow !== undefined && data.storageRow !== null
            ? Number(data.storageRow)
            : null,
        storageCol:
          data.storageCol !== undefined && data.storageCol !== null
            ? Number(data.storageCol)
            : null,
      },
      include: {
        storage: true,
      },
    });

    if (quantity > 0) {
      await this.prisma.stockMovement.create({
        data: {
          id: 'sm_' + Math.random().toString(36).substring(2, 9),
          componentId: id,
          delta: quantity,
          type: 'ADJUSTMENT',
          note: this.i18n.t('inventory.notes.initialStock'),
        },
      });
    }

    if (photoUrls && photoUrls.length > 0) {
      await this.applyPhotoSet(id, photoUrls);
    }
    if (data.propertyValues) {
      await this.categories.setValues(id, data.propertyValues);
    }
    await this.announcePropertyValues(id);
    await this.events.itemCreated(comp);
    // Re-read so the caller gets the pin `applyPhotoSet` just wrote, not the
    // pinless row `create` returned.
    const [withPhotos] = await this.withPhotos([
      photoUrls && photoUrls.length > 0
        ? ((await this.prisma.component.findUnique({
            where: { id },
            include: { storage: true },
          })) ?? comp)
        : comp,
    ]);
    return withPhotos;
  }

  // Say what the new item was filled in with, and take no interest in who
  // cares (#205). This plugin resolves inheritance along the category chain,
  // because only it can; deciding that some value is worth a tag, a webhook or
  // anything else belongs to whoever decided that, not here.
  //
  // Emitted once, at birth. Editing a value later does not re-announce, so a
  // tag placed from a value stays where it was put and a tag removed by hand
  // stays removed — the person outranks the rule that put it there.
  //
  // Best-effort: a listener's problem must not lose the item that was created.
  // The bus already isolates listener errors; this catch covers the read that
  // builds the payload.
  private async announcePropertyValues(componentId: string): Promise<void> {
    try {
      const filled = await this.categories.filledValuesFor(componentId);
      if (!filled.length) return;
      const itemRef = formatObjectRef({
        pluginId: 'inventory',
        entityType: 'component',
        entityId: componentId,
      });
      if (!itemRef) return;
      const values = filled.flatMap((entry) => {
        const propertyRef = formatObjectRef({
          pluginId: 'inventory',
          entityType: CATEGORY_PROPERTY_ENTITY,
          entityId: entry.propertyId,
        });
        return propertyRef ? [{ propertyRef, value: entry.value }] : [];
      });
      if (!values.length) return;
      await this.eventBus.emit<InventoryItemPropertyValuesEvent>(
        INVENTORY_ITEM_PROPERTY_VALUES_EVENT,
        { itemRef, values },
      );
    } catch (err) {
      this.logger.warn(
        `Announcing property values for ${componentId} failed: ${getErrorMessage(err)}`,
      );
    }
  }

  async update(
    id: string,
    data: {
      name?: string;
      sku?: string;
      description?: string;
      categoryId?: string | null;
      propertyValues?: PropertyValueInput;
      quantity?: number;
      minQuantity?: number;
      unit?: string;
      links?: string;
      customFields?: string;
      // The whole picture set, ordered; REPLACES what the item has (#212). An
      // empty array is a real instruction and clears the pictures; omitting the
      // field leaves them alone.
      photos?: string[];
      storageId?: string;
      // null explicitly clears the cell placement; undefined leaves it untouched.
      storageRow?: number | null;
      storageCol?: number | null;
    },
  ) {
    // A direct quantity write must not bypass the movement ledger (#53): the
    // stock-change modal is the primary write path, but the agent tool and
    // legacy clients may still PATCH quantity — record the delta as an
    // ADJUSTMENT so history stays complete.
    if (data.quantity !== undefined) {
      const current = await this.prisma.component.findUnique({
        where: { id },
        select: { quantity: true },
      });
      const delta = data.quantity - (current?.quantity ?? 0);
      if (delta !== 0) {
        await this.prisma.stockMovement.create({
          data: {
            id: 'sm_' + Math.random().toString(36).substring(2, 9),
            componentId: id,
            delta,
            type: 'ADJUSTMENT',
            note: this.i18n.t('inventory.notes.directEdit'),
          },
        });
      }
    }
    // The photo input is transient — it resolves to attachment rows, and must
    // never be spread into the Prisma payload (there is no photo COLUMN left).
    const photoUrls = await this.resolvePhotoUrls(data, id);
    const rest: typeof data = { ...data };
    delete rest.photos;
    // Property values live in their own table — they must never reach the
    // component's Prisma payload.
    delete rest.propertyValues;
    // Moving to another category is the first of the three data-loss paths
    // (#205): whatever the new category does not define spills into the
    // free-form pairs BEFORE the move, while the old definitions still exist to
    // name the values.
    if (data.categoryId !== undefined) {
      const before = await this.prisma.component.findUnique({
        where: { id },
        select: { categoryId: true },
      });
      if ((before?.categoryId ?? null) !== (data.categoryId ?? null)) {
        await this.categories.spillForCategoryChange(
          id,
          data.categoryId ?? null,
        );
      }
    }
    const updated = await this.prisma.component.update({
      where: { id },
      data: {
        ...rest,
        ...(data.description === undefined
          ? {}
          : { description: sanitizeHtml(data.description) }),
        storageRow:
          data.storageRow === undefined
            ? undefined
            : data.storageRow !== null
              ? Number(data.storageRow)
              : null,
        storageCol:
          data.storageCol === undefined
            ? undefined
            : data.storageCol !== null
              ? Number(data.storageCol)
              : null,
      },
      include: {
        storage: true,
      },
    });
    // The set is applied AFTER the row update: `applyPhotoSet` writes the pin
    // itself, and doing it first would have that write overwritten here.
    // Whatever leaves the set is deleted with its file — never orphaned (#73).
    if (photoUrls !== undefined) {
      await this.applyPhotoSet(id, photoUrls);
    }
    if (data.propertyValues) {
      await this.categories.setValues(id, data.propertyValues);
    }
    // The changed list carries COLUMN names as written; the photo inputs are
    // announced under the name every consumer knows them by. "Sent" is close
    // enough to "changed" for an invitation-to-re-read (#189 decision 5) — a
    // no-op PATCH announcing itself is harmless, a diff pass here is not free.
    const changed = [
      ...Object.keys(rest).filter(
        (k) => rest[k as keyof typeof rest] !== undefined,
      ),
      ...(photoUrls !== undefined ? ['imageUrl'] : []),
    ];
    if (changed.length > 0) {
      await this.events.itemChanged(updated.id, changed, updated.scopeId);
    }
    const [withPhotos] = await this.withPhotos([
      photoUrls !== undefined
        ? ((await this.prisma.component.findUnique({
            where: { id },
            include: { storage: true },
          })) ?? updated)
        : updated,
    ]);
    return withPhotos;
  }

  async delete(id: string) {
    const pcs = await this.prisma.projectComponent.findMany({
      where: { componentId: id },
      include: { project: true },
    });
    if (pcs.length > 0) {
      const names = pcs.map((p) => p.project.title).join(', ');
      throw new Error(
        this.i18n.t('inventory.errors.usedInProjects', { names }),
      );
    }

    const tcs = await this.prisma.taskComponent.findMany({
      where: { componentId: id },
      include: { task: { include: { project: true } } },
    });
    if (tcs.length > 0) {
      const names = tcs
        .map((t) => `${t.task.project.title} -> ${t.task.title}`)
        .join(', ');
      throw new Error(this.i18n.t('inventory.errors.usedInTasks', { names }));
    }

    const ocs = await this.prisma.orderComponent.findMany({
      where: { componentId: id },
      include: { order: true },
    });
    if (ocs.length > 0) {
      const names = ocs.map((o) => o.order.storeName).join(', ');
      throw new Error(this.i18n.t('inventory.errors.usedInOrders', { names }));
    }

    // The pictures go BEFORE the item: they are `Attachment` rows keyed by
    // `componentId`, and once the component is gone the scope policy can no
    // longer prove their parent, which would strand them (#125).
    await this.deleteAllPhotos(id);
    const deleted = await this.prisma.component.delete({
      where: { id },
    });
    await this.events.itemDeleted(deleted);
    return deleted;
  }

  // Capability (#90): in-stock parts that have no storage cell yet — the
  // projects bench summary's "not put away" figure. Scope-filtered by the
  // request's Prisma client.
  async unplacedCount(): Promise<number> {
    return this.prisma.component.count({
      where: { quantity: { gt: 0 }, storageId: null },
    });
  }
}
