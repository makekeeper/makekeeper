import {
  formatObjectRef,
  parseObjectRef,
  type CalendarItem,
  type CalendarSourceCapability,
} from '@makekeeper/plugin-contract';
import type { PrismaService } from '@makekeeper/backend-core';

// Orders on the calendar (#310): when a parcel is expected. Read from the
// order row itself, so a courier's revised estimate reaches the calendar the
// moment tracking writes it — with nothing to synchronise and nothing to
// forget to emit.
const DELIVERED_STATUSES = new Set(['DELIVERED', 'RECEIVED']);

export function createLogisticsCalendarSource(
  prisma: PrismaService,
): CalendarSourceCapability {
  return {
    async itemsInRange(from, to) {
      const orders = await prisma.order.findMany({
        where: {
          estimatedDelivery: { gte: new Date(from), lte: new Date(to) },
        },
        select: {
          id: true,
          storeName: true,
          estimatedDelivery: true,
          status: true,
        },
      });
      const items: CalendarItem[] = [];
      for (const order of orders) {
        if (!order.estimatedDelivery) continue;
        items.push({
          ref: formatObjectRef({
            pluginId: 'logistics',
            entityType: 'order',
            entityId: order.id,
          }),
          kindKey: 'logistics.calendar.orderExpected',
          title: order.storeName,
          field: 'estimatedDelivery',
          at: order.estimatedDelivery.toISOString(),
          done: DELIVERED_STATUSES.has(order.status),
        });
      }
      return items;
    },

    async dateOf(ref, field) {
      const parsed = parseObjectRef(ref);
      if (!parsed || parsed.pluginId !== 'logistics') return null;
      if (parsed.entityType !== 'order' || field !== 'estimatedDelivery') {
        return null;
      }
      const order = await prisma.order.findFirst({
        where: { id: parsed.entityId },
        select: { estimatedDelivery: true },
      });
      return order?.estimatedDelivery?.toISOString() ?? null;
    },
  };
}
