import { Injectable, Logger } from '@nestjs/common';
import {
  CapabilityRegistryService,
  PrismaService,
  PluginI18nService,
  PluginEventBusService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
  LOGISTICS_ORDER_RECEIVED_EVENT,
  LOGISTICS_STOCK_ADJUST_EVENT,
  formatObjectRef,
  type ExternalEventsPublishCapability,
  type LogisticsStockAdjustEvent,
  type ComponentOrderSummary,
} from '@makekeeper/plugin-contract';
import { OrderStatus } from './logistics.dto';

// Order statuses that mean "stock is on the way" — placed but not yet received.
// A DELIVERED order has already incremented the component quantity.
const ACTIVE_ORDER_STATUSES = ['ORDERED', 'SHIPPED'];

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: PluginI18nService,
    private readonly eventBus: PluginEventBusService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  // The public fact "this order's arrival was recorded" (#189/#192) — emitted
  // once per intake act, wherever it happens (per-line receiving, the
  // DELIVERED flip, an order born delivered). Best-effort after the write
  // (#189 decision 9): a failed enqueue is logged, never thrown.
  private async announceOrderReceived(order: {
    id: string;
    scopeId: string | null;
  }): Promise<void> {
    const publisher =
      this.capabilities.getCapability<ExternalEventsPublishCapability>(
        EXTERNAL_EVENTS_PUBLISH_CAPABILITY,
      );
    if (!publisher) return;
    try {
      await publisher.publishDomainEvent({
        type: LOGISTICS_ORDER_RECEIVED_EVENT,
        scopeId: order.scopeId,
        ref:
          formatObjectRef({
            pluginId: 'logistics',
            entityType: 'order',
            entityId: order.id,
          }) ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `domain event ${LOGISTICS_ORDER_RECEIVED_EVENT} not published: ${getErrorMessage(err)}`,
      );
    }
  }

  // `projectId` scopes the list to one project's orders (the project-detail
  // Logistics tab and task order-dependency picker) so callers no longer fetch
  // every order and filter client-side.
  async findAllOrders(projectId?: string) {
    const orders = await this.prisma.order.findMany({
      where: projectId ? { projectId } : undefined,
      include: {
        items: {
          include: {
            component: true,
          },
        },
        supplier: true,
        project: true,
        storage: true,
        // Checkpoint count only — the card shows it on the Tracking tab before
        // the (lazy) timeline itself is ever fetched (#245).
        _count: { select: { trackingEvents: true } },
      },
      orderBy: {
        orderDate: 'desc',
      },
    });

    // Receiving an order writes PURCHASE movements tagged with the orderId —
    // the latest one is the order's factual delivery date (the status column
    // has no timestamp). One grouped query for the whole list.
    const receivedAgg = await this.prisma.stockMovement.groupBy({
      by: ['orderId'],
      where: { orderId: { not: null }, type: 'PURCHASE' },
      _max: { createdAt: true },
    });
    const receivedByOrder = new Map(
      receivedAgg.map((row) => [row.orderId, row._max.createdAt]),
    );

    return orders.map((o) => {
      const itemsCount = o.items.reduce((acc, item) => acc + item.quantity, 0);
      // Fall back to the supplier's tracking-URL template when the order has no
      // explicit link — {tracking} is substituted with the number.
      const templatedUrl =
        !o.trackingUrl && o.supplier?.trackingUrlTemplate && o.trackingNumber
          ? o.supplier.trackingUrlTemplate.replace(
              '{tracking}',
              o.trackingNumber,
            )
          : '';
      return {
        id: o.id,
        storeName: o.storeName,
        // Return raw ISO timestamps; the frontend formats them in the active
        // i18n locale (backend has no per-request locale on this list route).
        orderDate: o.orderDate.toISOString(),
        status: o.status,
        trackingNumber: o.trackingNumber,
        trackingUrl: o.trackingUrl || templatedUrl,
        estimatedDelivery: o.estimatedDelivery
          ? o.estimatedDelivery.toISOString()
          : null,
        receivedAt: receivedByOrder.get(o.id)?.toISOString() ?? null,
        totalCost: o.totalCost || 0,
        currency: o.currency || 'USD',
        supplierId: o.supplierId,
        supplierName: o.supplier?.name ?? null,
        projectId: o.projectId,
        projectName: o.project?.title ?? null,
        storageId: o.storageId,
        storageName: o.storage?.name ?? null,
        lastTrackedAt: o.lastTrackedAt ? o.lastTrackedAt.toISOString() : null,
        itemsCount,
        trackingEventsCount: o._count.trackingEvents,
        items: o.items,
      };
    });
  }

  // Lightweight single-order lookup used by the agent confirmation card to
  // resolve an orderId into its store name (no items/joins needed).
  async findOrder(id: string) {
    return this.prisma.order.findUnique({ where: { id } });
  }

  // Component id → display name, for the create_order confirmation preview (#72).
  // Reads the shared Component table directly (the same read logistics-import
  // already does); a missing id is simply absent from the map so callers fall
  // back to the raw id.
  async componentNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id) => id))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.component.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  // OrderComponent id → its component's display name, for the receive_order_items
  // confirmation preview (#72). Scoped to one order so it never leaks rows across
  // orders; a line whose id isn't in this order is absent from the map.
  async orderLineNames(
    orderId: string,
    orderComponentIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(orderComponentIds.filter((id) => id))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.orderComponent.findMany({
      where: { orderId, id: { in: unique } },
      include: { component: { select: { name: true } } },
    });
    return new Map(rows.map((row) => [row.id, row.component.name]));
  }

  async getShoppingList() {
    const projectComponents = await this.prisma.projectComponent.findMany({
      include: { component: true },
    });
    const allComponents = await this.prisma.component.findMany();
    // Price is no longer stored on the component (#50); estimate from the last
    // unit price actually paid for it, falling back to 1.00 when never ordered.
    const lastPrices = await this.lastUnitPriceByComponent();

    const shoppingMap = new Map<
      string,
      { componentId: string; name: string; qty: number; estimate: number }
    >();

    // 1. Deficits from active projects
    for (const pc of projectComponents) {
      const deficit = pc.neededQty - pc.reservedQty;
      if (deficit > 0) {
        const item = shoppingMap.get(pc.component.id) || {
          componentId: pc.component.id,
          name: pc.component.name,
          qty: 0,
          estimate: lastPrices.get(pc.component.id) || 1.0,
        };
        item.qty += deficit;
        shoppingMap.set(pc.component.id, item);
      }
    }

    // 2. Deficits from low stock levels. minQuantity 0 means "low-stock
    // tracking off" for that component (#53) — never auto-suggests a purchase.
    for (const comp of allComponents) {
      if (comp.minQuantity > 0 && comp.quantity <= comp.minQuantity) {
        // Replenish to at least double of minimum to be safe
        const replenishQty = Math.max(1, comp.minQuantity * 2 - comp.quantity);
        const item = shoppingMap.get(comp.id) || {
          componentId: comp.id,
          name: comp.name,
          qty: 0,
          estimate: lastPrices.get(comp.id) || 1.0,
        };
        if (item.qty < replenishQty) {
          item.qty = replenishQty;
        }
        shoppingMap.set(comp.id, item);
      }
    }

    return Array.from(shoppingMap.values()).map((item) => ({
      componentId: item.componentId,
      name: item.name,
      qty: item.qty,
      estimate: Number((item.qty * item.estimate).toFixed(2)),
    }));
  }

  // Most-recent unit price paid per component, from OrderComponent history —
  // the replacement for the removed Component.price (#50).
  private async lastUnitPriceByComponent(): Promise<Map<string, number>> {
    const rows = await this.prisma.orderComponent.findMany({
      where: { unitPrice: { not: null } },
      include: { order: { select: { orderDate: true } } },
      orderBy: { order: { orderDate: 'desc' } },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!map.has(row.componentId))
        map.set(row.componentId, row.unitPrice ?? 0);
    }
    return map;
  }

  // Destination must be a ROOT storage (#51) — a parcel arrives at a room/
  // cabinet, not a specific cell; exact placement stays a per-component action.
  private async assertRootStorage(storageId?: string | null): Promise<void> {
    if (!storageId) return;
    const storage = await this.prisma.storage.findUnique({
      where: { id: storageId },
      select: { parentId: true },
    });
    if (!storage || storage.parentId !== null) {
      throw new Error(this.i18n.t('logistics.errors.destinationNotRoot'));
    }
  }

  async createOrder(data: {
    storeName: string;
    trackingNumber?: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
    totalCost?: number;
    currency?: string;
    supplierId?: string;
    projectId?: string;
    storageId?: string;
    status?: OrderStatus;
    items: { componentId: string; quantity: number; unitPrice: number }[];
  }) {
    await this.assertRootStorage(data.storageId);
    const orderId = generateUuid();
    // Default to ORDERED for a placed purchase; the frontend passes CART to save
    // a draft/wishlist that the user completes later.
    const status = data.status ?? 'ORDERED';

    const order = await this.prisma.order.create({
      data: {
        id: orderId,
        storeName: data.storeName,
        trackingNumber: data.trackingNumber || '',
        trackingUrl: data.trackingUrl || '',
        estimatedDelivery: data.estimatedDelivery
          ? new Date(data.estimatedDelivery)
          : null,
        totalCost: data.totalCost || 0,
        currency: data.currency || 'USD',
        supplierId: data.supplierId || null,
        projectId: data.projectId || null,
        storageId: data.storageId || null,
        status,
      },
    });

    // Create line items as separate flat-FK writes rather than a nested
    // `items: { create }`: OrderComponent is a scope-child model, and the
    // multiuser policy only validates each componentId is in the caller's
    // scope when the create goes through the model op directly (§5.8).
    for (const item of data.items) {
      await this.prisma.orderComponent.create({
        data: {
          id: generateUuid(),
          orderId,
          componentId: item.componentId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }

    // An order recorded as already delivered IS a recorded arrival — the
    // subscriber's fact does not depend on which form it was typed into.
    // Announced after the lines exist, so an immediate re-read sees them.
    if (status === 'DELIVERED') await this.announceOrderReceived(order);

    return order;
  }

  async updateStatus(orderId: string, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));

    const enteringDelivered =
      status === 'DELIVERED' && order.status !== 'DELIVERED';
    const leavingDelivered =
      status !== 'DELIVERED' && order.status === 'DELIVERED';

    // Marking delivered fully receives every line; leaving delivered un-receives
    // them. Both funnel through the idempotent per-line receiving path.
    if (enteringDelivered) {
      for (const item of order.items) {
        await this.setLineReceived(
          item,
          item.quantity,
          order.storeName,
          order.storageId,
        );
      }
    } else if (leavingDelivered) {
      for (const item of order.items) {
        await this.setLineReceived(item, 0, order.storeName);
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
    if (enteringDelivered) await this.announceOrderReceived(updated);
    return updated;
  }

  // Full single-order read for the edit form: scalar fields + line items. The ETA
  // is a `YYYY-MM-DD` string so it maps straight onto the form's <input type=date>.
  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { component: true } } },
    });
    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));
    return {
      id: order.id,
      storeName: order.storeName,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      estimatedDelivery: order.estimatedDelivery
        ? order.estimatedDelivery.toISOString().slice(0, 10)
        : '',
      totalCost: order.totalCost || 0,
      currency: order.currency || 'USD',
      supplierId: order.supplierId,
      projectId: order.projectId,
      storageId: order.storageId,
      items: order.items.map((i) => ({
        componentId: i.componentId,
        quantity: i.quantity,
        unitPrice: i.unitPrice ?? 0,
      })),
    };
  }

  async updateOrder(
    id: string,
    data: {
      storeName: string;
      trackingNumber?: string;
      trackingUrl?: string;
      estimatedDelivery?: string;
      totalCost?: number;
      currency?: string;
      supplierId?: string;
      projectId?: string;
      storageId?: string;
      status?: OrderStatus;
      items: { componentId: string; quantity: number; unitPrice: number }[];
    },
  ) {
    await this.assertRootStorage(data.storageId);
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing)
      throw new Error(this.i18n.t('logistics.errors.orderNotFound'));

    const newStatus = data.status ?? (existing.status as OrderStatus);

    // Back out any stock already received against the old lines before we replace
    // them, so stock stays exact across edits.
    await this.reverseReceived(existing);

    await this.prisma.order.update({
      where: { id },
      data: {
        storeName: data.storeName,
        trackingNumber: data.trackingNumber || '',
        trackingUrl: data.trackingUrl || '',
        estimatedDelivery: data.estimatedDelivery
          ? new Date(data.estimatedDelivery)
          : null,
        totalCost: data.totalCost || 0,
        currency: data.currency || 'USD',
        supplierId: data.supplierId || null,
        projectId: data.projectId || null,
        storageId: data.storageId || null,
        status: newStatus,
      },
    });

    // Replace line items wholesale (flat-FK writes for the scope policy, §5.8).
    await this.prisma.orderComponent.deleteMany({ where: { orderId: id } });
    for (const item of data.items) {
      await this.prisma.orderComponent.create({
        data: {
          id: generateUuid(),
          orderId: id,
          componentId: item.componentId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }

    // A delivered order fully receives its (new) lines.
    if (newStatus === 'DELIVERED') {
      const created = await this.prisma.orderComponent.findMany({
        where: { orderId: id },
      });
      for (const line of created) {
        await this.setLineReceived(
          line,
          line.quantity,
          data.storeName,
          data.storageId || null,
        );
      }
      // Only the TRANSITION into delivered is a newly recorded arrival — an
      // edit of an already-delivered order re-syncs stock, it does not
      // re-announce the fact.
      if (existing.status !== 'DELIVERED') {
        await this.announceOrderReceived(existing);
      }
    }

    return this.prisma.order.findUnique({ where: { id } });
  }

  async deleteOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));

    // Undo any received stock before deleting, so removing history never leaves
    // phantom quantity on the shelf.
    await this.reverseReceived(order);

    // OrderComponent + TaskOrderDependency + ReturnRequest cascade on delete.
    await this.prisma.order.delete({ where: { id } });
    return { ok: true };
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────

  async findAllSuppliers() {
    return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  }

  async findSupplier(id: string) {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async createSupplier(data: {
    name: string;
    url?: string;
    country?: string;
    trackingUrlTemplate?: string;
    notes?: string;
  }) {
    return this.prisma.supplier.create({
      data: {
        id: generateUuid(),
        name: data.name,
        url: data.url || null,
        country: data.country || null,
        trackingUrlTemplate: data.trackingUrlTemplate || null,
        notes: data.notes || null,
      },
    });
  }

  async updateSupplier(
    id: string,
    data: {
      name: string;
      url?: string;
      country?: string;
      trackingUrlTemplate?: string;
      notes?: string;
    },
  ) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(this.i18n.t('logistics.errors.supplierNotFound'));
    }
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: data.name,
        url: data.url ?? null,
        country: data.country ?? null,
        trackingUrlTemplate: data.trackingUrlTemplate ?? null,
        notes: data.notes ?? null,
      },
    });
  }

  async deleteSupplier(id: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(this.i18n.t('logistics.errors.supplierNotFound'));
    }
    // Order.supplierId is SET NULL on delete, so past orders keep their free-text
    // storeName and simply lose the structured supplier link.
    await this.prisma.supplier.delete({ where: { id } });
    return { ok: true };
  }

  // ── Returns / RMA ─────────────────────────────────────────────────────────

  async findReturns(orderId?: string) {
    return this.prisma.returnRequest.findMany({
      where: orderId ? { orderId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findReturn(id: string) {
    return this.prisma.returnRequest.findUnique({ where: { id } });
  }

  // Opening a return removes the returned units from stock (a RETURN movement)
  // when a component is specified — the parts have physically left the shelf.
  async createReturn(data: {
    orderId: string;
    componentId?: string;
    quantity: number;
    reason?: string;
    trackingNumber?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
    });
    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));

    const ret = await this.prisma.returnRequest.create({
      data: {
        id: generateUuid(),
        orderId: data.orderId,
        componentId: data.componentId || null,
        quantity: data.quantity,
        status: 'INITIATED',
        reason: data.reason || null,
        trackingNumber: data.trackingNumber || null,
      },
    });

    if (data.componentId) {
      // Stock is inventory's domain (#58): announce the return; the inventory
      // listener removes the units from stock (no-op while inventory is off).
      await this.eventBus.emit<LogisticsStockAdjustEvent>(
        LOGISTICS_STOCK_ADJUST_EVENT,
        {
          componentId: data.componentId,
          delta: -data.quantity,
          movementType: 'RETURN',
          orderId: data.orderId,
          note: this.i18n.t('logistics.notes.returnCreated', {
            storeName: order.storeName,
          }),
        },
      );
    }
    return ret;
  }

  async updateReturnStatus(id: string, status: string) {
    const existing = await this.prisma.returnRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new Error(this.i18n.t('logistics.errors.returnNotFound'));
    }
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status },
    });
  }

  // ── Component-order info (capability, #58) ────────────────────────────────
  // Order-derived facts about components, offered to the inventory plugin via
  // the capability registry (COMPONENT_ORDER_INFO_CAPABILITY) — logistics owns
  // its order data, so these vanish with the plugin.

  // Quantity on the way per component: sum across orders that are placed but
  // not yet received. One scope-filtered grouped query.
  async onOrderByComponent(): Promise<Map<string, number>> {
    const rows = await this.prisma.orderComponent.groupBy({
      by: ['componentId'],
      where: { order: { status: { in: ACTIVE_ORDER_STATUSES } } },
      _sum: { quantity: true },
    });
    return new Map(
      rows.map((row) => [row.componentId, row._sum.quantity ?? 0]),
    );
  }

  // Quantity on the way per (project, component): the same in-flight lines, but
  // attributed to the project each order was placed for (#90), keyed
  // projectId → componentId → qty. `projectId` lives on Order (not
  // OrderComponent), so this can't be a single groupBy — fold the joined rows in
  // memory. Orders without a project are skipped, so the bench credits incoming
  // parts only to the project that ordered them and never double-counts a part
  // two active projects both need. One scope-filtered query.
  async onOrderByProjectComponent(): Promise<Map<string, Map<string, number>>> {
    const rows = await this.prisma.orderComponent.findMany({
      where: {
        order: {
          status: { in: ACTIVE_ORDER_STATUSES },
          projectId: { not: null },
        },
      },
      select: {
        componentId: true,
        quantity: true,
        order: { select: { projectId: true } },
      },
    });
    const byProject = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const projectId = row.order.projectId;
      if (!projectId) continue;
      const inner = byProject.get(projectId) ?? new Map<string, number>();
      inner.set(
        row.componentId,
        (inner.get(row.componentId) ?? 0) + row.quantity,
      );
      byProject.set(projectId, inner);
    }
    return byProject;
  }

  // Most-recent unit price paid per component, with the order's currency, taken
  // from OrderComponent history. One scope-filtered query; first row per
  // component wins (ordered newest-first).
  async lastPriceByComponent(): Promise<
    Map<string, { price: number; currency: string }>
  > {
    const rows = await this.prisma.orderComponent.findMany({
      where: { unitPrice: { not: null } },
      include: { order: { select: { orderDate: true, currency: true } } },
      orderBy: { order: { orderDate: 'desc' } },
    });
    const map = new Map<string, { price: number; currency: string }>();
    for (const row of rows) {
      if (map.has(row.componentId)) continue;
      map.set(row.componentId, {
        price: row.unitPrice ?? 0,
        currency: row.order.currency ?? 'USD',
      });
    }
    return map;
  }

  // Orders that reference a component, newest first — store, status, quantity
  // and date, for the "related orders" panel in the component card.
  async componentOrders(componentId: string): Promise<ComponentOrderSummary[]> {
    const rows = await this.prisma.orderComponent.findMany({
      where: { componentId },
      include: { order: true },
      orderBy: { order: { orderDate: 'desc' } },
    });
    return rows.map((row) => ({
      orderId: row.orderId,
      storeName: row.order.storeName,
      status: row.order.status,
      quantity: row.quantity,
      orderDate: row.order.orderDate,
    }));
  }

  // ── Receiving (per-line, idempotent) ──────────────────────────────────────

  // Sets received qty across selected order lines and syncs stock by the DELTA
  // only, so calling it repeatedly can never double-count. When every line ends
  // up fully received the order flips to DELIVERED; otherwise the status is left
  // as-is. This is the single source of truth for warehouse intake — the
  // DELIVERED status path funnels through it too.
  async receiveOrder(
    orderId: string,
    lines: { orderComponentId: string; receivedQty: number }[],
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error(this.i18n.t('logistics.errors.orderNotFound'));

    const byId = new Map(order.items.map((i) => [i.id, i]));
    // Intake = at least one line's received qty actually GREW. Corrections
    // downward re-sync stock but record no new arrival.
    let intake = false;
    for (const line of lines) {
      const item = byId.get(line.orderComponentId);
      if (!item) continue;
      const target = Math.max(0, Math.min(line.receivedQty, item.quantity));
      if (target > item.receivedQty) intake = true;
      await this.setLineReceived(
        item,
        target,
        order.storeName,
        order.storageId,
      );
    }

    const refreshed = await this.prisma.orderComponent.findMany({
      where: { orderId },
    });
    const fullyReceived =
      refreshed.length > 0 &&
      refreshed.every((i) => i.receivedQty >= i.quantity);
    if (fullyReceived && order.status !== 'DELIVERED') {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERED' },
      });
    }
    if (intake) await this.announceOrderReceived(order);
    return { ok: true, fullyReceived };
  }

  // Moves one line to `target` received and announces the stock delta. The
  // destination storage rides on the event: the inventory listener applies the
  // fill-if-empty placement (#51) along with the ledger write.
  private async setLineReceived(
    line: { id: string; componentId: string; receivedQty: number },
    target: number,
    storeName: string,
    destinationStorageId?: string | null,
  ): Promise<void> {
    const delta = target - line.receivedQty;
    if (delta !== 0) {
      await this.adjustStock(
        line.componentId,
        delta,
        null,
        storeName,
        destinationStorageId,
      );
      await this.prisma.orderComponent.update({
        where: { id: line.id },
        data: { receivedQty: target },
      });
    }
  }

  // Announces a stock change of `delta` (negative = reversal) for the inventory
  // plugin to apply (#58) — stock is inventory functionality, so while it is
  // disabled the order flow proceeds without touching stock. orderId is stamped
  // on the ledger row for audit.
  private async adjustStock(
    componentId: string,
    delta: number,
    orderId: string | null,
    storeName: string,
    destinationStorageId?: string | null,
  ): Promise<void> {
    const note =
      delta >= 0
        ? this.i18n.t('logistics.notes.orderReceived', { storeName })
        : this.i18n.t('logistics.notes.orderReverted', { storeName });
    await this.eventBus.emit<LogisticsStockAdjustEvent>(
      LOGISTICS_STOCK_ADJUST_EVENT,
      {
        componentId,
        delta,
        movementType: delta >= 0 ? 'PURCHASE' : 'ADJUSTMENT',
        orderId,
        note,
        destinationStorageId: destinationStorageId ?? null,
      },
    );
  }

  // Backs out all received stock for an order's lines (used before an edit
  // replaces items or a delete removes the order). Leaves receivedQty as-is on
  // the rows since they are about to be replaced/removed.
  private async reverseReceived(order: {
    id: string;
    storeName: string;
    items: { componentId: string; receivedQty: number }[];
  }): Promise<void> {
    for (const item of order.items) {
      if (item.receivedQty > 0) {
        await this.adjustStock(
          item.componentId,
          -item.receivedQty,
          order.id,
          order.storeName,
        );
      }
    }
  }

  // Capability (#90): how many orders are still in flight (placed/shipped) — the
  // projects bench summary's "incoming" figure. Scope-filtered by the request's
  // Prisma client, like every other read here.
  async incomingOrderCount(): Promise<number> {
    return this.prisma.order.count({
      where: { status: { in: ACTIVE_ORDER_STATUSES } },
    });
  }
}
