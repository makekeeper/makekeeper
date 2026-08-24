import { NotFoundException } from '@nestjs/common';
import {
  ExchangeSectionProvider,
  PrismaService,
  generateUuid,
  isExchangeRecord,
  readDate,
  readNumber,
  readOptionalString,
  readString,
  exchangeScopeFilter,
  exchangeScopeStamp,
} from '@makekeeper/backend-core';
import { formatObjectRef, resolveEntityId } from '@makekeeper/plugin-contract';

// Exchange section provider of the logistics plugin (#62): `logistics.orders`
// for the project root — the project's orders with their lines, tracking
// checkpoints, returns and the referenced suppliers (embedded snapshots).
// Suppliers are a shared vocabulary: import matches by name (case-insensitive)
// and only creates the missing ones. Destination storages sit outside a
// project archive, so `storageId` is stripped; component lines whose component
// did not travel (BOM section unselected) are dropped rather than dangled.

function orderRef(id: string): string | null {
  return formatObjectRef({
    pluginId: 'logistics',
    entityType: 'order',
    entityId: id,
  });
}

function mapId(
  ctx: {
    preserveIds: boolean;
    idMap: { translate(t: string, id: string | null): string | null };
  },
  entityType: string,
  oldId: string | null,
): string | null {
  if (!oldId) return null;
  return ctx.preserveIds ? oldId : ctx.idMap.translate(entityType, oldId);
}

export function createLogisticsExchangeProviders(
  prisma: PrismaService,
): ExchangeSectionProvider[] {
  const ordersProvider: ExchangeSectionProvider = {
    sectionKey: 'logistics.orders',

    async exportSection(ctx) {
      const resolved = ctx.root.entityId
        ? resolveEntityId(ctx.root.entityId, {
            pluginId: 'projects',
            entityType: 'project',
          })
        : null;
      if (!resolved)
        throw new NotFoundException('exchange.errors.rootNotFound');
      const orders = await prisma.order.findMany({
        where: { projectId: resolved.id },
        include: {
          items: true,
          trackingEvents: true,
          returns: true,
          supplier: true,
        },
        orderBy: { orderDate: 'asc' },
      });
      const records: Record<string, unknown>[] = [];
      const suppliersSeen = new Set<string>();
      for (const order of orders) {
        if (order.supplier && !suppliersSeen.has(order.supplier.id)) {
          suppliersSeen.add(order.supplier.id);
          records.push({
            t: 'supplier',
            id: order.supplier.id,
            name: order.supplier.name,
            url: order.supplier.url,
            country: order.supplier.country,
            trackingUrlTemplate: order.supplier.trackingUrlTemplate,
            notes: order.supplier.notes,
          });
        }
        const ref = orderRef(order.id);
        if (ref) ctx.addExportedRef(ref);
        records.push({
          t: 'order',
          id: order.id,
          projectId: order.projectId,
          supplierId: order.supplierId,
          storeName: order.storeName,
          orderDate: order.orderDate.toISOString(),
          status: order.status,
          trackingNumber: order.trackingNumber,
          trackingUrl: order.trackingUrl,
          estimatedDelivery: order.estimatedDelivery?.toISOString() ?? null,
          totalCost: order.totalCost,
          currency: order.currency,
        });
        for (const item of order.items) {
          records.push({
            t: 'orderComponent',
            orderId: order.id,
            componentId: item.componentId,
            quantity: item.quantity,
            receivedQty: item.receivedQty,
            unitPrice: item.unitPrice,
          });
        }
        for (const event of order.trackingEvents) {
          records.push({
            t: 'trackingEvent',
            orderId: order.id,
            status: event.status,
            location: event.location,
            eventTime: event.eventTime.toISOString(),
            raw: event.raw,
          });
        }
        for (const ret of order.returns) {
          records.push({
            t: 'returnRequest',
            orderId: order.id,
            componentId: ret.componentId,
            quantity: ret.quantity,
            status: ret.status,
            trackingNumber: ret.trackingNumber,
            reason: ret.reason,
            createdAt: ret.createdAt.toISOString(),
          });
        }
      }
      return { records };
    },

    async inspectSection(records) {
      return {
        count: records.filter((r) => isExchangeRecord(r, 'order')).length,
      };
    },

    async importSection(records, ctx) {
      let created = 0;
      // Suppliers first (orders reference them): match-by-name, create missing.
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'supplier')) continue;
        const oldId = readString(raw, 'id', 100);
        const name = readString(raw, 'name', 300);
        if (!oldId || !name) continue;
        if (!ctx.preserveIds) {
          const existing = await ctx.tx.supplier.findFirst({
            where: {
              name: { equals: name, mode: 'insensitive' },
              ...exchangeScopeFilter(ctx),
            },
          });
          if (existing) {
            ctx.idMap.set('supplier', oldId, existing.id);
            continue;
          }
        }
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('supplier', oldId, newId);
        await ctx.tx.supplier.create({
          data: {
            id: newId,
            name,
            url: readOptionalString(raw, 'url', 1000),
            country: readOptionalString(raw, 'country', 100),
            trackingUrlTemplate: readOptionalString(
              raw,
              'trackingUrlTemplate',
              1000,
            ),
            notes: readOptionalString(raw, 'notes', 10_000),
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      for (const raw of records) {
        if (!isExchangeRecord(raw, 'order')) continue;
        const oldId = readString(raw, 'id', 100);
        const storeName = readString(raw, 'storeName', 300);
        if (!oldId || !storeName) continue;
        const newId = ctx.preserveIds ? oldId : generateUuid();
        ctx.idMap.set('order', oldId, newId);
        await ctx.tx.order.create({
          data: {
            id: newId,
            storeName,
            orderDate: readDate(raw, 'orderDate') ?? new Date(),
            status: readString(raw, 'status', 40) ?? 'ORDERED',
            trackingNumber: readOptionalString(raw, 'trackingNumber', 200),
            trackingUrl: readOptionalString(raw, 'trackingUrl', 1000),
            estimatedDelivery: readDate(raw, 'estimatedDelivery'),
            totalCost: readNumber(raw, 'totalCost'),
            currency: readOptionalString(raw, 'currency', 10) ?? 'USD',
            supplierId: mapId(
              ctx,
              'supplier',
              readOptionalString(raw, 'supplierId', 100),
            ),
            projectId: mapId(
              ctx,
              'project',
              readOptionalString(raw, 'projectId', 100),
            ),
            // Destination storage stays behind — it is not part of the archive.
            storageId: null,
            ...exchangeScopeStamp(ctx),
          },
        });
        created += 1;
      }
      for (const raw of records) {
        if (isExchangeRecord(raw, 'orderComponent')) {
          const orderId = mapId(ctx, 'order', readString(raw, 'orderId', 100));
          const componentId = mapId(
            ctx,
            'component',
            readString(raw, 'componentId', 100),
          );
          if (!orderId || !componentId) continue;
          await ctx.tx.orderComponent.create({
            data: {
              id: generateUuid(),
              orderId,
              componentId,
              quantity: readNumber(raw, 'quantity') ?? 1,
              receivedQty: readNumber(raw, 'receivedQty') ?? 0,
              unitPrice: readNumber(raw, 'unitPrice'),
            },
          });
          created += 1;
        } else if (isExchangeRecord(raw, 'trackingEvent')) {
          const orderId = mapId(ctx, 'order', readString(raw, 'orderId', 100));
          const eventTime = readDate(raw, 'eventTime');
          const status = readString(raw, 'status', 200);
          if (!orderId || !eventTime || !status) continue;
          await ctx.tx.trackingEvent.create({
            data: {
              id: generateUuid(),
              orderId,
              status,
              location: readOptionalString(raw, 'location', 300),
              eventTime,
              raw: readOptionalString(raw, 'raw', 20_000),
            },
          });
          created += 1;
        } else if (isExchangeRecord(raw, 'returnRequest')) {
          const orderId = mapId(ctx, 'order', readString(raw, 'orderId', 100));
          if (!orderId) continue;
          await ctx.tx.returnRequest.create({
            data: {
              id: generateUuid(),
              orderId,
              componentId: mapId(
                ctx,
                'component',
                readOptionalString(raw, 'componentId', 100),
              ),
              quantity: readNumber(raw, 'quantity') ?? 1,
              status: readString(raw, 'status', 40) ?? 'INITIATED',
              trackingNumber: readOptionalString(raw, 'trackingNumber', 200),
              reason: readOptionalString(raw, 'reason', 10_000),
              createdAt: readDate(raw, 'createdAt') ?? new Date(),
            },
          });
          created += 1;
        }
      }
      return { created };
    },
  };

  return [ordersProvider];
}
